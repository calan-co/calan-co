import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { DynamicBorder, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, truncateToWidth, type AutocompleteItem, type AutocompleteProvider, type AutocompleteSuggestions, type SelectItem } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

const SESSION_ROOT = join(homedir(), ".pi", "agent", "sessions");
const MIGRATION_ROOT = join(homedir(), ".pi", "agent", "session-migrations");
const HONCHO_CONFIG = join(homedir(), ".honcho", "config.json");
const HONCHO_SDK = pathToFileURL(join(homedir(), ".pi", "agent", "npm", "node_modules", "@honcho-ai", "sdk", "dist", "index.js")).href;

type SessionHeader = {
  type?: string;
  version?: number;
  id?: string;
  timestamp?: string;
  cwd?: string;
  [key: string]: unknown;
};

type HonchoConfig = {
  apiKey?: string;
  baseUrl?: string;
  peerName?: string;
  workspace?: string;
  aiPeer?: string;
  maxMessageLength?: number;
  observeMe?: boolean;
  observeOthers?: boolean;
  aiObserveMe?: boolean;
  aiObserveOthers?: boolean;
  sessions?: Record<string, string>;
  hosts?: Record<string, any>;
};

type RebuildMessage = {
  peerId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 8);
const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_");
const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
};
const expandHome = (p: string): string => {
  const value = stripWrappingQuotes(p);
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
};
const resolveTargetDir = (raw: string, baseDir: string): string => {
  const expanded = expandHome(raw);
  return expanded.startsWith("/") ? resolve(expanded) : resolve(baseDir, expanded);
};
const piWorkspaceDir = (cwd: string): string => join(SESSION_ROOT, `--${cwd.replace(/^\/+/, "").replace(/\//g, "-")}--`);
const directoryKey = (cwd: string): string => sanitize(`dir_${cwd.split("/").pop() || "project"}_${hash(cwd)}`);
const DEFAULT_MAX_MESSAGE_LENGTH = 25000;
const CONTINUED_PREFIX = "[continued] ";
const REDACT_PLACEHOLDER = "<REDACTED>";

const CONTEXTUAL_CREDENTIAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?key|auth[_-]?token|bearer|password|passphrase|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?([^\s'"`,;}{]{8,})['"]?/gi, label: "CREDENTIAL" },
  { re: /(?:export\s+)?(?:API_KEY|SECRET_KEY|ACCESS_KEY|AUTH_TOKEN|PASSWORD|PASSPHRASE|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|OPENAI_API_KEY|ANTHROPIC_API_KEY|EXA_API_KEY|HONCHO_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|GITLAB_TOKEN|NPM_TOKEN)\s*=\s*['"]?([^\s'"`,;}{]{8,})['"]?/gi, label: "ENV_SECRET" },
];
const STANDALONE_CREDENTIAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS_KEY" },
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g, label: "BEARER_TOKEN" },
  { re: /\bgh[ps]_[A-Za-z0-9]{36,}\b/g, label: "GITHUB_TOKEN" },
  { re: /\bglpat-[A-Za-z0-9\-]{20,}\b/g, label: "GITLAB_TOKEN" },
  { re: /\bhch-v\d+-[A-Za-z0-9]{20,}\b/g, label: "HONCHO_KEY" },
  { re: /\bnpm_[A-Za-z0-9]{36,}\b/g, label: "NPM_TOKEN" },
  { re: /\bxox[bpors]-[A-Za-z0-9\-]{10,}\b/g, label: "SLACK_TOKEN" },
  { re: /\bsk-[A-Za-z0-9\-]{20,}\b/g, label: "OPENAI_KEY" },
  { re: /\b[0-9a-f]{64,}\b/gi, label: "HEX_SECRET" },
];

function sanitizeCredentialsLikeHoncho(text: string): string {
  let result = text;
  for (const { re, label } of CONTEXTUAL_CREDENTIAL_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, (match, value) => match.replace(value, `${REDACT_PLACEHOLDER}:${label}`));
  }
  for (const { re, label } of STANDALONE_CREDENTIAL_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, `${REDACT_PLACEHOLDER}:${label}`);
  }
  return result;
}

function stripToolOutputLikeHoncho(text: string): string {
  return text.replace(/```[\w]*\n([\s\S]{500,}?)```/g, (match) => {
    if (/(?:password|secret|key|token|apikey)\s*[:=]/i.test(match)) return "```\n[tool output redacted — contained potential credentials]\n```";
    return match;
  });
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout: 5000 });
    const out = String(stdout).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function repoBase(cwd: string): Promise<string | null> {
  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  if (remote) return sanitize(remote.replace(/\.git$/, "").replace(/^(https?:\/\/)[^@]+@/, "$1"));
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (root) return sanitize(`${root.split("/").pop() || "repo"}_${hash(root)}`);
  return null;
}

async function branchName(cwd: string): Promise<string | null> {
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? sanitize(branch) : null;
}

export async function deriveHonchoSessionKey(cwd: string, config: HonchoConfig): Promise<string> {
  const host = config.hosts?.pi ?? {};
  const manual = config.sessions?.[cwd];
  const sessionPeerPrefix = Boolean(host.sessionPeerPrefix);
  const peerName = process.env.HONCHO_PEER_NAME ?? config.peerName ?? "user";
  let key: string;
  if (manual) key = sanitize(manual);
  else {
    const strategy = process.env.HONCHO_SESSION_STRATEGY ?? host.sessionStrategy ?? "per-directory";
    if (strategy === "global") key = "global";
    else if (strategy === "pi-session") key = sanitize(`pi_${hash(cwd)}_${Date.now().toString(36)}`);
    else if (strategy === "per-repo") key = (await repoBase(cwd)) ?? directoryKey(cwd);
    else if (strategy === "git-branch") {
      const repo = (await repoBase(cwd)) ?? directoryKey(cwd);
      const branch = await branchName(cwd);
      key = branch ? `${repo}__branch_${branch}` : repo;
    } else key = directoryKey(cwd);
  }
  return sessionPeerPrefix ? sanitize(`${peerName}_${key}`) : key;
}

function honchoRuntimeConfig(config: HonchoConfig) {
  const host = config.hosts?.pi ?? {};
  return {
    apiKey: process.env.HONCHO_API_KEY ?? config.apiKey,
    baseURL: process.env.HONCHO_URL ?? host.endpoint ?? config.baseUrl,
    workspaceId: process.env.HONCHO_WORKSPACE_ID ?? host.workspace ?? config.workspace ?? "pi",
    environment: process.env.HONCHO_ENVIRONMENT ?? host.environment ?? "production",
    peerName: process.env.HONCHO_PEER_NAME ?? config.peerName ?? "user",
    aiPeer: process.env.HONCHO_AI_PEER ?? host.aiPeer ?? config.aiPeer ?? "pi",
    maxMessageLength: Number(process.env.HONCHO_MAX_MESSAGE_LENGTH ?? host.maxMessageLength ?? config.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH),
    observeMe: host.observeMe ?? config.observeMe ?? true,
    observeOthers: host.observeOthers ?? config.observeOthers ?? true,
    aiObserveMe: host.aiObserveMe ?? config.aiObserveMe ?? true,
    aiObserveOthers: host.aiObserveOthers ?? config.aiObserveOthers ?? true,
  };
}

const extractHonchoText = (content: unknown): string => {
  const extracted = typeof content === "string" ? content.trim() : Array.isArray(content) ? content.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && "type" in entry && "text" in entry) {
      const block = entry as { type?: string; text?: string };
      if (block.type === "text" && typeof block.text === "string") return [block.text];
    }
    return [];
  }).join("\n").trim() : "";
  return sanitizeCredentialsLikeHoncho(stripToolOutputLikeHoncho(extracted));
};

function findChunkBoundary(search: string, maxLen: number): number {
  const paragraph = search.lastIndexOf("\n\n");
  if (paragraph > 0) return paragraph + 2;
  const sentence = search.lastIndexOf(". ");
  if (sentence > 0) return sentence + 2;
  const word = search.lastIndexOf(" ");
  if (word > 0) return word + 1;
  return maxLen;
}

function chunkTextSmart(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    const cut = findChunkBoundary(remaining.slice(0, maxLen), maxLen);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks.map((chunk, index) => index === 0 ? chunk : `${CONTINUED_PREFIX}${chunk}`);
}

export function buildWholeSessionRebuildMessages(params: { header: SessionHeader; entries: SessionEntry[]; sessionFile: string; migrationId: string; config: HonchoConfig }): RebuildMessage[] {
  const runtime = honchoRuntimeConfig(params.config);
  const messages: RebuildMessage[] = [];
  for (const entry of params.entries) {
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = extractHonchoText(entry.message.content);
    if (!text) continue;
    const chunks = chunkTextSmart(text, runtime.maxMessageLength);
    chunks.forEach((content, chunkIndex) => messages.push({
      peerId: role === "user" ? runtime.peerName : runtime.aiPeer,
      role,
      content,
      createdAt: entry.timestamp ?? new Date(entry.message?.timestamp ?? Date.now()).toISOString(),
      metadata: {
        piSessionId: params.header.id,
        piEntryId: entry.id,
        piParentId: entry.parentId ?? null,
        piCwd: params.header.cwd,
        piRole: role,
        piSourceSessionFile: params.sessionFile,
        piMigrationId: params.migrationId,
        piChunkIndex: chunkIndex,
        piChunkCount: chunks.length,
        rebuiltBy: "session-move",
      },
    }));
  }
  return messages;
}

export function hashRebuildMessages(messages: RebuildMessage[]): string {
  return createHash("sha256").update(JSON.stringify(messages.map((m) => [m.peerId, m.content, m.createdAt, m.metadata]))).digest("hex");
}

type NormalizedHonchoMessage = {
  peerId: string;
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

type HonchoValidationDetails = {
  expectedCount: number;
  expectedHash: string;
  actualTargetCount: number;
  actualTargetHash: string;
  duplicateCount: number;
  sequenceMatches: boolean;
  preexistingTargetCount?: number;
  migratedPayloadCount?: number;
  migratedPayloadHash?: string;
  sourceTotalCount?: number;
  sourceOwnedPresentCount?: number;
  sourceMissingCount?: number;
  sourceResidualCount?: number;
  postMigrationSourceMessageCount?: number;
  abortReasons: string[];
};

function normalizePeerId(message: any): string {
  return String(message?.peerId ?? message?.peer_id ?? message?.peer?.id ?? message?.peer ?? "");
}

function normalizeCreatedAt(message: any): string | undefined {
  const value = message?.createdAt ?? message?.created_at ?? message?.metadata?.createdAt;
  return value == null ? undefined : String(value);
}

function normalizeHonchoMessage(message: any): NormalizedHonchoMessage {
  return {
    peerId: normalizePeerId(message),
    content: String(message?.content ?? ""),
    createdAt: normalizeCreatedAt(message),
    metadata: message?.metadata && typeof message.metadata === "object" ? message.metadata : {},
  };
}

function normalizeExpectedMessage(message: RebuildMessage): NormalizedHonchoMessage {
  return { peerId: message.peerId, content: message.content, createdAt: message.createdAt, metadata: message.metadata };
}

function contentHash(messages: NormalizedHonchoMessage[]): string {
  return createHash("sha256").update(JSON.stringify(messages.map((m) => [m.peerId, m.content, m.createdAt ?? null]))).digest("hex");
}

function stableFingerprint(message: NormalizedHonchoMessage): string {
  return createHash("sha256").update(JSON.stringify([message.peerId, message.content, message.createdAt ?? null])).digest("hex");
}

function normalizedPeerContentFingerprint(message: NormalizedHonchoMessage): string {
  return createHash("sha256").update(JSON.stringify([message.peerId, message.content])).digest("hex");
}

function countByPeerContent(messages: NormalizedHonchoMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const fp = normalizedPeerContentFingerprint(message);
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  return counts;
}

function migratedDuplicateCountInTarget(migrating: NormalizedHonchoMessage[], target: NormalizedHonchoMessage[]): number {
  const targetCounts = countByPeerContent(target);
  const seenMigrating = new Set<string>();
  let duplicates = 0;
  for (const message of migrating) {
    const fp = normalizedPeerContentFingerprint(message);
    if (seenMigrating.has(fp)) continue;
    seenMigrating.add(fp);
    duplicates += Math.max(0, (targetCounts.get(fp) ?? 0) - 1);
  }
  return duplicates;
}

function duplicateStableFingerprintCount(messages: NormalizedHonchoMessage[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const message of messages) {
    const fp = stableFingerprint(message);
    if (seen.has(fp)) duplicates++;
    else seen.add(fp);
  }
  return duplicates;
}

function countPresentByFingerprint(needles: NormalizedHonchoMessage[], haystack: NormalizedHonchoMessage[]): number {
  const stable = new Set(haystack.map(stableFingerprint));
  const peerContent = new Set(haystack.map(normalizedPeerContentFingerprint));
  return needles.filter((message) => stable.has(stableFingerprint(message)) || peerContent.has(normalizedPeerContentFingerprint(message))).length;
}

function collectAbortReasons(details: HonchoValidationDetails): string[] {
  const reasons: string[] = [];
  if (details.expectedCount !== details.actualTargetCount) reasons.push(`target count mismatch: expected ${details.expectedCount}, got ${details.actualTargetCount}`);
  if (details.expectedHash !== details.actualTargetHash) reasons.push("target content hash mismatch");
  if (!details.sequenceMatches) reasons.push("target peer/content/timestamp sequence mismatch");
  if (details.duplicateCount > 0) reasons.push(`target contains ${details.duplicateCount} duplicate stable fingerprint(s)`);
  // A transcript message can be absent from source Honcho if live upload was delayed,
  // filtered, or previously failed. That is not data loss by itself because the Pi
  // transcript remains the authoritative migration source; only source-owned rows
  // that actually exist in Honcho must be partitioned away from source.
  if ((details.postMigrationSourceMessageCount ?? 0) > 0) reasons.push(`source contains ${details.postMigrationSourceMessageCount} post-migration/unexpected message(s) not present in target`);
  return reasons;
}

function validateNormalizedTargetContent(expectedNormalized: NormalizedHonchoMessage[], actualMessages: any[]): HonchoValidationDetails {
  const actualNormalized = actualMessages.map(normalizeHonchoMessage);
  const details: HonchoValidationDetails = {
    expectedCount: expectedNormalized.length,
    expectedHash: contentHash(expectedNormalized),
    actualTargetCount: actualNormalized.length,
    actualTargetHash: contentHash(actualNormalized),
    duplicateCount: duplicateStableFingerprintCount(actualNormalized),
    sequenceMatches: expectedNormalized.length === actualNormalized.length && expectedNormalized.every((expectedMessage, index) => {
      const actual = actualNormalized[index];
      if (!actual) return false;
      return actual.peerId === expectedMessage.peerId && actual.content === expectedMessage.content && (!actual.createdAt || actual.createdAt === expectedMessage.createdAt);
    }),
    abortReasons: [],
  };
  details.abortReasons = collectAbortReasons(details);
  return details;
}

export function validateHonchoTargetContent(expected: RebuildMessage[], actualMessages: any[]): HonchoValidationDetails {
  return validateNormalizedTargetContent(expected.map(normalizeExpectedMessage), actualMessages);
}

export function alignMigratedPayloadToSource(expectedMessages: RebuildMessage[], sourceMessages: any[]): { messages: RebuildMessage[]; matchedSourceIndexes: number[]; missingCount: number } {
  const source = sourceMessages.map(normalizeHonchoMessage);
  const used = new Set<number>();
  const matchedSourceIndexes: number[] = [];
  let missingCount = 0;
  const messages = expectedMessages.map((message) => {
    const expected = normalizeExpectedMessage(message);
    const sourceIndex = source.findIndex((candidate, index) => !used.has(index) && candidate.peerId === expected.peerId && candidate.content === expected.content);
    if (sourceIndex === -1) {
      missingCount++;
      return message;
    }
    used.add(sourceIndex);
    matchedSourceIndexes.push(sourceIndex);
    const sourceCreatedAt = source[sourceIndex]?.createdAt;
    return sourceCreatedAt ? { ...message, createdAt: sourceCreatedAt, metadata: { ...message.metadata, sourceHonchoCreatedAt: sourceCreatedAt } } : message;
  });
  return { messages, matchedSourceIndexes, missingCount };
}

export function validateHonchoSourceBeforeDelete(params: { expectedMessages: RebuildMessage[]; sourceMessages: any[]; targetMessages: any[]; expectedTargetMessages?: NormalizedHonchoMessage[]; migrationStartedAt?: string }): HonchoValidationDetails {
  const expectedMigrated = params.expectedMessages.map(normalizeExpectedMessage);
  const expectedTarget = params.expectedTargetMessages ?? expectedMigrated;
  const targetDetails = validateNormalizedTargetContent(expectedTarget, params.targetMessages);
  const source = params.sourceMessages.map(normalizeHonchoMessage);
  const target = params.targetMessages.map(normalizeHonchoMessage);
  const sourceOwnedPresentCount = countPresentByFingerprint(expectedMigrated, source);
  const sourceMissingCount = Math.max(0, expectedMigrated.length - sourceOwnedPresentCount);
  const sourceResidualCount = Math.max(0, source.length - sourceOwnedPresentCount);
  const targetStableSet = new Set(target.map(stableFingerprint));
  const targetPeerContentSet = new Set(target.map(normalizedPeerContentFingerprint));
  const migrationStarted = params.migrationStartedAt ? Date.parse(params.migrationStartedAt) : Number.POSITIVE_INFINITY;
  const postMigrationSourceMessageCount = source.filter((message) => {
    const createdAt = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    if (!Number.isFinite(createdAt) || createdAt < migrationStarted) return false;
    return !(targetStableSet.has(stableFingerprint(message)) || targetPeerContentSet.has(normalizedPeerContentFingerprint(message)));
  }).length;
  const details: HonchoValidationDetails = {
    ...targetDetails,
    migratedPayloadCount: expectedMigrated.length,
    migratedPayloadHash: contentHash(expectedMigrated),
    sourceTotalCount: source.length,
    sourceOwnedPresentCount,
    sourceMissingCount,
    sourceResidualCount,
    postMigrationSourceMessageCount,
    abortReasons: [],
  };
  details.abortReasons = collectAbortReasons(details);
  return details;
}

export function buildHonchoDryRunReport(params: { expectedMessages: RebuildMessage[]; sourceMessages: any[]; targetMessages: any[]; sourceExists: boolean; targetExists: boolean; createTarget?: boolean; mergeTarget?: boolean }): { lines: string[]; validation: HonchoValidationDetails; overlapCount: number; transcriptMissingFromSource: number; would: string } {
  const aligned = alignMigratedPayloadToSource(params.expectedMessages, params.sourceMessages);
  const migrating = aligned.messages.map(normalizeExpectedMessage);
  const source = params.sourceMessages.map(normalizeHonchoMessage);
  const target = params.targetMessages.map(normalizeHonchoMessage);
  const targetPeerContent = new Set(target.map(normalizedPeerContentFingerprint));
  const overlapCount = migrating.filter((message) => targetPeerContent.has(normalizedPeerContentFingerprint(message))).length;
  const duplicateMigratedInTarget = migratedDuplicateCountInTarget(migrating, target);
  const toAdd = migrating.filter((message) => !targetPeerContent.has(normalizedPeerContentFingerprint(message)));
  const expectedTarget = params.targetExists ? [...target, ...toAdd] : migrating;
  const validation = validateHonchoSourceBeforeDelete({ expectedMessages: aligned.messages, sourceMessages: params.sourceMessages, targetMessages: expectedTarget, expectedTargetMessages: expectedTarget });
  if (!params.sourceExists) validation.abortReasons.push("source Honcho session does not exist");
  if (params.targetExists && !params.mergeTarget) validation.abortReasons.push("target exists; execution requires --merge or interactive approval");
  if (!params.targetExists && !params.createTarget) validation.abortReasons.push("target missing; execution requires --create or interactive approval");
  if (duplicateMigratedInTarget > 0) validation.abortReasons.push(`target contains ${duplicateMigratedInTarget} duplicate already-migrated message occurrence(s)`);
  const sourceMatchedCount = aligned.matchedSourceIndexes.length;
  const sourceResidualCount = Math.max(0, source.length - sourceMatchedCount);
  validation.sourceTotalCount = source.length;
  validation.sourceOwnedPresentCount = sourceMatchedCount;
  validation.sourceMissingCount = aligned.missingCount;
  validation.sourceResidualCount = sourceResidualCount;
  const would = validation.abortReasons.length > 0 ? "leave source unchanged (execution would abort)" : sourceResidualCount > 0 ? `partition source Honcho, preserving ${sourceResidualCount} residual message(s)` : "delete source Honcho after target validation";
  return {
    validation,
    overlapCount,
    transcriptMissingFromSource: aligned.missingCount,
    would,
    lines: [
      `Source Honcho exists: ${params.sourceExists ? "yes" : "no"}`,
      `Target Honcho exists: ${params.targetExists ? "yes" : "no"}`,
      `Source Honcho messages: ${source.length}`,
      `Target Honcho messages: ${target.length}`,
      `Pi transcript migratable messages: ${params.expectedMessages.length}`,
      `Transcript messages matched in source Honcho: ${sourceMatchedCount}`,
      `Transcript messages missing from source Honcho: ${aligned.missingCount}`,
      `Target already-present migrated messages: ${overlapCount}`,
      `Target migrated duplicate risk: ${duplicateMigratedInTarget}`,
      `Target migrated messages to add: ${toAdd.length}`,
      `Execution approval needed: ${params.targetExists ? (params.mergeTarget ? "none (--merge supplied)" : "--merge") : (params.createTarget ? "none (--create supplied)" : "--create")}`,
      `Source action if executed: ${would}`,
      `Expected final target count: ${expectedTarget.length}`,
      `Expected final target hash: ${contentHash(expectedTarget)}`,
      `Abort reasons: ${validation.abortReasons.length > 0 ? validation.abortReasons.join("; ") : "none"}`,
    ],
  };
}


type SessionEntry = {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp?: string;
  message?: { role?: string; content?: unknown; timestamp?: number };
  [key: string]: unknown;
};

type TurnInfo = {
  turnId: number;
  entryId: string;
  parentId: string | null;
  timestamp: string;
  preview: string;
  text: string;
  relativeTurnId: number;
  eligible: boolean;
  ineligibleReason?: string;
};

type ParsedMoveCommand = {
  kind: "move";
  sessionToken?: string;
  targetDir?: string;
  turnRef?: string;
  splitRequested: boolean;
  continuePolicy?: "source" | "target";
  dryRun: boolean;
  createTarget?: boolean;
  mergeTarget?: boolean;
};

type ParsedTurnsCommand = {
  kind: "turns";
  sessionToken?: string;
  query?: string;
  json: boolean;
  pick: boolean;
};

type ParsedSplitCommand = {
  kind: "split";
  sessionToken?: string;
  turnRef?: string;
  continuePart?: "head" | "tail";
  dryRun: boolean;
};

type ParsedSessionSubcommand = ParsedMoveCommand | ParsedTurnsCommand | ParsedSplitCommand;

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  for (const ch of input.trim()) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (escaped) current += "\\";
  if (quote) throw new Error(`Unclosed quote in command arguments.`);
  if (current) tokens.push(current);
  return tokens;
}

function looksLikeSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  if (token === "current") return true;
  if (token.endsWith(".jsonl")) return true;
  if (token.startsWith("~") || token.startsWith("/") || token.startsWith(".")) return true;
  // Session ids are UUID-ish or short hex-ish prefixes; natural-language queries usually are not.
  return /^[a-f0-9-]{6,}$/i.test(token);
}

export function parseSessionSubcommand(args: string): ParsedSessionSubcommand {
  const tokens = tokenizeArgs(args);
  const [subcommand] = tokens;
  if (subcommand === "turns") {
    let sessionToken: string | undefined;
    let json = false;
    let pick = false;
    const positional: string[] = [];
    for (const token of tokens.slice(1)) {
      if (token === "--json") { json = true; continue; }
      if (token === "--pick") { pick = true; continue; }
      positional.push(token);
    }
    if (looksLikeSessionToken(positional[0])) sessionToken = positional.shift()!;
    const query = positional.join(" ").trim() || undefined;
    return { kind: "turns", sessionToken, query, json, pick };
  }

  if (subcommand === "split") {
    let sessionToken: string | undefined;
    let dryRun = false;
    let continuePart: ParsedSplitCommand["continuePart"];
    let explicitTurnRef: string | undefined;
    const positional: string[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "--dry-run") { dryRun = true; continue; }
      if (token === "--continue") {
        const policy = tokens[++i];
        if (policy !== "head" && policy !== "tail") throw new Error("--continue must be one of: head, tail");
        continuePart = policy;
        continue;
      }
      if (token === "--turn") {
        const value = tokens[++i];
        if (!value) continue;
        explicitTurnRef = value;
        continue;
      }
      positional.push(token);
    }
    if (looksLikeSessionToken(positional[0])) sessionToken = positional.shift()!;
    const turnRef = explicitTurnRef ?? (positional.length > 0 ? positional.join(" ").trim() : undefined);
    return { kind: "split", sessionToken, turnRef, continuePart, dryRun };
  }

  if (subcommand === "move") {
    let sessionToken: string | undefined;
    let targetDir: string | undefined;
    let dryRun = false;
    let splitRequested = false;
    let createTarget = false;
    let mergeTarget = false;
    let continuePolicy: ParsedMoveCommand["continuePolicy"];
    const positional: string[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "--dry-run") { dryRun = true; continue; }
      if (token === "--create") { createTarget = true; continue; }
      if (token === "--merge") { mergeTarget = true; continue; }
      if (token === "--split" || token === "--turn") {
        throw new Error("Split is now a separate command. Use /session split [session] [--turn <turn>] [--continue head|tail].");
      }
      if (token === "--continue") {
        throw new Error("--continue is only valid for /session split. Use --continue head|tail there.");
      }
      positional.push(token);
    }
    if (positional.length >= 2) sessionToken = positional.shift();
    targetDir = positional.shift();
    if (positional.length > 0) throw new Error(`Unexpected extra argument(s) for /session move: ${positional.join(" ")}`);
    return { kind: "move", sessionToken, targetDir, splitRequested, continuePolicy, dryRun, createTarget, mergeTarget };
  }

  throw new Error("Usage: /session turns [session] [query...] [--json] [--pick] | /session split [session] [--turn <turn-ref>] [--continue head|tail] [--dry-run] | /session move [session] <target-dir> [--create] [--merge] [--dry-run]");
}
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((block) => {
    if (block && typeof block === "object" && "text" in block && typeof (block as any).text === "string") return (block as any).text;
    if (block && typeof block === "object" && "type" in block) return `[${String((block as any).type)}]`;
    return "";
  }).filter(Boolean).join(" ");
  return "";
}

function buildTurnList(entries: SessionEntry[]): TurnInfo[] {
  let turnId = 0;
  const turns: TurnInfo[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    turnId += 1;
    const text = messageText(entry.message.content).replace(/\s+/g, " ").trim();
    turns.push({
      turnId,
      entryId: entry.id,
      parentId: entry.parentId ?? null,
      timestamp: entry.timestamp ?? new Date(entry.message.timestamp ?? Date.now()).toISOString(),
      text,
      preview: text.length > 100 ? `${text.slice(0, 97)}...` : text,
      relativeTurnId: 0,
      eligible: true,
    });
  }
  return turns.map((turn, index) => ({
    ...turn,
    relativeTurnId: index - turns.length,
    eligible: index !== 0 && index !== turns.length - 1,
    ineligibleReason: index === 0 ? "would create empty source" : index === turns.length - 1 ? "would create empty target" : undefined,
  }));
}

function resolveTurnRef(turns: TurnInfo[], rawRef: string, options: { requireEligible?: boolean } = {}): TurnInfo {
  const ref = stripWrappingQuotes(rawRef.trim());
  if (!ref) throw new Error("Turn reference is empty.");
  const numeric = Number(ref);
  let resolved: TurnInfo | undefined;
  if (Number.isInteger(numeric)) {
    if (ref.startsWith("-")) {
      const idx = turns.length + numeric;
      resolved = turns[idx];
      if (!resolved) throw new Error(`Relative turn reference out of range: ${ref}`);
    } else {
      resolved = turns.find((turn) => turn.turnId === numeric);
      if (!resolved) throw new Error(`Turn id not found: ${ref}`);
    }
  } else {
    const entryMatches = turns.filter((turn) => turn.entryId === ref || turn.entryId.startsWith(ref));
    if (entryMatches.length === 1) resolved = entryMatches[0];
    else if (entryMatches.length > 1) throw new Error(`Turn entry id prefix is ambiguous (${entryMatches.length} matches): ${ref}`);
  }

  if (!resolved) {
    const needle = ref.toLowerCase();
    const substringMatches = turns.filter((turn) => turn.text.toLowerCase().includes(needle));
    if (substringMatches.length === 1) resolved = substringMatches[0];
    else if (substringMatches.length > 1) throw new Error(`Turn reference is ambiguous (${substringMatches.length} substring matches): ${ref}`);
  }

  if (!resolved) {
    const needle = ref.toLowerCase();
    const words = needle.split(/\W+/).filter((word) => word.length >= 3);
    if (words.length === 0) throw new Error(`No turn matched: ${ref}`);
    const scored = turns.map((turn) => ({ turn, score: words.filter((word) => turn.text.toLowerCase().includes(word)).length }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.turn.turnId - a.turn.turnId);
    if (scored.length === 0) throw new Error(`No turn matched: ${ref}`);
    if (scored.length > 1 && scored[0].score === scored[1].score) throw new Error(`Turn reference is ambiguous; best score ${scored[0].score} matched multiple turns.`);
    resolved = scored[0].turn;
  }

  if (options.requireEligible && !resolved.eligible) {
    throw new Error(`Turn ${resolved.turnId} is not an eligible split target: ${resolved.ineligibleReason ?? "ineligible"}.`);
  }
  return resolved;
}

function formatTurns(turns: TurnInfo[], dim: (text: string) => string = (text) => text): string {
  if (turns.length === 0) return "No user-message turns found.";
  const header = "Turn  Rel   Entry     Eligible  Time                  Preview";
  const rows = turns.map((turn) => {
    const row = [
      String(turn.turnId).padStart(4, " "),
      String(turn.relativeTurnId).padStart(4, " "),
      turn.entryId.padEnd(8, " "),
      (turn.eligible ? "yes" : "no").padEnd(8, " "),
      turn.timestamp.slice(0, 19).replace("T", " "),
      turn.preview,
      turn.ineligibleReason ? `# ${turn.ineligibleReason}` : "",
    ].filter(Boolean).join("  ");
    return turn.eligible ? row : dim(row);
  });
  return [header, ...rows].join("\n");
}

function turnLabel(turn: TurnInfo): string {
  return `Turn ${String(turn.turnId).padStart(3, "0")}  ${turn.entryId}${turn.eligible ? "" : "  (ineligible)"}`;
}

async function showTurnDetailOverlay(turn: TurnInfo, ctx: any): Promise<void> {
  const detailLines = [
    `Turn ${turn.turnId} (${turn.relativeTurnId})`,
    `entryId: ${turn.entryId}`,
    `parentId: ${turn.parentId ?? "null"}`,
    `timestamp: ${turn.timestamp}`,
    `eligible split target: ${turn.eligible ? "yes" : "no"}`,
    ...(turn.ineligibleReason ? [`reason: ${turn.ineligibleReason}`] : []),
    "",
    turn.text,
  ];
  await ctx.ui.custom<void>((_tui: any, theme: any, _keybindings: any, done: () => void) => {
    const container = new Container();
    const accent = (text: string) => theme.fg("accent", text);
    container.addChild(new DynamicBorder(accent));
    container.addChild(new Text(accent(theme.bold("Turn Detail")), 1, 0));
    container.addChild(new Text(detailLines.join("\n"), 1, 0));
    container.addChild(new Text(theme.fg("dim", "esc close"), 1, 0));
    container.addChild(new DynamicBorder(accent));
    return {
      render(width: number) { return container.render(width); },
      invalidate() { container.invalidate(); },
      handleInput(_data: string) { done(); },
    };
  }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center", margin: 2 } });
}

async function showTurnsOverlay(turns: TurnInfo[], sessionLabel: string, ctx: any): Promise<void> {
  if (turns.length === 0) {
    ctx.ui.notify("No user-message turns found.", "info");
    return;
  }

  const items: SelectItem[] = turns.map((turn) => ({
    value: String(turn.turnId),
    label: `${turn.eligible ? " " : "·"} ${turnLabel(turn)}`,
    description: `${turn.timestamp}  ${turn.preview}${turn.ineligibleReason ? `  — ${turn.ineligibleReason}` : ""}`,
  }));

  await ctx.ui.custom<string | null>((tui: any, theme: any, _keybindings: any, done: (value: string | null) => void) => {
    const container = new Container();
    const accent = (text: string) => theme.fg("accent", text);
    container.addChild(new DynamicBorder(accent));
    container.addChild(new Text(accent(theme.bold("Session Turns")), 1, 0));
    container.addChild(new Text(theme.fg("dim", sessionLabel), 1, 0));

    const list = new SelectList(items, Math.min(turns.length, 18), {
      selectedPrefix: accent,
      selectedText: (text: string) => text.includes("(ineligible)") ? theme.fg("dim", text) : accent(text),
      description: (text: string) => text.includes("would create empty") ? theme.fg("dim", text) : theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    }, {
      minPrimaryColumnWidth: 20,
      maxPrimaryColumnWidth: 28,
      truncatePrimary: ({ text, maxWidth, isSelected }: any) => {
        const turnMatch = text.match(/^(Turn\s+\d+)/);
        if (!turnMatch) return truncateToWidth(text, maxWidth, "…");
        const emphasized = theme.bold(turnMatch[1]) + text.slice(turnMatch[1].length);
        return isSelected ? truncateToWidth(emphasized, maxWidth, "…") : truncateToWidth(emphasized, maxWidth, "…");
      },
    });

    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter show entry id • esc close"), 1, 0));
    container.addChild(new DynamicBorder(accent));

    return {
      render(width: number) { return container.render(width); },
      invalidate() { container.invalidate(); },
      handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
    };
  }, {
    overlay: true,
    overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center", margin: 2 },
  }).then(async (selectedTurnId: string | null | undefined) => {
    if (!selectedTurnId) return;
    const selected = turns.find((turn) => String(turn.turnId) === selectedTurnId);
    if (!selected) return;
    await showTurnDetailOverlay(selected, ctx);
  });
}

async function pickSplitTurn(turns: TurnInfo[], ctx: any): Promise<TurnInfo | undefined> {
  const eligibleTurns = turns.filter((turn) => turn.eligible);
  if (eligibleTurns.length === 0) throw new Error("No eligible split turns found.");
  const selected = await ctx.ui.select("Pick split turn:", eligibleTurns.map((turn) => `${turn.turnId} (${turn.relativeTurnId}) ${turn.entryId} — ${turn.preview}`));
  if (!selected) return undefined;
  const id = selected.split(" ")[0];
  return eligibleTurns.find((turn) => String(turn.turnId) === id);
}

async function loadEntriesForToken(token: string | undefined, ctx: any): Promise<{ sessionFile?: string; entries: SessionEntry[] }> {
  if (!token || token === "current") {
    return { sessionFile: ctx.sessionManager.getSessionFile(), entries: ctx.sessionManager.getBranch() as SessionEntry[] };
  }
  const sessionFile = await findSession(token);
  if (!sessionFile) throw new Error(`Pi session not found: ${token}`);
  const sessionManager = await SessionManager.open(sessionFile);
  return { sessionFile, entries: sessionManager.getBranch() as SessionEntry[] };
}

async function showTurns(parsed: ParsedTurnsCommand, ctx: any) {
  const { sessionFile, entries } = await loadEntriesForToken(parsed.sessionToken, ctx);
  const turns = buildTurnList(entries);
  const sessionLabel = `Session turns (${sessionFile ?? "current in-memory session"})`;
  if (parsed.query) {
    const resolved = resolveTurnRef(turns, parsed.query);
    const payload = {
      turnId: resolved.turnId,
      relativeTurnId: resolved.relativeTurnId,
      entryId: resolved.entryId,
      parentId: resolved.parentId,
      eligible: resolved.eligible,
      ineligibleReason: resolved.ineligibleReason,
      session: sessionFile ?? "current in-memory session",
      preview: resolved.preview,
    };
    ctx.ui.notify(parsed.json ? JSON.stringify(payload, null, 2) : [
      `Resolved turn ${parsed.query}:`,
      `turnId: ${resolved.turnId}`,
      `relativeTurnId: ${resolved.relativeTurnId}`,
      `entryId: ${resolved.entryId}`,
      `eligible: ${resolved.eligible ? "yes" : `no (${resolved.ineligibleReason})`}`,
      `session: ${sessionFile ?? "current in-memory session"}`,
      `preview: ${resolved.preview}`,
    ].join("\n"), "info");
    return;
  }
  if (parsed.json) {
    ctx.ui.notify(JSON.stringify({ session: sessionFile ?? "current in-memory session", turns }, null, 2), "info");
    return;
  }
  if (parsed.pick && ctx.mode === "tui") {
    await showTurnsOverlay(turns, sessionLabel, ctx);
    return;
  }
  const dim = ctx.mode === "tui" && ctx.ui.theme ? (text: string) => ctx.ui.theme.fg("dim", text) : (text: string) => text;
  ctx.ui.notify([`${sessionLabel}:`, formatTurns(turns, dim)].join("\n"), "info");
}

async function handleTurnsCommand(args: string, ctx: any) {
  const parsed = parseSessionSubcommand(`turns ${args ?? ""}`);
  if (parsed.kind !== "turns") throw new Error("Internal parser error.");
  await showTurns(parsed, ctx);
}

function filterCompletionItems(items: AutocompleteItem[], prefix: string): AutocompleteItem[] {
  const needle = prefix.toLowerCase();
  return items.filter((item) => item.value.toLowerCase().startsWith(needle) || item.label.toLowerCase().includes(needle));
}

function currentTokenPrefix(value: string): string {
  const match = value.match(/(?:^|\s)(\S*)$/);
  return match?.[1] ?? "";
}

function staticSessionCompletions(argumentText: string): AutocompleteSuggestions | null {
  const hasTrailingSpace = /\s$/.test(argumentText);
  const tokens = argumentText.trim().split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? "";
  const prefix = hasTrailingSpace ? "" : currentTokenPrefix(argumentText);

  if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingSpace)) {
    const items = filterCompletionItems([
      { value: "move", label: "move", description: "Move a session to a directory scope" },
      { value: "split", label: "split", description: "Split a session into head/tail parts" },
      { value: "turns", label: "turns", description: "List, pick, or resolve user-message turn ids" },
    ], prefix);
    return items.length > 0 ? { items, prefix } : null;
  }

  if (first === "move") {
    const position = tokens.length - 1 + (hasTrailingSpace ? 1 : 0);
    const items: AutocompleteItem[] = [];
    if (position === 1) items.push({ value: "current", label: "current", description: "Optional; omitted means active session" });
    else if (position >= 2) {
      if (!tokens.includes("--create")) items.push({ value: "--create", label: "--create", description: "Approve creating a missing target Honcho session" });
      if (!tokens.includes("--merge")) items.push({ value: "--merge", label: "--merge", description: "Approve merging into an existing target Honcho session" });
      if (!tokens.includes("--dry-run")) items.push({ value: "--dry-run", label: "--dry-run", description: "Parse and resolve only; do not mutate" });
    }
    const filtered = filterCompletionItems(items, prefix);
    return filtered.length > 0 ? { items: filtered, prefix } : null;
  }

  if (first === "split") {
    const position = tokens.length - 1 + (hasTrailingSpace ? 1 : 0);
    const items: AutocompleteItem[] = [];
    if (position === 1) items.push(
      { value: "current", label: "current", description: "Optional; omitted means active session" },
      { value: "--turn", label: "--turn", description: "Provide turn id, entry id, or query; omitted opens picker in TUI" },
    );
    else {
      if (!tokens.includes("--turn")) items.push({ value: "--turn", label: "--turn", description: "Provide turn id, entry id, or query; omitted opens picker in TUI" });
      if (!tokens.includes("--continue")) items.push({ value: "--continue", label: "--continue", description: "Continuation part: head or tail" });
      if (!tokens.includes("--dry-run")) items.push({ value: "--dry-run", label: "--dry-run", description: "Parse and resolve only; do not mutate" });
      if (tokens[tokens.length - 1] === "--continue") {
        items.length = 0;
        items.push(
          { value: "tail", label: "tail", description: "Part 2: split turn and after (default)" },
          { value: "head", label: "head", description: "Part 1: before split turn" },
        );
      }
    }
    const filtered = filterCompletionItems(items, prefix);
    return filtered.length > 0 ? { items: filtered, prefix } : null;
  }

  if (first === "turns") {
    const position = tokens.length - 1 + (hasTrailingSpace ? 1 : 0);
    const items: AutocompleteItem[] = [];
    if (position === 1) items.push(
      { value: "current", label: "current", description: "The active session" },
      { value: "--pick", label: "--pick", description: "Open the TUI turn picker" },
      { value: "--json", label: "--json", description: "Emit machine-readable turn data" },
    );
    else {
      if (!tokens.includes("--pick")) items.push({ value: "--pick", label: "--pick", description: "Open the TUI turn picker" });
      if (!tokens.includes("--json")) items.push({ value: "--json", label: "--json", description: "Emit machine-readable turn data" });
    }
    const filtered = filterCompletionItems(items, prefix);
    return filtered.length > 0 ? { items: filtered, prefix } : null;
  }

  return null;
}

function createSessionAutocompleteProvider(current: AutocompleteProvider): AutocompleteProvider {
  return {
    triggerCharacters: ["/", " "],
    async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
      const line = lines[cursorLine] ?? "";
      const beforeCursor = line.slice(0, cursorCol);
      const match = beforeCursor.match(/^\/session\s+(.*)$/);
      if (!match) return current.getSuggestions(lines, cursorLine, cursorCol, options);
      const suggestions = staticSessionCompletions(match[1] ?? "");
      return suggestions ?? current.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const line = lines[cursorLine] ?? "";
      const beforeCursor = line.slice(0, cursorCol);
      if (/^\/session\s+/.test(beforeCursor)) return false;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

function moveHelpText(): string {
  return [
    "Usage:",
    "  /session move [session] <target-dir> [--create] [--merge] [--dry-run]",
    "  /session:move [session] <target-dir> [--create] [--merge] [--dry-run]",
    "Notes:",
    "  If [session] is omitted, the current session is moved.",
    "  Splitting is a separate command: /session split [session] [--turn <turn>] [--continue head|tail].",
    "Examples:",
    "  /session move ~/dev/pi-extensions --dry-run",
    "  /session move 019f4e16 ~/dev/pi-extensions --create",
  ].join("\n");
}

async function resolveSessionFileForMove(token: string | undefined, ctx: any): Promise<{ sessionFile: string; isCurrent: boolean }> {
  const active = ctx.sessionManager.getSessionFile();
  if (!token || token === "current") {
    if (!active) throw new Error("Current Pi session is not persisted; cannot move it.");
    return { sessionFile: active, isCurrent: true };
  }
  const sessionFile = await findSession(token);
  if (!sessionFile) throw new Error(`Pi session not found: ${token}`);
  const isCurrent = Boolean(active && await realpath(sessionFile).catch(() => sessionFile) === await realpath(active).catch(() => active));
  if (isCurrent) throw new Error("The resolved session is active. Use the literal token 'current' to move the active session.");
  return { sessionFile, isCurrent: false };
}

async function ensureDirectoryForMove(targetDir: string, ctx: any, dryRun: boolean): Promise<void> {
  try {
    const st = await stat(targetDir);
    if (!st.isDirectory()) throw new Error(`${targetDir} is not a directory.`);
  } catch (error) {
    if (dryRun) return;
    const ok = await ctx.ui.confirm("Create target directory?", `Target directory does not exist:\n${targetDir}`);
    if (!ok) throw new Error("Move cancelled: target directory does not exist.");
    await mkdir(targetDir, { recursive: true });
  }
}

export async function writeManifest(manifestFile: string, manifest: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  const next = { ...manifest, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(manifestFile, JSON.stringify(next, null, 2), "utf8");
  Object.assign(manifest, next);
}

export async function createMoveManifest(params: { sessionFile: string; destFile: string; sourceCwd: string; targetDir: string; operation: "move"; dryRun: boolean; sourceHonchoKey?: string; targetHonchoKey?: string }) {
  const createdAt = new Date().toISOString();
  const migrationId = `${createdAt.replace(/[:.]/g, "-")}_${hash(`${params.sessionFile}:${params.destFile}`)}`;
  const migrationDir = join(MIGRATION_ROOT, migrationId);
  const manifestFile = join(migrationDir, "manifest.json");
  const backupFile = join(migrationDir, basename(params.sessionFile));
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    migrationId,
    operation: params.operation,
    status: "planned",
    createdAt,
    updatedAt: createdAt,
    sourceSessionFile: params.sessionFile,
    targetSessionFile: params.destFile,
    sourceCwd: params.sourceCwd,
    targetCwd: params.targetDir,
    sourceHonchoKey: params.sourceHonchoKey,
    targetHonchoKey: params.targetHonchoKey,
    backups: params.dryRun ? [] : [{ role: "source-original", path: backupFile }],
    recovery: { notes: [`Pi backup: ${backupFile}`, `If Pi write completed, resume with: pi --session ${params.destFile}`] },
  };
  if (!params.dryRun) {
    await mkdir(migrationDir, { recursive: true });
    await writeManifest(manifestFile, manifest);
    await copyFile(params.sessionFile, backupFile);
    await writeManifest(manifestFile, manifest, { status: "pi_backed_up" });
  }
  return { migrationId, migrationDir, manifestFile, backupFile, manifest };
}

async function completeMoveCommand(parsed: ParsedMoveCommand, ctx: any): Promise<ParsedMoveCommand | null> {
  if (parsed.targetDir) return parsed;
  if (!ctx.hasUI) {
    ctx.ui.notify(moveHelpText(), "warning");
    return null;
  }
  const next: ParsedMoveCommand = { ...parsed };
  const target = await ctx.ui.input("Target path:", "~/target-project");
  if (!target) return null;
  next.targetDir = target;
  return next;
}

function quoteCommandArg(value: string): string {
  return /^[^\s"'`\\]+$/.test(value) ? value : JSON.stringify(value);
}

function formatMoveCommand(parsed: ParsedMoveCommand, command = "/session:move"): string {
  const parts = [command];
  if (parsed.sessionToken) parts.push(quoteCommandArg(parsed.sessionToken));
  if (parsed.targetDir) parts.push(quoteCommandArg(parsed.targetDir));
  if (parsed.createTarget) parts.push("--create");
  if (parsed.mergeTarget) parts.push("--merge");
  if (parsed.dryRun) parts.push("--dry-run");
  return parts.join(" ");
}

export async function runSessionMutationSafetyGate(params: { ctx: any; sessionFile: string; isCurrent: boolean; operation: "move" | "split"; dryRun?: boolean }) {
  const checkedAt = new Date().toISOString();
  if (params.dryRun) return { checkedAt, skipped: true, reason: "dry-run" };
  if (typeof params.ctx.waitForIdle !== "function") {
    throw new Error(`${params.operation} requires Pi idle/quiescence support before mutating sessions. Re-run from Pi command context after all work is idle.`);
  }
  await params.ctx.waitForIdle();
  if (params.ctx.hasPendingMessages?.()) throw new Error(`Cannot ${params.operation} while Pi has pending messages.`);
  // Honcho uploads are asynchronous after agent_end; use a bounded quiescence window for all mutating calls.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (params.ctx.hasPendingMessages?.()) throw new Error(`Cannot ${params.operation}: messages became pending during quiescence window.`);
  return { checkedAt, skipped: false, operation: params.operation, sessionFile: params.sessionFile, isCurrent: params.isCurrent };
}

async function executeMoveCommand(parsed: ParsedMoveCommand, ctx: any, options: { rerouteCurrentToCommand?: (command: string) => Promise<void> } = {}): Promise<void> {
  const completed = await completeMoveCommand(parsed, ctx);
  if (!completed) return;
  parsed = completed;
  if (!parsed.targetDir) throw new Error(moveHelpText());
  const { sessionFile, isCurrent } = await resolveSessionFileForMove(parsed.sessionToken, ctx);
  const { header, lines } = await readHeader(sessionFile);
  const targetDir = resolveTargetDir(parsed.targetDir, ctx.cwd);
  const destFile = join(piWorkspaceDir(targetDir), basename(sessionFile));

  if (parsed.turnRef) {
    const sessionManager = isCurrent ? null : await SessionManager.open(sessionFile);
    const entries = (isCurrent ? ctx.sessionManager.getBranch() : sessionManager!.getBranch()) as SessionEntry[];
    const resolved = resolveTurnRef(buildTurnList(entries), parsed.turnRef, { requireEligible: true });
    ctx.ui.notify([
      "Parsed split move command (dry-run only until the split + memory rebuild engine is wired).",
      `session: ${parsed.sessionToken} (${sessionFile})`,
      `targetDir: ${targetDir}`,
      `splitTurnRef: ${parsed.turnRef}`,
      `splitTurnId: ${resolved.turnId}`,
      `splitEntryId: ${resolved.entryId}`,
      `continue: ${parsed.continuePolicy ?? "(prompt if current; otherwise unspecified)"}`,
    ].join("\n"), "info");
    return;
  }

  await ensureDirectoryForMove(targetDir, ctx, parsed.dryRun);
  const targetPiWorkspace = piWorkspaceDir(targetDir);
  if (!parsed.dryRun && !existsSync(targetPiWorkspace)) await mkdir(targetPiWorkspace, { recursive: true });
  if (existsSync(destFile)) {
    const sameFile = await realpath(sessionFile).catch(() => sessionFile) === await realpath(destFile).catch(() => destFile);
    if (sameFile) {
      const message = `Session is already at target path: ${destFile}`;
      if (isCurrent && typeof ctx.switchSession === "function") {
        const result = await ctx.switchSession(destFile, { withSession: async (newCtx: any) => newCtx.ui.notify(message, "info") });
        if (result?.cancelled) ctx.ui.notify(`${message}\nSwitch was cancelled. Resume manually with: pi --session ${destFile}`, "warning");
        return;
      }
      ctx.ui.notify(message, "info");
      return;
    }
    throw new Error(`Target Pi session file already exists: ${destFile}`);
  }

  const cfg = JSON.parse(await readFile(HONCHO_CONFIG, "utf8")) as HonchoConfig;
  const runtime = honchoRuntimeConfig(cfg);
  const fromHonchoKey = await deriveHonchoSessionKey(String(header.cwd), cfg);
  const toHonchoKey = await deriveHonchoSessionKey(targetDir, cfg);
  const entries = isCurrent ? ctx.sessionManager.getBranch() as SessionEntry[] : (await SessionManager.open(sessionFile)).getBranch() as SessionEntry[];

  if (!parsed.dryRun) {
    if (isCurrent && typeof ctx.switchSession !== "function") {
      if (options.rerouteCurrentToCommand) {
        await options.rerouteCurrentToCommand(formatMoveCommand(parsed, "/session:move"));
        return;
      }
      throw new Error("Current-session move requires Pi command context. Recovery: run " + formatMoveCommand(parsed, "/session:move"));
    }
    await runSessionMutationSafetyGate({ ctx, sessionFile, isCurrent, operation: "move", dryRun: parsed.dryRun });
  }

  const dryRunMigrationId = `dry-run_${hash(`${sessionFile}:${destFile}`)}`;
  const rebuildMessages = buildWholeSessionRebuildMessages({ header, entries, sessionFile, migrationId: dryRunMigrationId, config: cfg });

  if (fromHonchoKey === toHonchoKey) throw new Error(`Source and target Honcho session keys are identical: ${fromHonchoKey}`);
  const { Honcho } = await import(HONCHO_SDK);
  const honcho = new Honcho({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseURL,
    workspaceId: runtime.workspaceId,
    environment: runtime.environment,
  });

  if (parsed.dryRun) {
    let honchoLines: string[];
    try {
      const [sourceExists, targetExists] = await Promise.all([
        honchoSessionExists(honcho, fromHonchoKey),
        honchoSessionExists(honcho, toHonchoKey),
      ]);
      const [sourceMessages, targetMessages] = await Promise.all([
        sourceExists ? fetchHonchoMessages(honcho, fromHonchoKey) : Promise.resolve([]),
        targetExists ? fetchHonchoMessages(honcho, toHonchoKey) : Promise.resolve([]),
      ]);
      honchoLines = buildHonchoDryRunReport({ expectedMessages: rebuildMessages, sourceMessages, targetMessages, sourceExists, targetExists, createTarget: parsed.createTarget, mergeTarget: parsed.mergeTarget }).lines;
    } catch (error) {
      honchoLines = [`Honcho read-only inspection failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    ctx.ui.notify([
      "Dry run: whole-session move preflight (no Pi or Honcho mutations).",
      `current: ${isCurrent ? "yes" : "no"}`,
      `Pi: ${sessionFile}`,
      ` -> ${destFile}`,
      `Header cwd: ${header.cwd}`,
      ` -> ${targetDir}`,
      `Honcho workspace: ${runtime.workspaceId}`,
      `Honcho baseURL: ${runtime.baseURL ?? "(default)"}`,
      `Memory: ${fromHonchoKey}`,
      ` -> ${toHonchoKey}`,
      `Transcript rebuild messages: ${rebuildMessages.length}`,
      `Transcript rebuild hash: ${hashRebuildMessages(rebuildMessages)}`,
      "",
      "Honcho read-only comparison:",
      ...honchoLines,
    ].join("\n"), "info");
    return;
  }

  const sourceExists = await honchoSessionExists(honcho, fromHonchoKey);
  const targetExists = await honchoSessionExists(honcho, toHonchoKey);
  if (!sourceExists && !(targetExists && parsed.mergeTarget)) throw new Error(`Source Honcho session does not exist: ${fromHonchoKey}`);
  if (targetExists && !parsed.mergeTarget) {
    if (!ctx.hasUI) throw new Error(`Target Honcho session exists: ${toHonchoKey}. Re-run with --merge to approve preserving existing target messages and adding this session.`);
    const mergeOk = await ctx.ui.confirm("Merge into existing Honcho session?", `Target Honcho session exists:\n${toHonchoKey}\n\nExisting messages will be preserved and moved messages will be added only after duplicate checks pass.`);
    if (!mergeOk) return;
    parsed.mergeTarget = true;
  }
  if (!targetExists && !parsed.createTarget) {
    if (!ctx.hasUI) throw new Error(`Target Honcho session does not exist: ${toHonchoKey}. Re-run with --create to approve creating it.`);
    const createOk = await ctx.ui.confirm("Create target Honcho session?", `Target Honcho session does not exist:\n${toHonchoKey}\n\nA new target memory session will be created.`);
    if (!createOk) return;
    parsed.createTarget = true;
  }

  const ok = await ctx.ui.confirm("Move session?", [
    `Pi: ${sessionFile}`,
    ` -> ${destFile}`,
    `Header cwd: ${header.cwd}`,
    ` -> ${targetDir}`,
    `Memory: ${fromHonchoKey}`,
    ` -> ${toHonchoKey}`,
    targetExists ? "Target Honcho exists: preserve + merge approved." : "Target Honcho missing: create approved.",
    `Will migrate ${rebuildMessages.length} Honcho message(s) at the target, move/switch Pi, then delete or partition source memory after revalidation.`,
    isCurrent ? "Will switch this Pi process to the moved session file after writing." : "",
  ].filter(Boolean).join("\n"));
  if (!ok) return;

  const migration = await createMoveManifest({ sessionFile, destFile, sourceCwd: String(header.cwd), targetDir, operation: "move", dryRun: false, sourceHonchoKey: fromHonchoKey, targetHonchoKey: toHonchoKey });
  const log = [`manifest: ${migration.manifestFile}`];
  try {
    const migrationStartedAt = new Date().toISOString();
    const transcriptMessages = buildWholeSessionRebuildMessages({ header, entries, sessionFile, migrationId: migration.migrationId, config: cfg });
    const sourceMessagesBeforeTargetWrite = await fetchHonchoMessagesIfExists(honcho, fromHonchoKey) ?? [];
    const aligned = alignMigratedPayloadToSource(transcriptMessages, sourceMessagesBeforeTargetWrite);
    const messages = aligned.messages;
    const sourceBackupFile = join(migration.migrationDir, "source-honcho-backup.json");
    const targetWrite = await writeHonchoTargetFromTranscript({ honcho, key: toHonchoKey, sourceKey: fromHonchoKey, config: cfg, messages, migrationId: migration.migrationId, sourceCwd: String(header.cwd), targetCwd: targetDir, mergeTarget: parsed.mergeTarget });
    await writeManifest(migration.manifestFile, migration.manifest, {
      status: "honcho_target_written",
      honchoValidation: targetWrite.validation,
      honchoTargetCount: targetWrite.count,
      honchoTargetHash: targetWrite.hash,
      honchoExpectedCount: targetWrite.validation.expectedCount,
      honchoExpectedHash: targetWrite.validation.expectedHash,
      honchoDuplicateCount: targetWrite.validation.duplicateCount,
      honchoPreexistingTargetCount: targetWrite.validation.preexistingTargetCount,
      honchoMigratedPayloadCount: targetWrite.validation.migratedPayloadCount,
      honchoTranscriptMessagesMissingFromSource: aligned.missingCount,
    });
    log.push(`rebuilt target Honcho session ${toHonchoKey} (${targetWrite.count} messages)`);

    const cleanupHonchoSource = async () => {
      const deleteValidation = await validateHonchoSessionsBeforeSourceDelete({ honcho, sourceKey: fromHonchoKey, targetKey: toHonchoKey, expectedTargetCount: targetWrite.count, expectedMessages: messages, expectedTargetMessages: targetWrite.expectedTargetMessages, migrationStartedAt });
      await writeManifest(migration.manifestFile, migration.manifest, { status: "honcho_predelete_validated", honchoValidation: deleteValidation, honchoAbortReasons: deleteValidation.abortReasons, sourceHonchoBackup: sourceBackupFile });
      if (deleteValidation.abortReasons.length > 0) throw Object.assign(new Error(`Refusing to alter source Honcho: ${deleteValidation.abortReasons.join("; ")}`), { validation: deleteValidation });
      const finalSourceValidation = await finalizeHonchoSourceAfterTargetValidated({ honcho, sourceKey: fromHonchoKey, targetKey: toHonchoKey, config: cfg, expectedTargetCount: targetWrite.count, expectedMessages: messages, expectedTargetMessages: targetWrite.expectedTargetMessages, migrationStartedAt, sourceBackupFile });
      await writeManifest(migration.manifestFile, migration.manifest, { status: finalSourceValidation.sourceResidualCount && finalSourceValidation.sourceResidualCount > 0 ? "honcho_source_partitioned" : "honcho_source_deleted", honchoValidation: finalSourceValidation, sourceHonchoBackup: sourceBackupFile });
      log.push(`deleted or partitioned source Honcho session ${fromHonchoKey}`);
    };

    const newHeader = { ...header, cwd: targetDir };
    lines[0] = JSON.stringify(newHeader);
    await writeFile(sessionFile, lines.join("\n"), "utf8");
    await mkdir(dirname(destFile), { recursive: true });
    await rename(sessionFile, destFile);
    await writeManifest(migration.manifestFile, migration.manifest, { status: "pi_written" });
    log.push(`moved Pi session to ${destFile}`);

    if (isCurrent) {
      await writeManifest(migration.manifestFile, migration.manifest, { status: "pi_written_pending_source_cleanup", recovery: { notes: [`Pi session moved and target Honcho validated. Resume manually with: pi --session ${destFile}`, `Source Honcho cleanup is pending and should be retried only after revalidation: ${fromHonchoKey}`] } });
      try {
        const result = await ctx.switchSession(destFile, { withSession: async (newCtx: any) => {
          try {
            await cleanupHonchoSource();
            await writeManifest(migration.manifestFile, migration.manifest, { status: "complete" });
            newCtx.ui.notify(log.join("\n"), "info");
          } catch (cleanupError) {
            await writeManifest(migration.manifestFile, migration.manifest, {
              status: "pi_written_pending_source_cleanup",
              errors: [{ at: "honcho-source-cleanup-after-switch", message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), stack: cleanupError instanceof Error ? cleanupError.stack : undefined }],
            });
            newCtx.ui.notify(`Session switched, but source Honcho cleanup is pending: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n${log.join("\n")}`, "warning");
          }
        } });
        if (result?.cancelled) {
          const recovery = `Session moved, but switch was cancelled. Resume manually with: pi --session ${destFile}`;
          ctx.ui.notify(`${recovery}\nSource Honcho cleanup remains pending.\n${log.join("\n")}`, "error");
          ctx.shutdown?.();
        }
      } catch (error) {
        const recovery = `Session moved, but automatic switch failed. Resume manually with: pi --session ${destFile}`;
        ctx.ui.notify(`${recovery}\nSource Honcho cleanup remains pending.\n${error instanceof Error ? error.message : String(error)}\n${log.join("\n")}`, "error");
        ctx.shutdown?.();
      }
      return;
    }

    try {
      await cleanupHonchoSource();
      await writeManifest(migration.manifestFile, migration.manifest, { status: "complete" });
    } catch (cleanupError) {
      await writeManifest(migration.manifestFile, migration.manifest, {
        status: "pi_written_pending_source_cleanup",
        errors: [{ at: "honcho-source-cleanup-after-pi-write", message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), stack: cleanupError instanceof Error ? cleanupError.stack : undefined }],
      });
      log.push(`source Honcho cleanup pending: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
  } catch (error) {
    await writeManifest(migration.manifestFile, migration.manifest, {
      status: "failed",
      errors: [{ at: "whole-session-move", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }],
      recovery: { notes: [`Pi backup: ${migration.backupFile}`, `If Pi file was moved, resume manually with: pi --session ${destFile}`, `If Honcho target was written but source remains, delete target key manually only after inspecting: ${toHonchoKey}`] },
    });
    throw error;
  }

  ctx.ui.notify(log.join("\n"), "info");
}

function splitHelpText(): string {
  return [
    "Usage:",
    "  /session split [session] [--turn <turn-ref-or-query>] [--continue head|tail] [--dry-run]",
    "  /session:split [session] [--turn <turn-ref-or-query>] [--continue head|tail] [--dry-run]",
    "Notes:",
    "  head = turns before the split point (part 1)",
    "  tail = the split turn and everything after it (part 2, default continuation)",
    "  If --turn is omitted in TUI mode, a turn picker is shown.",
    "Examples:",
    "  /session split",
    "  /session split --turn 12 --continue tail",
    "  /session split 019f4e16 --turn 12 --dry-run",
  ].join("\n");
}

async function completeSplitCommand(parsed: ParsedSplitCommand, ctx: any): Promise<ParsedSplitCommand | null> {
  const next: ParsedSplitCommand = { ...parsed };
  if (!next.turnRef) {
    if (!ctx.hasUI) throw new Error(splitHelpText());
    const { entries } = await loadEntriesForToken(next.sessionToken, ctx);
    const pickedTurn = await pickSplitTurn(buildTurnList(entries), ctx);
    if (!pickedTurn) return null;
    next.turnRef = pickedTurn.entryId;
  }
  if (!next.continuePart) next.continuePart = "tail";
  return next;
}

async function executeSplitCommand(parsed: ParsedSplitCommand, ctx: any): Promise<void> {
  const completed = await completeSplitCommand(parsed, ctx);
  if (!completed) return;
  parsed = completed;
  if (!parsed.turnRef) throw new Error(splitHelpText());
  const { sessionFile, isCurrent } = await resolveSessionFileForMove(parsed.sessionToken, ctx);
  const sessionManager = isCurrent ? null : await SessionManager.open(sessionFile);
  const entries = (isCurrent ? ctx.sessionManager.getBranch() : sessionManager!.getBranch()) as SessionEntry[];
  const turns = buildTurnList(entries);
  const resolved = resolveTurnRef(turns, parsed.turnRef, { requireEligible: true });
  const headTurns = turns.filter((turn) => turn.turnId < resolved.turnId).length;
  const tailTurns = turns.filter((turn) => turn.turnId >= resolved.turnId).length;

  if (!parsed.dryRun) await runSessionMutationSafetyGate({ ctx, sessionFile, isCurrent, operation: "split", dryRun: parsed.dryRun });

  ctx.ui.notify([
    parsed.dryRun ? "Dry run: split preflight (no Pi or Honcho mutations)." : "Parsed split command; mutation engine is not enabled yet after safety gate.",
    `session: ${parsed.sessionToken ?? "current"} (${sessionFile})`,
    `splitTurnRef: ${parsed.turnRef}`,
    `splitTurnId: ${resolved.turnId}`,
    `splitEntryId: ${resolved.entryId}`,
    `head/part 1 turns: ${headTurns}`,
    `tail/part 2 turns: ${tailTurns}`,
    `continue: ${parsed.continuePart ?? "tail"}`,
    parsed.dryRun ? "" : "No files or Honcho sessions were changed; full split mutation still needs the partition/rebuild engine.",
  ].filter(Boolean).join("\n"), parsed.dryRun ? "info" : "warning");
}

async function handlePreferredSessionCommand(args: string, ctx: any, pi?: ExtensionAPI) {
  const parsed = parseSessionSubcommand(args ?? "");
  if (parsed.kind === "turns") {
    await showTurns(parsed, ctx);
    return;
  }
  if (parsed.kind === "split") {
    await executeSplitCommand(parsed, ctx);
    return;
  }
  await executeMoveCommand(parsed, ctx, pi ? {
    rerouteCurrentToCommand: async (command) => {
      ctx.ui.notify(`Continuing current-session move through command context: ${command}`, "info");
      pi.sendUserMessage(command, { deliverAs: "followUp" });
    },
  } : {});
}

async function handleSessionInput(text: string, ctx: any, pi: ExtensionAPI): Promise<boolean> {
  const match = text.match(/^\/session\s+(move|turns|split)(?:\s+(.*)|\s*)$/);
  if (!match) return false;
  try {
    await handlePreferredSessionCommand(`${match[1]} ${match[2] ?? ""}`.trim(), ctx, pi);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
  return true;
}

async function readHeader(file: string): Promise<{ header: SessionHeader; lines: string[] }> {
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  if (!lines[0]) throw new Error("Session file is empty.");
  const header = JSON.parse(lines[0]) as SessionHeader;
  if (header.type !== "session" || !header.cwd || !header.id) throw new Error("Not a valid Pi session JSONL header.");
  return { header, lines };
}

async function findSession(token: string): Promise<string | null> {
  const candidate = resolve(expandHome(token));
  if (existsSync(candidate)) return candidate;
  const { stdout } = await execFileAsync("find", [SESSION_ROOT, "-type", "f", "-name", "*.jsonl"], { maxBuffer: 10 * 1024 * 1024 });
  const files = String(stdout).split("\n").filter(Boolean);
  const matches: string[] = [];
  for (const file of files) {
    if (basename(file).includes(token)) { matches.push(file); continue; }
    try {
      const { header } = await readHeader(file);
      if (header.id?.startsWith(token)) matches.push(file);
    } catch { /* ignore bad files */ }
  }
  if (matches.length > 1) throw new Error(`Session id is ambiguous. Matches:\n${matches.join("\n")}`);
  return matches[0] ?? null;
}

async function pageToArray(page: any): Promise<any[]> {
  return typeof page?.toArray === "function" ? await page.toArray() : Array.isArray(page?.items) ? page.items : [];
}

async function honchoSessionExists(honcho: any, key: string): Promise<boolean> {
  const sessions = await pageToArray(await honcho.sessions({ size: 100 }));
  return sessions.some((s: any) => s.id === key);
}

function standardPeers(config: HonchoConfig) {
  const runtime = honchoRuntimeConfig(config);
  return [
    [runtime.peerName, { observeMe: runtime.observeMe, observeOthers: runtime.observeOthers }],
    [runtime.aiPeer, { observeMe: runtime.aiObserveMe, observeOthers: runtime.aiObserveOthers }],
  ];
}

async function fetchHonchoMessages(honcho: any, key: string): Promise<any[]> {
  // Honcho currently rejects oversized page sizes with an opaque SDK error; Page.toArray()
  // follows pagination, so keep the server-safe page size while still collecting all rows.
  return pageToArray(await (await honcho.session(key)).messages({ size: 100 }));
}

async function fetchHonchoMessagesIfExists(honcho: any, key: string): Promise<any[] | null> {
  try {
    return await fetchHonchoMessages(honcho, key);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

async function addHonchoMessages(honcho: any, session: any, messages: NormalizedHonchoMessage[]): Promise<void> {
  const peerCache = new Map<string, any>();
  const getPeer = async (id: string) => {
    let peer = peerCache.get(id);
    if (!peer) { peer = await honcho.peer(id); peerCache.set(id, peer); }
    return peer;
  };
  for (let i = 0; i < messages.length; i += 50) {
    const batch = [];
    for (const m of messages.slice(i, i + 50)) {
      batch.push((await getPeer(m.peerId)).message(m.content, { metadata: m.metadata ?? {}, createdAt: m.createdAt }));
    }
    if (batch.length > 0) await session.addMessages(batch);
  }
}

async function sourceSessionBase(honcho: any, sourceKey: string): Promise<{ metadata: Record<string, unknown>; configuration: Record<string, unknown> }> {
  let source: any;
  try { source = await honcho.session(sourceKey); } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return { metadata: {}, configuration: {} };
    throw error;
  }
  let metadata: Record<string, unknown> = {};
  let configuration: Record<string, unknown> = {};
  try { metadata = await source.getMetadata(); } catch { metadata = {}; }
  try { configuration = await source.getConfiguration(); } catch { configuration = {}; }
  return { metadata, configuration };
}

export async function writeHonchoTargetFromTranscript(params: { honcho: any; key: string; sourceKey: string; config: HonchoConfig; messages: RebuildMessage[]; migrationId: string; sourceCwd: string; targetCwd: string; mergeTarget?: boolean }) {
  const { honcho, key, sourceKey, config, messages } = params;
  const targetExists = await honchoSessionExists(honcho, key);
  if (targetExists && !params.mergeTarget) {
    throw new Error(`Target Honcho session already exists: ${key}. Use --merge to approve merging moved messages into the existing target.`);
  }
  const existingTargetMessages = targetExists ? await fetchHonchoMessages(honcho, key) : [];
  const existingTarget = existingTargetMessages.map(normalizeHonchoMessage);
  const migrating = messages.map(normalizeExpectedMessage);
  const existingPeerContent = new Set(existingTarget.map(normalizedPeerContentFingerprint));
  const overlapCount = migrating.filter((message) => existingPeerContent.has(normalizedPeerContentFingerprint(message))).length;
  const duplicateMigratedInTarget = migratedDuplicateCountInTarget(migrating, existingTarget);
  if (duplicateMigratedInTarget > 0) throw new Error(`Target Honcho session contains ${duplicateMigratedInTarget} duplicate already-migrated message occurrence(s); refusing until target is cleaned up.`);
  const messagesToAdd = migrating.filter((message) => !existingPeerContent.has(normalizedPeerContentFingerprint(message)));

  const { metadata, configuration } = await sourceSessionBase(honcho, sourceKey);
  const target = targetExists ? await honcho.session(key) : await honcho.session(key, {
    metadata: { ...metadata, movedFromSessionKey: sourceKey, sourceCwd: params.sourceCwd, targetCwd: params.targetCwd, migrationId: params.migrationId, rebuiltBy: "session-move" },
    configuration,
    peers: standardPeers(config),
  });

  await addHonchoMessages(honcho, target, messagesToAdd);
  const written = await fetchHonchoMessages(honcho, key);
  const expectedTarget = [...existingTarget, ...messagesToAdd];
  const validation = validateNormalizedTargetContent(expectedTarget, written);
  validation.preexistingTargetCount = existingTarget.length;
  validation.migratedPayloadCount = migrating.length;
  validation.migratedPayloadHash = contentHash(migrating);
  (validation as any).targetAlreadyPresentMigratedCount = overlapCount;
  (validation as any).targetMigratedAddedCount = messagesToAdd.length;
  validation.abortReasons = collectAbortReasons(validation);
  if (validation.abortReasons.length > 0) throw new Error(`Target Honcho validation failed: ${validation.abortReasons.join("; ")}`);
  return { count: validation.actualTargetCount, hash: validation.actualTargetHash, validation, messages, expectedTargetMessages: expectedTarget };
}

export async function validateHonchoSessionsBeforeSourceDelete(params: { honcho: any; sourceKey: string; targetKey: string; expectedTargetCount?: number; expectedMessages: RebuildMessage[]; expectedTargetMessages?: NormalizedHonchoMessage[]; migrationStartedAt?: string }) {
  const [targetMessages, sourceMessagesMaybe] = await Promise.all([
    fetchHonchoMessages(params.honcho, params.targetKey),
    fetchHonchoMessagesIfExists(params.honcho, params.sourceKey),
  ]);
  const sourceMessages = sourceMessagesMaybe ?? [];
  const validation = validateHonchoSourceBeforeDelete({ expectedMessages: params.expectedMessages, sourceMessages, targetMessages, expectedTargetMessages: params.expectedTargetMessages, migrationStartedAt: params.migrationStartedAt });
  if (typeof params.expectedTargetCount === "number" && validation.actualTargetCount !== params.expectedTargetCount) {
    validation.abortReasons.push(`target count changed: expected ${params.expectedTargetCount}, got ${validation.actualTargetCount}`);
  }
  return validation;
}

export async function finalizeHonchoSourceAfterTargetValidated(params: { honcho: any; sourceKey: string; targetKey: string; config: HonchoConfig; expectedTargetCount?: number; expectedMessages: RebuildMessage[]; expectedTargetMessages?: NormalizedHonchoMessage[]; migrationStartedAt?: string; sourceBackupFile?: string }) {
  const sourceMessagesRaw = await fetchHonchoMessagesIfExists(params.honcho, params.sourceKey);
  if (sourceMessagesRaw === null) {
    const validation = await validateHonchoSessionsBeforeSourceDelete({ ...params, expectedMessages: params.expectedMessages });
    return { ...validation, sourceTotalCount: 0, sourceOwnedPresentCount: 0, sourceMissingCount: params.expectedMessages.length, sourceResidualCount: 0 };
  }
  const aligned = alignMigratedPayloadToSource(params.expectedMessages, sourceMessagesRaw);
  const validation = await validateHonchoSessionsBeforeSourceDelete({ ...params, expectedMessages: aligned.messages });
  if (validation.abortReasons.length > 0) {
    const error = new Error(`Refusing to alter source Honcho: ${validation.abortReasons.join("; ")}`) as Error & { validation?: HonchoValidationDetails };
    error.validation = validation;
    throw error;
  }
  const matched = new Set(aligned.matchedSourceIndexes);
  const residual = sourceMessagesRaw.map(normalizeHonchoMessage).filter((_message, index) => !matched.has(index));
  const source = await params.honcho.session(params.sourceKey);
  const { metadata, configuration } = await sourceSessionBase(params.honcho, params.sourceKey);
  if (params.sourceBackupFile) {
    await writeFile(params.sourceBackupFile, JSON.stringify({ key: params.sourceKey, metadata, configuration, messages: sourceMessagesRaw.map(normalizeHonchoMessage) }, null, 2), "utf8");
  }
  await source.delete();
  if (residual.length > 0) {
    const recreated = await params.honcho.session(params.sourceKey, { metadata: { ...metadata, rebuiltBy: "session-move", rebuiltAfterMigration: params.migrationStartedAt }, configuration, peers: standardPeers(params.config) });
    await addHonchoMessages(params.honcho, recreated, residual);
    const rebuiltSource = (await fetchHonchoMessages(params.honcho, params.sourceKey)).map(normalizeHonchoMessage);
    const sourceValidation = validateNormalizedTargetContent(residual, rebuiltSource);
    if (sourceValidation.abortReasons.length > 0) throw Object.assign(new Error(`Source residual rebuild validation failed: ${sourceValidation.abortReasons.join("; ")}`), { validation: sourceValidation });
  }
  return { ...validation, sourceResidualCount: residual.length };
}

export async function deleteHonchoSourceAfterTargetValidated(params: { honcho: any; sourceKey: string; targetKey: string; expectedTargetCount?: number; expectedMessages: RebuildMessage[] }) {
  const result = await finalizeHonchoSourceAfterTargetValidated({ ...params, config: {} });
  return result;
}

export default function sessionMove(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) => createSessionAutocompleteProvider(current));
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    return await handleSessionInput(event.text, ctx, pi) ? { action: "handled" } : { action: "continue" };
  });

  pi.registerCommand("session:turns", {
    description: "Fallback: list, pick, or resolve stable user-message turn ids for a Pi session",
    handler: async (args, ctx) => {
      try {
        await handleTurnsCommand(args, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("session:split", {
    description: "Fallback: split a Pi session into head/tail parts",
    handler: async (args, ctx) => {
      try {
        const parsed = parseSessionSubcommand(`split ${args ?? ""}`);
        if (parsed.kind !== "split") throw new Error("Internal parser error.");
        await executeSplitCommand(parsed, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("session:move", {
    description: "Fallback: move a Pi session to a target directory scope",
    handler: async (args, ctx) => {
      try {
        const parsed = parseSessionSubcommand(`move ${args ?? ""}`);
        if (parsed.kind !== "move") throw new Error("Internal parser error.");
        await executeMoveCommand(parsed, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
