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
  sourceTotalCount?: number;
  sourceOwnedPresentCount?: number;
  sourceMissingCount?: number;
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
  if ((details.sourceMissingCount ?? 0) > 0) reasons.push(`source contains ${details.sourceMissingCount} message(s) missing from target`);
  if ((details.postMigrationSourceMessageCount ?? 0) > 0) reasons.push(`source contains ${details.postMigrationSourceMessageCount} post-migration/unexpected message(s) not present in target`);
  return reasons;
}

export function validateHonchoTargetContent(expected: RebuildMessage[], actualMessages: any[]): HonchoValidationDetails {
  const expectedNormalized = expected.map(normalizeExpectedMessage);
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

export function validateHonchoSourceBeforeDelete(params: { expectedMessages: RebuildMessage[]; sourceMessages: any[]; targetMessages: any[] }): HonchoValidationDetails {
  const targetDetails = validateHonchoTargetContent(params.expectedMessages, params.targetMessages);
  const source = params.sourceMessages.map(normalizeHonchoMessage);
  const target = params.targetMessages.map(normalizeHonchoMessage);
  const expected = params.expectedMessages.map(normalizeExpectedMessage);
  const sourceOwnedPresentCount = countPresentByFingerprint(source, target);
  const sourceMissingCount = Math.max(0, source.length - sourceOwnedPresentCount);
  const expectedSet = new Set(expected.map(normalizedPeerContentFingerprint));
  const targetStableSet = new Set(target.map(stableFingerprint));
  const targetPeerContentSet = new Set(target.map(normalizedPeerContentFingerprint));
  const postMigrationSourceMessageCount = source.filter((message) => {
    const belongsToExpectedPayload = expectedSet.has(normalizedPeerContentFingerprint(message));
    const presentInTarget = targetStableSet.has(stableFingerprint(message)) || targetPeerContentSet.has(normalizedPeerContentFingerprint(message));
    return !belongsToExpectedPayload && !presentInTarget;
  }).length;
  const details: HonchoValidationDetails = {
    ...targetDetails,
    sourceTotalCount: source.length,
    sourceOwnedPresentCount,
    sourceMissingCount,
    postMigrationSourceMessageCount,
    abortReasons: [],
  };
  details.abortReasons = collectAbortReasons(details);
  return details;
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
};

type ParsedTurnsCommand = {
  kind: "turns";
  sessionToken: string;
  query?: string;
  json: boolean;
  pick: boolean;
};

type ParsedSessionSubcommand = ParsedMoveCommand | ParsedTurnsCommand;

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

function parseSessionSubcommand(args: string): ParsedSessionSubcommand {
  const tokens = tokenizeArgs(args);
  const [subcommand] = tokens;
  if (subcommand === "turns") {
    let sessionToken = "current";
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

  if (subcommand === "move") {
    let sessionToken: string | undefined;
    let targetDir: string | undefined;
    let dryRun = false;
    let splitRequested = false;
    let continuePolicy: ParsedMoveCommand["continuePolicy"];
    let explicitTurnRef: string | undefined;
    const trailing: string[] = [];
    const positional: string[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "--dry-run") { dryRun = true; continue; }
      if (token === "--split") { splitRequested = true; continue; }
      if (token === "--continue") {
        const policy = tokens[++i];
        if (policy !== "source" && policy !== "target") throw new Error("--continue must be one of: source, target");
        continuePolicy = policy;
        continue;
      }
      if (token === "--turn") {
        const value = tokens[++i];
        if (!value) { splitRequested = true; continue; }
        explicitTurnRef = value;
        splitRequested = true;
        continue;
      }
      if (token === "split" && tokens[i + 1] === "from") {
        throw new Error("Use /session move <session> <target-dir> [<turn-ref-or-query>] or --turn <turn-ref>; legacy split syntax is no longer supported.");
      }
      positional.push(token);
    }
    sessionToken = positional.shift();
    targetDir = positional.shift();
    trailing.push(...positional);
    const turnRef = explicitTurnRef ?? (trailing.length > 0 ? trailing.join(" ").trim() : undefined);
    if (turnRef) splitRequested = true;
    return { kind: "move", sessionToken, targetDir, turnRef, splitRequested, continuePolicy, dryRun };
  }

  throw new Error("Usage: /session turns [current|session-id|session-file] [query...] [--json] [--pick] | /session move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target]");
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

async function loadEntriesForToken(token: string, ctx: any): Promise<{ sessionFile?: string; entries: SessionEntry[] }> {
  if (token === "current") {
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
      { value: "move", label: "move", description: "Move or split-move a session" },
      { value: "turns", label: "turns", description: "List, pick, or resolve user-message turn ids" },
    ], prefix);
    return items.length > 0 ? { items, prefix } : null;
  }

  if (first === "move") {
    const position = tokens.length - 1 + (hasTrailingSpace ? 1 : 0);
    const items: AutocompleteItem[] = [];
    if (position === 1) items.push({ value: "current", label: "current", description: "The active session" });
    else if (position >= 3) {
      if (!tokens.includes("--turn")) items.push({ value: "--turn", label: "--turn", description: "Provide an explicit turn id, entry id, or query" });
      if (!tokens.includes("--continue")) items.push({ value: "--continue", label: "--continue", description: "Continuation policy: source or target" });
      if (!tokens.includes("--dry-run")) items.push({ value: "--dry-run", label: "--dry-run", description: "Parse and resolve only; do not mutate" });
      if (tokens[tokens.length - 1] === "--continue") {
        items.length = 0;
        items.push(
          { value: "source", label: "source" },
          { value: "target", label: "target" },
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
    "  /session move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target] [--dry-run]",
    "  /session move --split",
    "  /session:move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target] [--dry-run]",
    "Examples:",
    "  /session move current ~/ --dry-run",
    "  /session move current ~/ --turn 12 --continue target",
  ].join("\n");
}

async function resolveSessionFileForMove(token: string, ctx: any): Promise<{ sessionFile: string; isCurrent: boolean }> {
  const active = ctx.sessionManager.getSessionFile();
  if (token === "current") {
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
  if (parsed.sessionToken && parsed.targetDir && (!parsed.splitRequested || parsed.turnRef) && (parsed.sessionToken !== "current" || parsed.continuePolicy || !parsed.splitRequested)) return parsed;
  if (!ctx.hasUI) {
    ctx.ui.notify(moveHelpText(), "warning");
    return null;
  }
  const next: ParsedMoveCommand = { ...parsed };
  if (!next.sessionToken) {
    const active = ctx.sessionManager.getSessionFile();
    const options = active ? ["current", "Enter session id/file"] : ["Enter session id/file"];
    const picked = await ctx.ui.select("Move which session?", options);
    if (!picked) return null;
    next.sessionToken = picked === "Enter session id/file" ? await ctx.ui.input("Session id or file:", "current | session id | /path/to/session.jsonl") : picked;
    if (!next.sessionToken) return null;
  }
  if (!next.targetDir) {
    const target = await ctx.ui.input("Target path:", "~/target-project");
    if (!target) return null;
    next.targetDir = target;
  }
  if (next.splitRequested && !next.turnRef) {
    const { sessionFile, isCurrent } = await resolveSessionFileForMove(next.sessionToken, ctx);
    const sessionManager = isCurrent ? null : await SessionManager.open(sessionFile);
    const entries = (isCurrent ? ctx.sessionManager.getBranch() : sessionManager!.getBranch()) as SessionEntry[];
    const pickedTurn = await pickSplitTurn(buildTurnList(entries), ctx);
    if (!pickedTurn) return null;
    next.turnRef = pickedTurn.entryId;
  }
  if (next.sessionToken === "current" && next.splitRequested && !next.continuePolicy) {
    const policy = await ctx.ui.select("Continue after split in:", ["source", "target"]);
    if (policy !== "source" && policy !== "target") return null;
    next.continuePolicy = policy;
  }
  return next;
}

function quoteCommandArg(value: string): string {
  return /^[^\s"'`\\]+$/.test(value) ? value : JSON.stringify(value);
}

function formatMoveCommand(parsed: ParsedMoveCommand, command = "/session:move"): string {
  const parts = [command];
  if (parsed.sessionToken) parts.push(quoteCommandArg(parsed.sessionToken));
  if (parsed.targetDir) parts.push(quoteCommandArg(parsed.targetDir));
  if (parsed.splitRequested && !parsed.turnRef) parts.push("--split");
  if (parsed.turnRef) parts.push("--turn", quoteCommandArg(parsed.turnRef));
  if (parsed.continuePolicy) parts.push("--continue", parsed.continuePolicy);
  if (parsed.dryRun) parts.push("--dry-run");
  return parts.join(" ");
}

async function executeMoveCommand(parsed: ParsedMoveCommand, ctx: any, options: { rerouteCurrentToCommand?: (command: string) => Promise<void> } = {}): Promise<void> {
  const completed = await completeMoveCommand(parsed, ctx);
  if (!completed) return;
  parsed = completed;
  if (!parsed.sessionToken || !parsed.targetDir) throw new Error(moveHelpText());
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
  if (existsSync(destFile)) throw new Error(`Target Pi session file already exists: ${destFile}`);

  const cfg = JSON.parse(await readFile(HONCHO_CONFIG, "utf8")) as HonchoConfig;
  const runtime = honchoRuntimeConfig(cfg);
  const fromHonchoKey = await deriveHonchoSessionKey(String(header.cwd), cfg);
  const toHonchoKey = await deriveHonchoSessionKey(targetDir, cfg);
  const entries = isCurrent ? ctx.sessionManager.getBranch() as SessionEntry[] : (await SessionManager.open(sessionFile)).getBranch() as SessionEntry[];

  if (isCurrent && !parsed.dryRun) {
    if (typeof ctx.waitForIdle !== "function" || typeof ctx.switchSession !== "function") {
      if (options.rerouteCurrentToCommand) {
        await options.rerouteCurrentToCommand(formatMoveCommand(parsed, "/session:move"));
        return;
      }
      throw new Error("Current-session move requires Pi command context. Recovery: run " + formatMoveCommand(parsed, "/session:move"));
    }
    await ctx.waitForIdle();
    if (ctx.hasPendingMessages?.()) throw new Error("Cannot move current session while messages are pending.");
    // The Honcho extension may upload asynchronously after agent_end. Give the queue a bounded quiescence window.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const dryRunMigrationId = `dry-run_${hash(`${sessionFile}:${destFile}`)}`;
  const rebuildMessages = buildWholeSessionRebuildMessages({ header, entries, sessionFile, migrationId: dryRunMigrationId, config: cfg });

  if (parsed.dryRun) {
    ctx.ui.notify([
      "Dry run: whole-session move plan (no files or memory sessions mutated).",
      `current: ${isCurrent ? "yes" : "no"}`,
      `Pi: ${sessionFile}`,
      ` -> ${destFile}`,
      `Header cwd: ${header.cwd}`,
      ` -> ${targetDir}`,
      `Honcho workspace: ${runtime.workspaceId}`,
      `Honcho baseURL: ${runtime.baseURL ?? "(default)"}`,
      `Memory: ${fromHonchoKey}`,
      ` -> ${toHonchoKey}`,
      `Rebuild messages: ${rebuildMessages.length}`,
      `Rebuild hash: ${hashRebuildMessages(rebuildMessages)}`,
    ].join("\n"), "info");
    return;
  }

  if (fromHonchoKey === toHonchoKey) throw new Error(`Source and target Honcho session keys are identical: ${fromHonchoKey}`);
  const { Honcho } = await import(HONCHO_SDK);
  const honcho = new Honcho({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseURL,
    workspaceId: runtime.workspaceId,
    environment: runtime.environment,
  });
  if (!(await honchoSessionExists(honcho, fromHonchoKey))) throw new Error(`Source Honcho session does not exist: ${fromHonchoKey}`);
  if (await honchoSessionExists(honcho, toHonchoKey)) {
    throw new Error(`Target Honcho session already exists: ${toHonchoKey}. Refusing to append duplicates; choose an empty target or add an explicit replace mode later.`);
  }

  const ok = await ctx.ui.confirm("Move session?", [
    `Pi: ${sessionFile}`,
    ` -> ${destFile}`,
    `Header cwd: ${header.cwd}`,
    ` -> ${targetDir}`,
    `Memory: ${fromHonchoKey}`,
    ` -> ${toHonchoKey}`,
    `Will rebuild ${rebuildMessages.length} Honcho message(s) at the target, validate, then delete source memory before moving Pi.`,
    isCurrent ? "Will switch this Pi process to the moved session file after writing." : "",
  ].filter(Boolean).join("\n"));
  if (!ok) return;

  const migration = await createMoveManifest({ sessionFile, destFile, sourceCwd: String(header.cwd), targetDir, operation: "move", dryRun: false, sourceHonchoKey: fromHonchoKey, targetHonchoKey: toHonchoKey });
  const log = [`manifest: ${migration.manifestFile}`];
  try {
    const messages = buildWholeSessionRebuildMessages({ header, entries, sessionFile, migrationId: migration.migrationId, config: cfg });
    const targetWrite = await writeHonchoTargetFromTranscript({ honcho, key: toHonchoKey, sourceKey: fromHonchoKey, config: cfg, messages, migrationId: migration.migrationId, sourceCwd: String(header.cwd), targetCwd: targetDir });
    await writeManifest(migration.manifestFile, migration.manifest, {
      status: "honcho_target_written",
      honchoValidation: targetWrite.validation,
      honchoTargetCount: targetWrite.count,
      honchoTargetHash: targetWrite.hash,
      honchoExpectedCount: targetWrite.validation.expectedCount,
      honchoExpectedHash: targetWrite.validation.expectedHash,
      honchoDuplicateCount: targetWrite.validation.duplicateCount,
    });
    log.push(`rebuilt target Honcho session ${toHonchoKey} (${targetWrite.count} messages)`);

    try {
      const deleteValidation = await validateHonchoSessionsBeforeSourceDelete({ honcho, sourceKey: fromHonchoKey, targetKey: toHonchoKey, expectedTargetCount: targetWrite.count, expectedMessages: messages });
      await writeManifest(migration.manifestFile, migration.manifest, { status: "honcho_predelete_validated", honchoValidation: deleteValidation, honchoAbortReasons: deleteValidation.abortReasons });
      if (deleteValidation.abortReasons.length > 0) throw Object.assign(new Error(`Refusing to delete source Honcho: ${deleteValidation.abortReasons.join("; ")}`), { validation: deleteValidation });
      await (await honcho.session(fromHonchoKey)).delete();
      await writeManifest(migration.manifestFile, migration.manifest, { status: "honcho_source_deleted", honchoValidation: deleteValidation });
    } catch (error) {
      const validation = (error as Error & { validation?: HonchoValidationDetails }).validation;
      if (validation) await writeManifest(migration.manifestFile, migration.manifest, { status: "failed", honchoValidation: validation, honchoAbortReasons: validation.abortReasons });
      throw error;
    }
    log.push(`deleted source Honcho session ${fromHonchoKey}`);

    const newHeader = { ...header, cwd: targetDir };
    lines[0] = JSON.stringify(newHeader);
    await writeFile(sessionFile, lines.join("\n"), "utf8");
    await mkdir(dirname(destFile), { recursive: true });
    await rename(sessionFile, destFile);
    await writeManifest(migration.manifestFile, migration.manifest, { status: "pi_written" });
    await writeManifest(migration.manifestFile, migration.manifest, { status: "complete" });
    log.push(`moved Pi session to ${destFile}`);
  } catch (error) {
    await writeManifest(migration.manifestFile, migration.manifest, {
      status: "failed",
      errors: [{ at: "whole-session-move", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }],
      recovery: { notes: [`Pi backup: ${migration.backupFile}`, `If Pi file was moved, resume manually with: pi --session ${destFile}`, `If Honcho target was written but source remains, delete target key manually only after inspecting: ${toHonchoKey}`] },
    });
    throw error;
  }

  if (isCurrent) {
    try {
      const result = await ctx.switchSession(destFile, { withSession: async (newCtx: any) => newCtx.ui.notify(log.join("\n"), "info") });
      if (result?.cancelled) {
        const recovery = `Session moved, but switch was cancelled. Resume manually with: pi --session ${destFile}`;
        ctx.ui.notify(`${recovery}\n${log.join("\n")}`, "error");
        ctx.shutdown?.();
      }
    } catch (error) {
      const recovery = `Session moved, but automatic switch failed. Resume manually with: pi --session ${destFile}`;
      ctx.ui.notify(`${recovery}\n${error instanceof Error ? error.message : String(error)}\n${log.join("\n")}`, "error");
      ctx.shutdown?.();
    }
    return;
  }
  ctx.ui.notify(log.join("\n"), "info");
}

async function handlePreferredSessionCommand(args: string, ctx: any, pi?: ExtensionAPI) {
  const parsed = parseSessionSubcommand(args ?? "");
  if (parsed.kind === "turns") {
    await showTurns(parsed, ctx);
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
  const match = text.match(/^\/session\s+(move|turns)(?:\s+(.*)|\s*)$/);
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

export async function writeHonchoTargetFromTranscript(params: { honcho: any; key: string; sourceKey: string; config: HonchoConfig; messages: RebuildMessage[]; migrationId: string; sourceCwd: string; targetCwd: string }) {
  const { honcho, key, sourceKey, config, messages } = params;
  if (await honchoSessionExists(honcho, key)) {
    throw new Error(`Target Honcho session already exists: ${key}. Refusing to append because that can duplicate moved messages.`);
  }
  const runtime = honchoRuntimeConfig(config);
  const source = await honcho.session(sourceKey);
  let metadata: Record<string, unknown> = {};
  let configuration: Record<string, unknown> = {};
  try { metadata = await source.getMetadata(); } catch { metadata = {}; }
  try { configuration = await source.getConfiguration(); } catch { configuration = {}; }
  const target = await honcho.session(key, {
    metadata: { ...metadata, movedFromSessionKey: sourceKey, sourceCwd: params.sourceCwd, targetCwd: params.targetCwd, migrationId: params.migrationId, rebuiltBy: "session-move" },
    configuration,
    peers: [
      [runtime.peerName, { observeMe: runtime.observeMe, observeOthers: runtime.observeOthers }],
      [runtime.aiPeer, { observeMe: runtime.aiObserveMe, observeOthers: runtime.aiObserveOthers }],
    ],
  });

  const peerCache = new Map<string, any>();
  const getPeer = async (id: string) => {
    let peer = peerCache.get(id);
    if (!peer) { peer = await honcho.peer(id); peerCache.set(id, peer); }
    return peer;
  };
  for (let i = 0; i < messages.length; i += 50) {
    const batch = [];
    for (const m of messages.slice(i, i + 50)) {
      batch.push((await getPeer(m.peerId)).message(m.content, { metadata: m.metadata, createdAt: m.createdAt }));
    }
    if (batch.length > 0) await target.addMessages(batch);
  }
  const written = await pageToArray(await target.messages({ size: 1000 }));
  const validation = validateHonchoTargetContent(messages, written);
  if (validation.abortReasons.length > 0) throw new Error(`Target Honcho validation failed: ${validation.abortReasons.join("; ")}`);
  return { count: validation.actualTargetCount, hash: validation.actualTargetHash, validation };
}

export async function validateHonchoSessionsBeforeSourceDelete(params: { honcho: any; sourceKey: string; targetKey: string; expectedTargetCount?: number; expectedMessages: RebuildMessage[] }) {
  const target = await params.honcho.session(params.targetKey);
  const source = await params.honcho.session(params.sourceKey);
  const [targetMessages, sourceMessages] = await Promise.all([
    pageToArray(await target.messages({ size: 1000 })),
    pageToArray(await source.messages({ size: 1000 })),
  ]);
  const validation = validateHonchoSourceBeforeDelete({ expectedMessages: params.expectedMessages, sourceMessages, targetMessages });
  if (typeof params.expectedTargetCount === "number" && validation.actualTargetCount !== params.expectedTargetCount) {
    validation.abortReasons.push(`target count changed: expected ${params.expectedTargetCount}, got ${validation.actualTargetCount}`);
  }
  return validation;
}

export async function deleteHonchoSourceAfterTargetValidated(params: { honcho: any; sourceKey: string; targetKey: string; expectedTargetCount?: number; expectedMessages: RebuildMessage[] }) {
  const validation = await validateHonchoSessionsBeforeSourceDelete(params);
  if (validation.abortReasons.length > 0) {
    const error = new Error(`Refusing to delete source Honcho: ${validation.abortReasons.join("; ")}`) as Error & { validation?: HonchoValidationDetails };
    error.validation = validation;
    throw error;
  }
  await (await params.honcho.session(params.sourceKey)).delete();
  return validation;
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
