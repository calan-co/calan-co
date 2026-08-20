import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DEFAULT_TEMPLE_EXTENSIONS } from './defaults';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';
import {
  Diagnostic as LspDiagnostic,
  Range as LspRange,
} from 'vscode-languageserver/node';

const VIRTUAL_SCHEME = 'temple-cleaned';
const EXTENSION_NAME = 'Temple Language Server';
const TEMPLE_GET_DEFAULTS_METHOD = 'temple/getDefaults';
const TEMPLE_GET_BASE_PROJECTION_METHOD = 'temple/getBaseProjection';
const MIRROR_GHOST_DIRNAME = '.temple-base-lint';
const cleanedContentMap = new Map<string, string>();
const cleanedContentVersionMap = new Map<string, number>();
const tempBaseLintFileMap = new Map<string, string>();
const tempBaseLintDirectories = new Set<string>();
const shadowDocHandles = new Map<string, ShadowDocHandle>();
const sourceToBaseUriMap = new Map<string, string>();
let baseLintStorageRoot: string | undefined;

let client: LanguageClient | undefined;

type BaseDiagnosticsRequest = {
  uri: string;
  content: string;
  detectedFormat?: string;
};

type CreateVirtualDocumentParams = {
  uri: string;
  content: string;
};

type PublishNodeDiagnosticsParams = {
  uri: string;
  diagnostics: LspDiagnostic[];
};

type TempleDefaultsResponse = {
  templeExtensions?: string[];
};

type TemplateTokenSpanPayload = {
  startOffset: number;
  endOffset: number;
  tokenType: string;
};

type BaseProjectionResponse = {
  cleanedText: string;
  cleanedToSourceOffsets: number[];
  sourceToCleanedOffsets: number[];
  templateTokenSpans: TemplateTokenSpanPayload[];
};

type ProjectionSnapshot = {
  sourceText: string;
  targetText: string;
  cleanedToSourceOffsets: number[];
  sourceToCleanedOffsets: number[];
  sourceLineStarts: number[];
  targetLineStarts: number[];
  unsafeSourceOffsetRanges: Array<{ start: number; end: number }>;
};

type JsonObject = Record<string, unknown>;
type BaseLintFocusMode = 'all' | 'activeTemplate';
type BaseLintStrategyMode = 'auto' | 'embedded' | 'vscode';
type BaseLintTransportStrategy = 'embedded' | 'virtual' | 'mirror-file';
type BaseLintLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
type BaseLspBridgeMode = 'off' | 'full';
type BaseLspParityBaseline = 'official-defaults';

type BaseLintCapabilities = {
  hasEmbeddedAdapter: boolean;
  supportsVirtualDocument: boolean;
  supportsMirrorFile: boolean;
};

type BaseLintStrategyDecision = {
  strategy: BaseLintTransportStrategy;
  reason: string;
};

type ResolveBaseLintStrategyParams = {
  mode: BaseLintStrategyMode;
  detectedFormat: string;
  capabilities: BaseLintCapabilities;
};

type ShadowDocHandle = {
  sourceUri: vscode.Uri;
  baseUri: vscode.Uri;
  targetUri: vscode.Uri;
  strategy: BaseLintTransportStrategy;
  detectedFormat: string;
  version: number;
  updatedAt: number;
  projection?: ProjectionSnapshot;
};

const LOG_LEVEL_ORDER: Record<BaseLintLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};
const bridgeDowngradeLogSet = new Set<string>();

const FORMATS_WITHOUT_RELIABLE_VIRTUAL_LINT = new Set<string>();
const TEMPLATED_LANGUAGE_IDS = new Set([
  'templ-any',
  'templ-markdown',
  'templ-json',
  'templ-yaml',
  'templ-html',
  'templ-xml',
  'templ-toml',
]);
const BASE_LSP_PARITY_LANGUAGE_IDS = [
  'templ-markdown',
  'templ-json',
  'templ-yaml',
  'templ-html',
  'templ-xml',
  'templ-toml',
] as const;

interface BaseLintCapabilityRegistry {
  capabilitiesForFormat(format: string): BaseLintCapabilities;
}

class DefaultBaseLintCapabilityRegistry implements BaseLintCapabilityRegistry {
  private readonly embeddedFormatSet: Set<string>;

  constructor(embeddedFormats: string[]) {
    this.embeddedFormatSet = new Set(
      embeddedFormats.map((format) => normalizeDetectedFormat(format))
    );
  }

  capabilitiesForFormat(format: string): BaseLintCapabilities {
    const normalizedFormat = normalizeDetectedFormat(format);
    return {
      hasEmbeddedAdapter: this.embeddedFormatSet.has(normalizedFormat),
      supportsVirtualDocument:
        !FORMATS_WITHOUT_RELIABLE_VIRTUAL_LINT.has(normalizedFormat),
      supportsMirrorFile: true,
    };
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function normalizeTempleExtension(extension: string): string {
  const trimmed = extension.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function hasUserConfiguredTempleExtensions(
  templeConfig: vscode.WorkspaceConfiguration
): boolean {
  const inspection = templeConfig.inspect<string[]>('fileExtensions');
  return (
    inspection?.workspaceFolderValue !== undefined ||
    inspection?.workspaceValue !== undefined ||
    inspection?.globalValue !== undefined
  );
}

function normalizeTempleExtensionsList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return dedupe(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeTempleExtension(entry))
      .filter(Boolean)
  );
}

function isTempleDefaultsResponse(value: unknown): value is TempleDefaultsResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as { templeExtensions?: unknown };
  return (
    maybe.templeExtensions === undefined ||
    (Array.isArray(maybe.templeExtensions) &&
      maybe.templeExtensions.every((entry) => typeof entry === 'string'))
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

async function resolveServerDefaultTempleExtensions(
  languageClient: LanguageClient,
  fallbackExtensions: string[],
  outputChannel: vscode.OutputChannel
): Promise<string[]> {
  try {
    const response = await languageClient.sendRequest(TEMPLE_GET_DEFAULTS_METHOD, {});
    if (!isTempleDefaultsResponse(response)) {
      outputChannel.appendLine(
        `[${EXTENSION_NAME}] '${TEMPLE_GET_DEFAULTS_METHOD}' returned invalid payload; using local defaults.`
      );
      return fallbackExtensions;
    }

    const normalized = normalizeTempleExtensionsList(response.templeExtensions);
    if (normalized.length === 0) {
      return fallbackExtensions;
    }
    return normalized;
  } catch (error) {
    outputChannel.appendLine(
      `[${EXTENSION_NAME}] Failed to resolve defaults from language server: ${String(error)}`
    );
    return fallbackExtensions;
  }
}

function buildDocumentSelector(
  templeExtensions: string[]
): Array<{ scheme: 'file'; language?: string; pattern?: string }> {
  const selector: Array<{ scheme: 'file'; language?: string; pattern?: string }> = [
    { scheme: 'file', language: 'templ-any' },
    { scheme: 'file', language: 'templ-markdown' },
    { scheme: 'file', language: 'templ-json' },
    { scheme: 'file', language: 'templ-yaml' },
    { scheme: 'file', language: 'templ-html' },
    { scheme: 'file', language: 'templ-xml' },
    { scheme: 'file', language: 'templ-toml' },
  ];

  for (const extension of templeExtensions) {
    const normalized = normalizeTempleExtension(extension);
    if (!normalized) {
      continue;
    }
    selector.push({
      scheme: 'file',
      pattern: `**/*${normalized}`,
    });
  }

  return selector;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders || []).map(
    (folder) => folder.uri.fsPath
  );
}

function expandWorkspaceVariables(rawValue: string): string {
  let value = rawValue;
  const folders = vscode.workspace.workspaceFolders || [];

  for (const folder of folders) {
    const namedPattern = new RegExp(
      `\\$\\{workspaceFolder:${escapeRegExp(folder.name)}\\}`,
      'g'
    );
    value = value.replace(namedPattern, folder.uri.fsPath);
  }

  if (folders.length > 0) {
    value = value.replace(/\$\{workspaceFolder\}/g, folders[0].uri.fsPath);
  }

  return value;
}

function isPathLike(value: string): boolean {
  return (
    value.startsWith('~') ||
    value.startsWith('.') ||
    value.includes('/') ||
    value.includes('\\')
  );
}

function normalizePathValue(rawValue: string): string {
  const expanded = expandWorkspaceVariables(rawValue.trim());
  if (!expanded) {
    return expanded;
  }
  if (expanded === '~') {
    return os.homedir();
  }
  if (expanded.startsWith('~/')) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  if (isPathLike(expanded)) {
    const firstWorkspace = vscode.workspace.workspaceFolders?.[0];
    if (!firstWorkspace) {
      return expanded;
    }
    return path.join(firstWorkspace.uri.fsPath, expanded);
  }
  return expanded;
}

function resolvePythonCommand(
  templeConfig: vscode.WorkspaceConfiguration,
  outputChannel: vscode.OutputChannel,
  probeEnv: NodeJS.ProcessEnv
): string {
  const pythonConfig = vscode.workspace.getConfiguration('python');
  const configuredTemplePython = templeConfig.get<string>('pythonPath', '');
  const configuredDefaultPython =
    pythonConfig.get<string>('defaultInterpreterPath', '');
  const configuredLegacyPython = pythonConfig.get<string>('pythonPath', '');

  const roots = workspaceRoots();
  const searchRoots = dedupe([...roots, ...roots.map((root) => path.dirname(root))]);
  const discoveredPaths: string[] = [];
  const suffixes = [
    path.join('.ci-venv', 'bin', 'python'),
    path.join('.venv', 'bin', 'python'),
    path.join('venv', 'bin', 'python'),
    path.join('.ci-venv', 'Scripts', 'python.exe'),
    path.join('.venv', 'Scripts', 'python.exe'),
    path.join('venv', 'Scripts', 'python.exe'),
    path.join('temple-linter', '.ci-venv', 'bin', 'python'),
    path.join('temple-linter', '.venv', 'bin', 'python'),
    path.join('temple-linter', 'venv', 'bin', 'python'),
    path.join('temple-linter', '.ci-venv', 'Scripts', 'python.exe'),
    path.join('temple-linter', '.venv', 'Scripts', 'python.exe'),
    path.join('temple-linter', 'venv', 'Scripts', 'python.exe'),
  ];
  for (const root of searchRoots) {
    for (const suffix of suffixes) {
      discoveredPaths.push(path.join(root, suffix));
    }
  }

  const rawCandidates = dedupe([
    configuredTemplePython,
    ...discoveredPaths,
    configuredDefaultPython,
    configuredLegacyPython,
    'python3',
    'python',
  ]);

  let firstExistingCandidate: string | undefined;

  for (const rawCandidate of rawCandidates) {
    if (!rawCandidate || !rawCandidate.trim()) {
      continue;
    }
    const normalizedCandidate = normalizePathValue(rawCandidate);
    if (!normalizedCandidate) {
      continue;
    }

    if (isPathLike(normalizedCandidate) && !fileExists(normalizedCandidate)) {
      outputChannel.appendLine(
        `[${EXTENSION_NAME}] Skipping missing Python interpreter candidate: ${normalizedCandidate}`
      );
      continue;
    }

    if (!firstExistingCandidate) {
      firstExistingCandidate = normalizedCandidate;
    }

    const probeResult = spawnSync(
      normalizedCandidate,
      [
        '-c',
        [
          'import importlib.util as util',
          'import sys',
          'required = ("lsprotocol", "pygls", "temple_linter")',
          'missing = [name for name in required if util.find_spec(name) is None]',
          'sys.exit(0 if not missing else 1)',
        ].join('; '),
      ],
      {
        env: probeEnv,
        encoding: 'utf-8',
      }
    );

    if (probeResult.error) {
      outputChannel.appendLine(
        `[${EXTENSION_NAME}] Skipping interpreter '${normalizedCandidate}': ${probeResult.error.message}`
      );
      continue;
    }

    if (probeResult.status !== 0) {
      const probeDetails =
        probeResult.stderr?.trim() ||
        probeResult.stdout?.trim() ||
        `exit code ${String(probeResult.status)}`;
      outputChannel.appendLine(
        `[${EXTENSION_NAME}] Skipping interpreter '${normalizedCandidate}' because required modules are missing (${probeDetails}).`
      );
      continue;
    }

    outputChannel.appendLine(
      `[${EXTENSION_NAME}] Using Python interpreter: ${normalizedCandidate}`
    );
    return normalizedCandidate;
  }

  if (firstExistingCandidate) {
    outputChannel.appendLine(
      `[${EXTENSION_NAME}] No interpreter satisfied module checks; falling back to: ${firstExistingCandidate}`
    );
    return firstExistingCandidate;
  }

  outputChannel.appendLine(
    `[${EXTENSION_NAME}] No Python interpreter candidates found; falling back to: python`
  );
  return 'python';
}

function resolveServerCwd(
  context: vscode.ExtensionContext,
  templeConfig: vscode.WorkspaceConfiguration,
  outputChannel: vscode.OutputChannel
): string | undefined {
  const configuredServerRoot = templeConfig.get<string>('serverRoot', '');
  const roots = workspaceRoots();
  const candidates: string[] = [];
  if (configuredServerRoot && configuredServerRoot.trim()) {
    candidates.push(normalizePathValue(configuredServerRoot));
  }

  for (const root of roots) {
    candidates.push(root);
    candidates.push(path.join(root, 'temple-linter'));
  }
  candidates.push(path.resolve(context.extensionPath, '..', 'temple-linter'));

  const uniqueCandidates = dedupe(candidates.filter(Boolean));

  for (const candidate of uniqueCandidates) {
    const hasProjectMarkers =
      fileExists(path.join(candidate, 'pyproject.toml')) &&
      directoryExists(path.join(candidate, 'src', 'temple_linter'));
    if (hasProjectMarkers) {
      outputChannel.appendLine(`[${EXTENSION_NAME}] Using server cwd: ${candidate}`);
      return candidate;
    }
  }

  for (const candidate of uniqueCandidates) {
    if (directoryExists(candidate)) {
      outputChannel.appendLine(
        `[${EXTENSION_NAME}] Using fallback server cwd: ${candidate}`
      );
      return candidate;
    }
  }

  outputChannel.appendLine(`[${EXTENSION_NAME}] No server cwd resolved; using default process cwd`);
  return undefined;
}

function buildServerEnv(
  serverCwd: string | undefined
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const pythonPathEntries: string[] = [];

  if (serverCwd) {
    const serverSrc = path.join(serverCwd, 'src');
    if (directoryExists(serverSrc)) {
      pythonPathEntries.push(serverSrc);
    }
  }

  for (const root of workspaceRoots()) {
    const linterSrc = path.join(root, 'temple-linter', 'src');
    const coreSrc = path.join(root, 'temple', 'src');
    if (directoryExists(linterSrc)) {
      pythonPathEntries.push(linterSrc);
    }
    if (directoryExists(coreSrc)) {
      pythonPathEntries.push(coreSrc);
    }
  }

  const uniqueEntries = dedupe(pythonPathEntries);
  if (uniqueEntries.length === 0) {
    return env;
  }

  const existingPythonPath = env.PYTHONPATH;
  env.PYTHONPATH = existingPythonPath
    ? `${uniqueEntries.join(path.delimiter)}${path.delimiter}${existingPythonPath}`
    : uniqueEntries.join(path.delimiter);
  return env;
}

function isBaseDiagnosticsRequest(value: unknown): value is BaseDiagnosticsRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as Partial<BaseDiagnosticsRequest>;
  const formatOk =
    maybe.detectedFormat === undefined || typeof maybe.detectedFormat === 'string';
  return (
    typeof maybe.uri === 'string' &&
    typeof maybe.content === 'string' &&
    formatOk
  );
}

function isCreateVirtualDocumentParams(
  value: unknown
): value is CreateVirtualDocumentParams {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as Partial<CreateVirtualDocumentParams>;
  return typeof maybe.uri === 'string' && typeof maybe.content === 'string';
}

function isPublishNodeDiagnosticsParams(
  value: unknown
): value is PublishNodeDiagnosticsParams {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as Partial<PublishNodeDiagnosticsParams>;
  return (
    typeof maybe.uri === 'string' &&
    Array.isArray(maybe.diagnostics)
  );
}

function isTemplateTokenSpanPayload(value: unknown): value is TemplateTokenSpanPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as Partial<TemplateTokenSpanPayload>;
  return (
    typeof maybe.startOffset === 'number' &&
    Number.isFinite(maybe.startOffset) &&
    typeof maybe.endOffset === 'number' &&
    Number.isFinite(maybe.endOffset) &&
    typeof maybe.tokenType === 'string'
  );
}

function isBaseProjectionResponse(value: unknown): value is BaseProjectionResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as Partial<BaseProjectionResponse>;
  return (
    typeof maybe.cleanedText === 'string' &&
    Array.isArray(maybe.cleanedToSourceOffsets) &&
    Array.isArray(maybe.sourceToCleanedOffsets) &&
    Array.isArray(maybe.templateTokenSpans) &&
    maybe.cleanedToSourceOffsets.every((entry) => typeof entry === 'number') &&
    maybe.sourceToCleanedOffsets.every((entry) => typeof entry === 'number') &&
    maybe.templateTokenSpans.every(isTemplateTokenSpanPayload)
  );
}

function lineStartsForText(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetForPosition(
  lineStarts: number[],
  position: vscode.Position,
  textLength: number
): number {
  if (position.line <= 0) {
    return Math.min(Math.max(position.character, 0), textLength);
  }
  if (position.line >= lineStarts.length) {
    return textLength;
  }
  return Math.min(
    Math.max(lineStarts[position.line] + Math.max(position.character, 0), 0),
    textLength
  );
}

function positionForOffset(lineStarts: number[], offset: number): vscode.Position {
  const clamped = Math.max(offset, 0);
  let line = 0;
  while (line + 1 < lineStarts.length && lineStarts[line + 1] <= clamped) {
    line += 1;
  }
  return new vscode.Position(line, clamped - lineStarts[line]);
}

function sanitizeOffsets(
  rawOffsets: number[],
  expectedLength: number,
  maxValue: number
): number[] {
  const sanitized: number[] = [];
  for (let index = 0; index < expectedLength; index += 1) {
    const current = rawOffsets[index] ?? rawOffsets[rawOffsets.length - 1] ?? 0;
    const normalized = Math.min(Math.max(Math.floor(current), 0), maxValue);
    sanitized.push(normalized);
  }
  return sanitized;
}

function invertOffsets(
  targetToSourceOffsets: number[],
  sourceLength: number,
  targetLength: number
): number[] {
  const sourceToTarget = new Array<number>(sourceLength + 1).fill(0);
  for (let targetOffset = 0; targetOffset < targetToSourceOffsets.length; targetOffset += 1) {
    const sourceOffset = targetToSourceOffsets[targetOffset];
    if (sourceOffset < 0 || sourceOffset > sourceLength) {
      continue;
    }
    if (sourceToTarget[sourceOffset] === 0 || targetOffset < sourceToTarget[sourceOffset]) {
      sourceToTarget[sourceOffset] = targetOffset;
    }
  }
  let previous = 0;
  for (let index = 0; index < sourceToTarget.length; index += 1) {
    if (sourceToTarget[index] === 0 && index !== 0) {
      sourceToTarget[index] = previous;
      continue;
    }
    previous = sourceToTarget[index];
  }
  sourceToTarget[sourceLength] = targetLength;
  return sourceToTarget;
}

function buildProjectionSnapshot(
  sourceText: string,
  projection: BaseProjectionResponse
): ProjectionSnapshot {
  const targetText = projection.cleanedText;
  const cleanedToSourceOffsets = sanitizeOffsets(
    projection.cleanedToSourceOffsets,
    targetText.length,
    sourceText.length
  );
  const sourceToCleanedOffsets = sanitizeOffsets(
    projection.sourceToCleanedOffsets,
    sourceText.length + 1,
    targetText.length
  );
  const unsafeSourceOffsetRanges = projection.templateTokenSpans
    .filter((span) => span.tokenType !== 'text')
    .map((span) => ({
      start: Math.min(Math.max(Math.floor(span.startOffset), 0), sourceText.length),
      end: Math.min(Math.max(Math.floor(span.endOffset), 0), sourceText.length),
    }))
    .filter((span) => span.end > span.start);

  return {
    sourceText,
    targetText,
    cleanedToSourceOffsets,
    sourceToCleanedOffsets:
      sourceToCleanedOffsets.length === sourceText.length + 1
        ? sourceToCleanedOffsets
        : invertOffsets(cleanedToSourceOffsets, sourceText.length, targetText.length),
    sourceLineStarts: lineStartsForText(sourceText),
    targetLineStarts: lineStartsForText(targetText),
    unsafeSourceOffsetRanges,
  };
}

function identityProjection(sourceText: string): ProjectionSnapshot {
  const offsets = Array.from({ length: sourceText.length }, (_, index) => index);
  const sourceToTarget = Array.from(
    { length: sourceText.length + 1 },
    (_, index) => index
  );
  return {
    sourceText,
    targetText: sourceText,
    cleanedToSourceOffsets: offsets,
    sourceToCleanedOffsets: sourceToTarget,
    sourceLineStarts: lineStartsForText(sourceText),
    targetLineStarts: lineStartsForText(sourceText),
    unsafeSourceOffsetRanges: [],
  };
}

function mapSourcePositionToTarget(
  position: vscode.Position,
  projection: ProjectionSnapshot | undefined
): vscode.Position {
  if (!projection) {
    return position;
  }
  const sourceOffset = offsetForPosition(
    projection.sourceLineStarts,
    position,
    projection.sourceText.length
  );
  const targetOffset =
    sourceOffset >= projection.sourceToCleanedOffsets.length
      ? projection.targetText.length
      : projection.sourceToCleanedOffsets[sourceOffset];
  return positionForOffset(projection.targetLineStarts, targetOffset);
}

function mapTargetPositionToSource(
  position: vscode.Position,
  projection: ProjectionSnapshot | undefined
): vscode.Position {
  if (!projection) {
    return position;
  }
  const targetOffset = offsetForPosition(
    projection.targetLineStarts,
    position,
    projection.targetText.length
  );
  const sourceOffset =
    targetOffset >= projection.cleanedToSourceOffsets.length
      ? projection.sourceText.length
      : projection.cleanedToSourceOffsets[targetOffset];
  return positionForOffset(projection.sourceLineStarts, sourceOffset);
}

function mapSourceRangeToTarget(
  range: vscode.Range,
  projection: ProjectionSnapshot | undefined
): vscode.Range {
  if (!projection) {
    return range;
  }
  return new vscode.Range(
    mapSourcePositionToTarget(range.start, projection),
    mapSourcePositionToTarget(range.end, projection)
  );
}

function mapTargetRangeToSource(
  range: vscode.Range,
  projection: ProjectionSnapshot | undefined
): vscode.Range {
  if (!projection) {
    return range;
  }
  return new vscode.Range(
    mapTargetPositionToSource(range.start, projection),
    mapTargetPositionToSource(range.end, projection)
  );
}

function overlapsUnsafeSourceRange(
  range: vscode.Range,
  projection: ProjectionSnapshot | undefined
): boolean {
  if (!projection || projection.unsafeSourceOffsetRanges.length === 0) {
    return false;
  }
  const startOffset = offsetForPosition(
    projection.sourceLineStarts,
    range.start,
    projection.sourceText.length
  );
  const endOffset = offsetForPosition(
    projection.sourceLineStarts,
    range.end,
    projection.sourceText.length
  );
  const normalizedStart = Math.min(startOffset, endOffset);
  const normalizedEnd = Math.max(startOffset, endOffset);
  for (const unsafeRange of projection.unsafeSourceOffsetRanges) {
    if (normalizedStart === normalizedEnd) {
      if (normalizedStart >= unsafeRange.start && normalizedStart < unsafeRange.end) {
        return true;
      }
      continue;
    }
    if (normalizedStart < unsafeRange.end && normalizedEnd > unsafeRange.start) {
      return true;
    }
  }
  return false;
}

type DecodedSemanticToken = {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
};

function decodeSemanticTokens(data: ArrayLike<number>): DecodedSemanticToken[] {
  const tokens: DecodedSemanticToken[] = [];
  let line = 0;
  let startChar = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = data[index];
    const deltaStart = data[index + 1];
    line += deltaLine;
    startChar = deltaLine === 0 ? startChar + deltaStart : deltaStart;
    tokens.push({
      line,
      startChar,
      length: data[index + 2],
      tokenType: data[index + 3],
      tokenModifiers: data[index + 4],
    });
  }
  return tokens;
}

function encodeSemanticTokens(tokens: DecodedSemanticToken[]): Uint32Array {
  const ordered = [...tokens].sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    return left.startChar - right.startChar;
  });
  const encoded: number[] = [];
  let previousLine = 0;
  let previousStartChar = 0;
  for (const token of ordered) {
    const deltaLine = token.line - previousLine;
    const deltaStart =
      deltaLine === 0 ? token.startChar - previousStartChar : token.startChar;
    encoded.push(
      Math.max(deltaLine, 0),
      Math.max(deltaStart, 0),
      Math.max(token.length, 0),
      Math.max(token.tokenType, 0),
      Math.max(token.tokenModifiers, 0)
    );
    previousLine = token.line;
    previousStartChar = token.startChar;
  }
  return new Uint32Array(encoded);
}

function remapSemanticTokensToSource(
  tokens: vscode.SemanticTokens | undefined,
  projection: ProjectionSnapshot | undefined
): vscode.SemanticTokens | undefined {
  if (!tokens || !projection) {
    return tokens;
  }
  const decoded = decodeSemanticTokens(tokens.data);
  const remapped: DecodedSemanticToken[] = [];
  for (const token of decoded) {
    const targetStart = new vscode.Position(token.line, token.startChar);
    const targetEnd = new vscode.Position(token.line, token.startChar + token.length);
    const sourceStart = mapTargetPositionToSource(targetStart, projection);
    const sourceEnd = mapTargetPositionToSource(targetEnd, projection);
    if (sourceStart.line !== sourceEnd.line) {
      continue;
    }
    const length = Math.max(sourceEnd.character - sourceStart.character, 0);
    if (length === 0) {
      continue;
    }
    remapped.push({
      line: sourceStart.line,
      startChar: sourceStart.character,
      length,
      tokenType: token.tokenType,
      tokenModifiers: token.tokenModifiers,
    });
  }
  return new vscode.SemanticTokens(encodeSemanticTokens(remapped), tokens.resultId);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function normalizeSemanticContext(
  value: JsonObject | undefined
): JsonObject | undefined {
  if (!value) {
    return undefined;
  }
  return Object.keys(value).length > 0 ? value : undefined;
}

function resolveWorkspacePath(rawPath: string): string {
  const normalized = normalizePathValue(rawPath);
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return normalized;
  }
  return path.join(workspaceFolder.uri.fsPath, normalized);
}

function loadSemanticSchema(schemaPath: string): JsonObject | undefined {
  const resolved = resolveWorkspacePath(schemaPath);
  try {
    const schemaText = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(schemaText) as unknown;
    return asJsonObject(parsed);
  } catch (error) {
    console.warn(`Failed to load temple semantic schema from '${resolved}':`, error);
    return undefined;
  }
}

function toVsRange(range: LspRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}

function normalizeCode(code: unknown): string | number | undefined {
  if (typeof code === 'string' || typeof code === 'number') {
    return code;
  }
  if (code && typeof code === 'object' && 'value' in code) {
    const value = (code as { value?: unknown }).value;
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

function mapSeverity(
  severity: vscode.DiagnosticSeverity | undefined
): LspDiagnostic['severity'] | undefined {
  if (severity === undefined) {
    return undefined;
  }

  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 1;
    case vscode.DiagnosticSeverity.Warning:
      return 2;
    case vscode.DiagnosticSeverity.Information:
      return 3;
    case vscode.DiagnosticSeverity.Hint:
      return 4;
    default:
      return undefined;
  }
}

function vscDiagToLspDiag(diag: vscode.Diagnostic): LspDiagnostic {
  const relatedInformation = diag.relatedInformation?.map((ri) => ({
    location: {
      uri: ri.location.uri.toString(),
      range: ri.location.range,
    },
    message: ri.message,
  }));

  return {
    range: diag.range,
    message: diag.message,
    severity: mapSeverity(diag.severity),
    code: normalizeCode(diag.code),
    source: diag.source,
    relatedInformation,
    tags: diag.tags,
  };
}

function lspDiagToVscDiag(diag: LspDiagnostic): vscode.Diagnostic {
  const range = toVsRange(diag.range as unknown as LspRange);
  const severity =
    diag.severity === 1
      ? vscode.DiagnosticSeverity.Error
      : diag.severity === 2
      ? vscode.DiagnosticSeverity.Warning
      : diag.severity === 3
      ? vscode.DiagnosticSeverity.Information
      : vscode.DiagnosticSeverity.Hint;

  const vscodeDiagnostic = new vscode.Diagnostic(
    range,
    diag.message || '',
    severity
  );

  if (diag.source) {
    vscodeDiagnostic.source = diag.source;
  }
  if (diag.code !== undefined) {
    vscodeDiagnostic.code = normalizeCode(diag.code);
  }
  if (diag.tags) {
    vscodeDiagnostic.tags = diag.tags;
  }

  return vscodeDiagnostic;
}

async function collectDiagnosticsForVirtualUri(
  virtualUri: vscode.Uri,
  expectedVersion: number
): Promise<vscode.Diagnostic[]> {
  const uriKey = virtualUri.toString();
  if ((cleanedContentVersionMap.get(uriKey) ?? 0) !== expectedVersion) {
    return [];
  }

  await vscode.workspace.openTextDocument(virtualUri);

  await new Promise<void>((resolve) => {
    let settled = false;
    let settleTimer: NodeJS.Timeout | undefined;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      clearTimeout(timeoutTimer);
      diagnosticsSub.dispose();
      resolve();
    };

    const diagnosticsSub = vscode.languages.onDidChangeDiagnostics((event) => {
      if (!event.uris.some((uri) => uri.toString() === uriKey)) {
        return;
      }
      if ((cleanedContentVersionMap.get(uriKey) ?? 0) !== expectedVersion) {
        finish();
        return;
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(finish, 25);
    });

    const timeoutTimer = setTimeout(finish, 350);
  });

  if ((cleanedContentVersionMap.get(uriKey) ?? 0) !== expectedVersion) {
    return [];
  }

  return vscode.languages.getDiagnostics(virtualUri);
}

function normalizeDetectedFormat(format: string | undefined): string {
  return (format || '').trim().toLowerCase();
}

function normalizeBaseLintStrategyMode(
  mode: string | undefined
): BaseLintStrategyMode {
  if (mode === 'embedded' || mode === 'vscode') {
    return mode;
  }
  return 'auto';
}

function normalizeBaseLspBridgeMode(
  mode: string | undefined
): BaseLspBridgeMode {
  if (mode === 'off' || mode === 'full') {
    return mode;
  }
  return 'full';
}

function normalizeBaseLspParityBaseline(
  value: string | undefined
): BaseLspParityBaseline {
  if (value === 'official-defaults') {
    return value;
  }
  return 'official-defaults';
}

function normalizeBaseLintLogLevel(
  level: string | undefined
): BaseLintLogLevel {
  if (
    level === 'error' ||
    level === 'warn' ||
    level === 'info' ||
    level === 'debug' ||
    level === 'trace'
  ) {
    return level;
  }
  return 'warn';
}

function shouldLogBaseLint(
  configuredLevel: BaseLintLogLevel,
  messageLevel: BaseLintLogLevel
): boolean {
  return LOG_LEVEL_ORDER[messageLevel] <= LOG_LEVEL_ORDER[configuredLevel];
}

function logBridgeDowngradeOnce(
  capability: string,
  detail: string,
  outputChannel: vscode.OutputChannel
): void {
  const key = `${capability}:${detail}`;
  if (bridgeDowngradeLogSet.has(key)) {
    return;
  }
  bridgeDowngradeLogSet.add(key);
  outputChannel.appendLine(
    `[${EXTENSION_NAME}] Base-LSP bridge downgrade (${capability}): ${detail}`
  );
}

async function requestProjectionSnapshot(
  sourceDocument: vscode.TextDocument,
  detectedFormat: string,
  outputChannel: vscode.OutputChannel
): Promise<ProjectionSnapshot> {
  if (!client) {
    return identityProjection(sourceDocument.getText());
  }
  try {
    const response = await client.sendRequest(TEMPLE_GET_BASE_PROJECTION_METHOD, {
      uri: sourceDocument.uri.toString(),
      content: sourceDocument.getText(),
      detectedFormat,
    });
    if (!isBaseProjectionResponse(response)) {
      logBridgeDowngradeOnce(
        'projection',
        'invalid projection payload; using identity mapping',
        outputChannel
      );
      return identityProjection(sourceDocument.getText());
    }
    return buildProjectionSnapshot(sourceDocument.getText(), response);
  } catch (error) {
    logBridgeDowngradeOnce(
      'projection',
      `projection request failed (${String(error)}); using identity mapping`,
      outputChannel
    );
    return identityProjection(sourceDocument.getText());
  }
}

export function resolveBaseLintStrategy(
  params: ResolveBaseLintStrategyParams
): BaseLintStrategyDecision {
  const { mode, detectedFormat, capabilities } = params;
  const formatLabel = detectedFormat || 'unknown';
  const preferEmbedded = mode === 'auto' || mode === 'embedded';

  if (preferEmbedded && capabilities.hasEmbeddedAdapter) {
    return {
      strategy: 'embedded',
      reason: `embedded adapter registered for ${formatLabel}`,
    };
  }

  if (capabilities.supportsVirtualDocument) {
    return {
      strategy: 'virtual',
      reason:
        mode === 'vscode'
          ? `vscode mode selected virtual strategy for ${formatLabel}`
          : `no embedded adapter available for ${formatLabel}; using virtual strategy`,
    };
  }

  if (capabilities.supportsMirrorFile) {
    return {
      strategy: 'mirror-file',
      reason: `virtual strategy unsupported for ${formatLabel}; using mirror-file fallback`,
    };
  }

  return {
    strategy: 'virtual',
    reason: `no explicit capabilities for ${formatLabel}; using virtual fallback`,
  };
}

function extensionForDetectedFormat(format: string): string {
  switch (format) {
    case 'md':
    case 'markdown':
      return '.md';
    case 'json':
      return '.json';
    case 'yaml':
      return '.yaml';
    case 'xml':
      return '.xml';
    case 'html':
      return '.html';
    case 'toml':
      return '.toml';
    default:
      return '.txt';
  }
}

function languageIdToDetectedFormat(languageId: string): string {
  switch (languageId) {
    case 'templ-markdown':
      return 'markdown';
    case 'templ-json':
      return 'json';
    case 'templ-yaml':
      return 'yaml';
    case 'templ-html':
      return 'html';
    case 'templ-xml':
      return 'xml';
    case 'templ-toml':
      return 'toml';
    default:
      return '';
  }
}

function isTemplatedLanguageId(languageId: string): boolean {
  return TEMPLATED_LANGUAGE_IDS.has(languageId);
}

function stripTempleSuffixFromFsPath(
  fsPath: string,
  templeExtensions: string[]
): string {
  const normalizedPath = fsPath.toLowerCase();
  for (const extension of templeExtensions) {
    const normalizedExtension = normalizeTempleExtension(extension).toLowerCase();
    if (!normalizedExtension) {
      continue;
    }
    if (normalizedPath.endsWith(normalizedExtension)) {
      return fsPath.slice(0, fsPath.length - normalizedExtension.length);
    }
  }
  return fsPath;
}

function baseUriFromTemplateUri(
  sourceUri: vscode.Uri,
  templeExtensions: string[]
): vscode.Uri {
  if (sourceUri.scheme !== 'file') {
    return sourceUri;
  }
  return vscode.Uri.file(
    stripTempleSuffixFromFsPath(sourceUri.fsPath, templeExtensions)
  );
}

function stableTempPathFor(originalUri: vscode.Uri, fileExtension: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(originalUri.toString())
    .digest('hex')
    .slice(0, 16);
  const root = baseLintStorageRoot ?? path.join(os.tmpdir(), MIRROR_GHOST_DIRNAME);
  fs.mkdirSync(root, { recursive: true });
  tempBaseLintDirectories.add(root);
  return path.join(root, `${hash}${fileExtension}`);
}

function resolveMirrorFileTargetUri(
  originalUri: vscode.Uri,
  detectedFormat: string
): vscode.Uri {
  const existing = tempBaseLintFileMap.get(originalUri.toString());
  if (existing) {
    return vscode.Uri.file(existing);
  }

  const ext = extensionForDetectedFormat(detectedFormat);
  const mirrorPath = stableTempPathFor(originalUri, ext);

  tempBaseLintFileMap.set(originalUri.toString(), mirrorPath);
  return vscode.Uri.file(mirrorPath);
}

function cleanupMirrorFileTargetUri(targetUri: vscode.Uri): void {
  if (targetUri.scheme !== 'file') {
    return;
  }
  try {
    if (fileExists(targetUri.fsPath)) {
      fs.unlinkSync(targetUri.fsPath);
    }
  } catch {
    // Best effort cleanup.
  }
}

function cleanupMirrorDirectories(): void {
  const dirs = [...tempBaseLintDirectories].sort(
    (a, b) => b.length - a.length
  );
  for (const dirPath of dirs) {
    try {
      if (!directoryExists(dirPath)) {
        continue;
      }
      const entries = fs.readdirSync(dirPath);
      if (entries.length === 0) {
        fs.rmdirSync(dirPath);
      }
    } catch {
      // Best effort cleanup.
    }
  }
}

function resetBaseLintSessionCaches(): void {
  cleanedContentMap.clear();
  cleanedContentVersionMap.clear();
  tempBaseLintFileMap.clear();
  tempBaseLintDirectories.clear();
  shadowDocHandles.clear();
  sourceToBaseUriMap.clear();
}

function cleanupShadowHandle(baseUriKey: string): void {
  const existing = shadowDocHandles.get(baseUriKey);
  if (!existing) {
    return;
  }
  if (existing.strategy === 'mirror-file') {
    cleanupMirrorFileTargetUri(existing.targetUri);
    cleanupMirrorDirectories();
  } else {
    cleanedContentMap.delete(existing.targetUri.toString());
  }
  cleanedContentVersionMap.delete(existing.targetUri.toString());
  shadowDocHandles.delete(baseUriKey);
}

function cleanupShadowHandlesForSourceUri(
  sourceUri: vscode.Uri,
  templeExtensions: string[]
): void {
  const sourceKey = sourceUri.toString();
  const baseUriKey =
    sourceToBaseUriMap.get(sourceKey) ??
    baseUriFromTemplateUri(sourceUri, templeExtensions).toString();
  sourceToBaseUriMap.delete(sourceKey);

  const stillOpen = vscode.workspace.textDocuments.some((doc) => {
    if (doc.uri.toString() === sourceKey) {
      return false;
    }
    if (!isTemplatedLanguageId(doc.languageId)) {
      return false;
    }
    const candidateBase = baseUriFromTemplateUri(doc.uri, templeExtensions).toString();
    return candidateBase === baseUriKey;
  });
  if (!stillOpen) {
    cleanupShadowHandle(baseUriKey);
  }
}

function remapLocationLikeToSource(
  value: vscode.Location | vscode.LocationLink,
  shadow: ShadowDocHandle,
  sourceUri: vscode.Uri
): vscode.Location | vscode.LocationLink {
  if (value instanceof vscode.Location) {
    if (value.uri.toString() !== shadow.targetUri.toString()) {
      return value;
    }
    return new vscode.Location(
      sourceUri,
      mapTargetRangeToSource(value.range, shadow.projection)
    );
  }

  if (value.targetUri.toString() !== shadow.targetUri.toString()) {
    return value;
  }
  return {
    ...value,
    targetUri: sourceUri,
    targetRange: mapTargetRangeToSource(value.targetRange, shadow.projection),
    targetSelectionRange: value.targetSelectionRange
      ? mapTargetRangeToSource(value.targetSelectionRange, shadow.projection)
      : value.targetSelectionRange,
  };
}

function remapTextEditsToSource(
  edits: readonly vscode.TextEdit[] | undefined,
  shadow: ShadowDocHandle
): { edits: vscode.TextEdit[]; blocked: boolean } {
  if (!edits) {
    return { edits: [], blocked: false };
  }
  let blocked = false;
  const remapped: vscode.TextEdit[] = [];
  for (const edit of edits) {
    const mappedRange = mapTargetRangeToSource(edit.range, shadow.projection);
    if (overlapsUnsafeSourceRange(mappedRange, shadow.projection)) {
      blocked = true;
      continue;
    }
    remapped.push(new vscode.TextEdit(mappedRange, edit.newText));
  }
  return { edits: remapped, blocked };
}

function remapWorkspaceEditToSource(
  edit: vscode.WorkspaceEdit,
  shadow: ShadowDocHandle,
  sourceUri: vscode.Uri
): { edit: vscode.WorkspaceEdit; blocked: boolean } {
  const remapped = new vscode.WorkspaceEdit();
  let blocked = false;
  for (const [uri, edits] of edit.entries()) {
    if (uri.toString() === shadow.targetUri.toString()) {
      const mapped = remapTextEditsToSource(edits, shadow);
      blocked = blocked || mapped.blocked;
      remapped.set(sourceUri, mapped.edits);
      continue;
    }
    remapped.set(uri, edits ? [...edits] : []);
  }
  return { edit: remapped, blocked };
}

function remapSymbolLikeToSource(
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation,
  shadow: ShadowDocHandle,
  sourceUri: vscode.Uri
): vscode.DocumentSymbol | vscode.SymbolInformation {
  if (symbol instanceof vscode.SymbolInformation) {
    if (symbol.location.uri.toString() !== shadow.targetUri.toString()) {
      return symbol;
    }
    return new vscode.SymbolInformation(
      symbol.name,
      symbol.kind,
      symbol.containerName,
      new vscode.Location(
        sourceUri,
        mapTargetRangeToSource(symbol.location.range, shadow.projection)
      )
    );
  }

  const mapped = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail,
    symbol.kind,
    mapTargetRangeToSource(symbol.range, shadow.projection),
    mapTargetRangeToSource(symbol.selectionRange, shadow.projection)
  );
  mapped.children = symbol.children.map((child) =>
    remapSymbolLikeToSource(child, shadow, sourceUri)
  ) as vscode.DocumentSymbol[];
  mapped.tags = symbol.tags;
  return mapped;
}

async function ensureShadowDocumentForSource(
  sourceDocument: vscode.TextDocument,
  options: {
    strategyMode: BaseLintStrategyMode;
    capabilityRegistry: BaseLintCapabilityRegistry;
    templeExtensions: string[];
    virtualDocumentChangeEmitter: vscode.EventEmitter<vscode.Uri>;
    outputChannel: vscode.OutputChannel;
    logLevel: BaseLintLogLevel;
  }
): Promise<ShadowDocHandle | undefined> {
  if (!isTemplatedLanguageId(sourceDocument.languageId)) {
    return undefined;
  }
  const detectedFromLanguage = languageIdToDetectedFormat(sourceDocument.languageId);
  const detectedFormat = detectedFromLanguage || 'unknown';
  const sourceUri = sourceDocument.uri;
  const baseUri = baseUriFromTemplateUri(sourceUri, options.templeExtensions);
  const baseUriKey = baseUri.toString();
  sourceToBaseUriMap.set(sourceUri.toString(), baseUriKey);
  const existing = shadowDocHandles.get(baseUriKey);
  if (
    existing &&
    existing.version === sourceDocument.version &&
    existing.sourceUri.toString() === sourceUri.toString()
  ) {
    return existing;
  }

  const strategyDecision = resolveBaseLintStrategy({
    mode: options.strategyMode,
    detectedFormat,
    capabilities: options.capabilityRegistry.capabilitiesForFormat(detectedFormat),
  });
  const strategy =
    strategyDecision.strategy === 'embedded' ? 'virtual' : strategyDecision.strategy;
  const targetUri =
    strategy === 'mirror-file'
      ? resolveMirrorFileTargetUri(baseUri, detectedFormat)
      : baseUri.with({ scheme: VIRTUAL_SCHEME });
  const projection = await requestProjectionSnapshot(
    sourceDocument,
    detectedFormat,
    options.outputChannel
  );
  const shadowText = projection.targetText;

  const uriKey = targetUri.toString();
  const nextVersion = (cleanedContentVersionMap.get(uriKey) ?? 0) + 1;
  cleanedContentVersionMap.set(uriKey, nextVersion);
  if (strategy === 'mirror-file') {
    fs.writeFileSync(targetUri.fsPath, shadowText, 'utf8');
  } else {
    cleanedContentMap.set(uriKey, shadowText);
    options.virtualDocumentChangeEmitter.fire(targetUri);
  }
  shadowDocHandles.set(baseUriKey, {
    sourceUri,
    baseUri,
    targetUri,
    strategy,
    detectedFormat,
    version: sourceDocument.version,
    updatedAt: Date.now(),
    projection,
  });

  if (shouldLogBaseLint(options.logLevel, 'trace')) {
    options.outputChannel.appendLine(
      `[${EXTENSION_NAME}] Shadow doc ensured source=${sourceUri.toString()} base=${baseUriKey} target=${targetUri.toString()} strategy=${strategy}`
    );
  }
  return shadowDocHandles.get(baseUriKey);
}

function registerBaseLspBridgeProviders(
  context: vscode.ExtensionContext,
  options: {
    bridgeMode: BaseLspBridgeMode;
    strategyMode: BaseLintStrategyMode;
    capabilityRegistry: BaseLintCapabilityRegistry;
    templeExtensions: string[];
    virtualDocumentChangeEmitter: vscode.EventEmitter<vscode.Uri>;
    outputChannel: vscode.OutputChannel;
    logLevel: BaseLintLogLevel;
  }
): void {
  if (options.bridgeMode === 'off') {
    return;
  }
  const selector = BASE_LSP_PARITY_LANGUAGE_IDS.map((language) => ({ language }));
  const semanticLegend = new vscode.SemanticTokensLegend(
    [
      'namespace',
      'type',
      'class',
      'enum',
      'interface',
      'struct',
      'typeParameter',
      'parameter',
      'variable',
      'property',
      'enumMember',
      'event',
      'function',
      'method',
      'macro',
      'keyword',
      'modifier',
      'comment',
      'string',
      'number',
      'regexp',
      'operator',
      'decorator',
    ],
    [
      'declaration',
      'definition',
      'readonly',
      'static',
      'deprecated',
      'abstract',
      'async',
      'modification',
      'documentation',
      'defaultLibrary',
    ]
  );

  const withShadow = async (
    document: vscode.TextDocument
  ): Promise<ShadowDocHandle | undefined> =>
    ensureShadowDocumentForSource(document, {
      strategyMode: options.strategyMode,
      capabilityRegistry: options.capabilityRegistry,
      templeExtensions: options.templeExtensions,
      virtualDocumentChangeEmitter: options.virtualDocumentChangeEmitter,
      outputChannel: options.outputChannel,
      logLevel: options.logLevel,
    });
  const logBlockedEdits = (capability: string, uri: vscode.Uri) => {
    logBridgeDowngradeOnce(
      capability,
      `blocked edit overlapping Temple syntax for ${uri.toString()}`,
      options.outputChannel
    );
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, position, _token, contextInfo) {
          const shadow = await withShadow(document);
          if (!shadow) {
            return undefined;
          }
          const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
          return vscode.commands.executeCommand<
            vscode.CompletionList | vscode.CompletionItem[]
          >(
            'vscode.executeCompletionItemProvider',
            shadow.targetUri,
            targetPosition,
            contextInfo.triggerCharacter
          );
        },
      },
      '.',
      ':',
      '<',
      '"',
      "'",
      '/'
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return undefined;
        }
        const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          shadow.targetUri,
          targetPosition
        );
        const hover = hovers?.[0];
        if (!hover) {
          return hover;
        }
        if (!hover.range) {
          return hover;
        }
        return new vscode.Hover(
          hover.contents,
          mapTargetRangeToSource(hover.range, shadow.projection)
        );
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return undefined;
        }
        const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
        const result = await vscode.commands.executeCommand<
          Array<vscode.Location | vscode.LocationLink>
        >('vscode.executeDefinitionProvider', shadow.targetUri, targetPosition);
        if (!result) {
          return result;
        }
        const remapped = result.map((entry) =>
          remapLocationLikeToSource(entry, shadow, document.uri)
        );
        const allLocations = remapped.every((entry) => entry instanceof vscode.Location);
        if (allLocations) {
          return remapped as vscode.Location[];
        }
        return remapped.filter(
          (entry): entry is vscode.LocationLink => !(entry instanceof vscode.Location)
        );
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position, contextInfo) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return undefined;
        }
        const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
        const result = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          shadow.targetUri,
          targetPosition
        );
        if (!result) {
          return result;
        }
        if (!contextInfo.includeDeclaration) {
          return result
            .filter((entry) => {
              if (entry.uri.toString() !== shadow.targetUri.toString()) {
                return true;
              }
              return !entry.range.contains(targetPosition);
            })
            .map(
              (entry) =>
                remapLocationLikeToSource(entry, shadow, document.uri) as vscode.Location
            );
        }
        return result.map((entry) =>
          remapLocationLikeToSource(entry, shadow, document.uri)
        ) as vscode.Location[];
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        async provideCodeActions(document, range, contextInfo) {
          const shadow = await withShadow(document);
          if (!shadow) {
            return undefined;
          }
          const targetRange = mapSourceRangeToTarget(range, shadow.projection);
          const actions = await vscode.commands.executeCommand<
            Array<vscode.CodeAction | vscode.Command>
          >(
            'vscode.executeCodeActionProvider',
            shadow.targetUri,
            targetRange,
            contextInfo.only?.value
          );
          if (!actions) {
            return actions;
          }
          return actions.map((action) => {
            if (!(action instanceof vscode.CodeAction)) {
              return action;
            }
            if (!action.edit) {
              return action;
            }
            const clone = new vscode.CodeAction(action.title, action.kind);
            clone.command = action.command;
            clone.diagnostics = action.diagnostics?.map((diag) => {
              const mapped = new vscode.Diagnostic(
                mapTargetRangeToSource(diag.range, shadow.projection),
                diag.message,
                diag.severity
              );
              mapped.code = diag.code;
              mapped.source = diag.source;
              return mapped;
            });
            clone.isPreferred = action.isPreferred;
            clone.disabled = action.disabled;
            const remapped = remapWorkspaceEditToSource(action.edit, shadow, document.uri);
            if (remapped.blocked) {
              clone.disabled = {
                reason:
                  clone.disabled?.reason ??
                  'Temple bridge blocked edits that overlap template syntax',
              };
              logBlockedEdits('codeAction', document.uri);
            }
            clone.edit = remapped.edit;
            return clone;
          });
        },
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      async provideDocumentSymbols(document) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return undefined;
        }
        const symbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[] | vscode.SymbolInformation[]
        >('vscode.executeDocumentSymbolProvider', shadow.targetUri);
        if (!symbols) {
          return symbols;
        }
        return symbols.map((symbol) =>
          remapSymbolLikeToSource(symbol, shadow, document.uri)
        ) as vscode.DocumentSymbol[] | vscode.SymbolInformation[];
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerRenameProvider(selector, {
      async provideRenameEdits(document, position, newName) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return undefined;
        }
        const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
        const workspaceEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
          'vscode.executeDocumentRenameProvider',
          shadow.targetUri,
          targetPosition,
          newName
        );
        if (!workspaceEdit) {
          return undefined;
        }
        const remapped = remapWorkspaceEditToSource(workspaceEdit, shadow, document.uri);
        if (remapped.blocked) {
          logBlockedEdits('rename', document.uri);
          return undefined;
        }
        return remapped.edit;
      },
      async prepareRename(document, position) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return undefined;
        }
        const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
        const prepared = await vscode.commands.executeCommand<
          vscode.Range | { range: vscode.Range; placeholder: string } | undefined
        >('vscode.prepareRename', shadow.targetUri, targetPosition);
        if (!prepared) {
          return prepared;
        }
        if (prepared instanceof vscode.Range) {
          return mapTargetRangeToSource(prepared, shadow.projection);
        }
        return {
          ...prepared,
          range: mapTargetRangeToSource(prepared.range, shadow.projection),
        };
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      async provideDocumentFormattingEdits(document, options) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return [];
        }
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
          'vscode.executeFormatDocumentProvider',
          shadow.targetUri,
          options
        );
        const remapped = remapTextEditsToSource(edits, shadow);
        if (remapped.blocked) {
          logBlockedEdits('formatDocument', document.uri);
        }
        return remapped.edits;
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
      async provideDocumentRangeFormattingEdits(document, range, options) {
        const shadow = await withShadow(document);
        if (!shadow) {
          return [];
        }
        const targetRange = mapSourceRangeToTarget(range, shadow.projection);
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
          'vscode.executeFormatRangeProvider',
          shadow.targetUri,
          targetRange,
          options
        );
        const remapped = remapTextEditsToSource(edits, shadow);
        if (remapped.blocked) {
          logBlockedEdits('formatRange', document.uri);
        }
        return remapped.edits;
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerOnTypeFormattingEditProvider(
      selector,
      {
        async provideOnTypeFormattingEdits(document, position, ch, options) {
          const shadow = await withShadow(document);
          if (!shadow) {
            return [];
          }
          const targetPosition = mapSourcePositionToTarget(position, shadow.projection);
          const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatOnTypeProvider',
            shadow.targetUri,
            targetPosition,
            ch,
            options
          );
          const remapped = remapTextEditsToSource(edits, shadow);
          if (remapped.blocked) {
            logBlockedEdits('formatOnType', document.uri);
          }
          return remapped.edits;
        },
      },
      '\n',
      '}',
      ']'
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      {
        async provideDocumentSemanticTokens(document) {
          const shadow = await withShadow(document);
          if (!shadow) {
            return undefined;
          }
          const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
            'vscode.provideDocumentSemanticTokens',
            shadow.targetUri
          );
          const remapped = remapSemanticTokensToSource(tokens, shadow.projection);
          if (tokens && !remapped) {
            logBridgeDowngradeOnce(
              'semanticTokens',
              `unable to remap semantic tokens for ${document.uri.toString()}`,
              options.outputChannel
            );
          }
          return remapped;
        },
      },
      semanticLegend
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentRangeSemanticTokensProvider(
      selector,
      {
        async provideDocumentRangeSemanticTokens(
          document: vscode.TextDocument,
          range: vscode.Range
        ) {
          const shadow = await withShadow(document);
          if (!shadow) {
            return undefined;
          }
          const targetRange = mapSourceRangeToTarget(range, shadow.projection);
          const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
            'vscode.provideDocumentRangeSemanticTokens',
            shadow.targetUri,
            targetRange
          );
          return remapSemanticTokensToSource(tokens, shadow.projection);
        },
      },
      semanticLegend
    )
  );
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<{ __testing: typeof __testing }> {
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine(`[${EXTENSION_NAME}] Activating extension`);

  const virtualDocumentChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  context.subscriptions.push(virtualDocumentChangeEmitter);

  const providerDisposable = vscode.workspace.registerTextDocumentContentProvider(
    VIRTUAL_SCHEME,
    {
      onDidChange: virtualDocumentChangeEmitter.event,
      provideTextDocumentContent(uri) {
        return cleanedContentMap.get(uri.toString()) || '';
      },
    }
  );
  context.subscriptions.push(providerDisposable);

  const templeConfig = vscode.workspace.getConfiguration('temple');
  const userConfiguredTempleExtensions =
    hasUserConfiguredTempleExtensions(templeConfig);
  const templeExtensions = templeConfig.get<string[]>(
    'fileExtensions',
    DEFAULT_TEMPLE_EXTENSIONS
  );
  const normalizedTempleExtensions = dedupe(
    templeExtensions.map((ext) => normalizeTempleExtension(ext)).filter(Boolean)
  );
  let effectiveTempleExtensions = [...normalizedTempleExtensions];
  const semanticContext = normalizeSemanticContext(
    asJsonObject(templeConfig.get<unknown>('semanticContext'))
  );
  const semanticSchemaPathRaw = templeConfig.get<string>(
    'semanticSchemaPath',
    ''
  );
  const baseLintDebounceSeconds = templeConfig.get<number>(
    'baseLintDebounceSeconds',
    0.8
  );
  const traceBaseLintDiagnosticsLegacy = templeConfig.get<boolean>(
    'traceBaseLintDiagnostics',
    false
  );
  const baseLintLogLevel = normalizeBaseLintLogLevel(
    templeConfig.get<string>('baseLintLogLevel', 'warn')
  );
  const effectiveBaseLintLogLevel: BaseLintLogLevel =
    traceBaseLintDiagnosticsLegacy && baseLintLogLevel !== 'trace'
      ? 'trace'
      : baseLintLogLevel;
  const baseLintStrategyMode = normalizeBaseLintStrategyMode(
    templeConfig.get<string>('baseLintStrategyMode', 'auto')
  );
  const embeddedBaseLintFormats = templeConfig.get<string[]>(
    'embeddedBaseLintFormats',
    []
  );
  const baseLspBridgeMode = normalizeBaseLspBridgeMode(
    templeConfig.get<string>('baseLspBridgeMode', 'full')
  );
  const baseLspParityBaseline = normalizeBaseLspParityBaseline(
    templeConfig.get<string>('baseLspParityBaseline', 'official-defaults')
  );
  const capabilityRegistry = new DefaultBaseLintCapabilityRegistry(
    embeddedBaseLintFormats
  );
  const baseLintFocusMode = templeConfig.get<BaseLintFocusMode>(
    'baseLintFocusMode',
    templeConfig.get<BaseLintFocusMode>(
      // Backward compatibility for prior setting name.
      'markdownBaseLintFocusMode',
      'all'
    )
  );
  resetBaseLintSessionCaches();
  const storageRootCandidate =
    context.storageUri?.fsPath ?? context.globalStorageUri?.fsPath;
  if (storageRootCandidate) {
    baseLintStorageRoot = path.join(storageRootCandidate, 'temple-base-lint');
    fs.mkdirSync(baseLintStorageRoot, { recursive: true });
  }
  outputChannel.appendLine(
    `[${EXTENSION_NAME}] Base lint mode=${baseLintStrategyMode} focus=${baseLintFocusMode} logLevel=${effectiveBaseLintLogLevel} bridgeMode=${baseLspBridgeMode} parity=${baseLspParityBaseline}`
  );
  const semanticSchemaPath = semanticSchemaPathRaw
    ? resolveWorkspacePath(semanticSchemaPathRaw)
    : undefined;
  const semanticSchema = semanticSchemaPath
    ? loadSemanticSchema(semanticSchemaPath)
    : undefined;

  const fileWatchers = effectiveTempleExtensions.map((extension) =>
    vscode.workspace.createFileSystemWatcher(`**/*${extension}`)
  );
  context.subscriptions.push(...fileWatchers);

  const linterRoot = resolveServerCwd(context, templeConfig, outputChannel);
  const serverEnv = buildServerEnv(linterRoot);
  const pythonCommand = resolvePythonCommand(
    templeConfig,
    outputChannel,
    serverEnv
  );
  outputChannel.appendLine(
    `[${EXTENSION_NAME}] Starting language server: ${pythonCommand} -m temple_linter.lsp_server`
  );
  const serverOptions: ServerOptions = {
    command: pythonCommand,
    args: ['-m', 'temple_linter.lsp_server'],
    options: { cwd: linterRoot, env: serverEnv },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: buildDocumentSelector(effectiveTempleExtensions),
    synchronize: { fileEvents: fileWatchers },
    outputChannel,
    initializationOptions: {
      ...(userConfiguredTempleExtensions
        ? { templeExtensions: effectiveTempleExtensions }
        : {}),
      semanticContext: semanticContext ?? null,
      semanticSchema,
      semanticSchemaPath,
      baseLintDebounceSeconds,
      baseLintStrategyMode,
      embeddedBaseLintFormats,
      baseLspBridgeMode,
      baseLspParityBaseline,
    },
  };

  client = new LanguageClient(
    'templeLsp',
    EXTENSION_NAME,
    serverOptions,
    clientOptions
  );

  const nodeDiagCollection =
    vscode.languages.createDiagnosticCollection('temple-node');
  context.subscriptions.push(nodeDiagCollection);

  try {
    await client.start();
    outputChannel.appendLine(`[${EXTENSION_NAME}] Language server started`);
    if (!userConfiguredTempleExtensions) {
      const serverDefaultTempleExtensions = await resolveServerDefaultTempleExtensions(
        client,
        effectiveTempleExtensions,
        outputChannel
      );
      if (!sameStringArray(serverDefaultTempleExtensions, effectiveTempleExtensions)) {
        effectiveTempleExtensions = serverDefaultTempleExtensions;
        outputChannel.appendLine(
          `[${EXTENSION_NAME}] Using temple extensions from language server defaults: ${effectiveTempleExtensions.join(', ')}`
        );
      }
    }
  } catch (error) {
    outputChannel.appendLine(
      `[${EXTENSION_NAME}] Failed to start language server: ${String(error)}`
    );
    void vscode.window.showErrorMessage(
      `${EXTENSION_NAME} failed to start. See Output -> ${EXTENSION_NAME} for details.`
    );
    throw error;
  }

  registerBaseLspBridgeProviders(context, {
    bridgeMode: baseLspBridgeMode,
    strategyMode: baseLintStrategyMode,
    capabilityRegistry,
    templeExtensions: effectiveTempleExtensions,
    virtualDocumentChangeEmitter,
    outputChannel,
    logLevel: effectiveBaseLintLogLevel,
  });

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!isTemplatedLanguageId(doc.languageId)) {
        return;
      }
      cleanupShadowHandlesForSourceUri(doc.uri, effectiveTempleExtensions);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const doc = event.document;
      if (!isTemplatedLanguageId(doc.languageId)) {
        return;
      }
      const baseUri = baseUriFromTemplateUri(doc.uri, effectiveTempleExtensions);
      const existing = shadowDocHandles.get(baseUri.toString());
      if (!existing) {
        return;
      }
      void ensureShadowDocumentForSource(doc, {
        strategyMode: baseLintStrategyMode,
        capabilityRegistry,
        templeExtensions: effectiveTempleExtensions,
        virtualDocumentChangeEmitter,
        outputChannel,
        logLevel: effectiveBaseLintLogLevel,
      });
    })
  );

  client.onRequest(
    'temple/requestBaseDiagnostics',
    async (params: unknown): Promise<{ diagnostics: LspDiagnostic[] }> => {
      if (!isBaseDiagnosticsRequest(params)) {
        return { diagnostics: [] };
      }

      const originalUri = vscode.Uri.parse(params.uri);
      const normalizedFormat = normalizeDetectedFormat(params.detectedFormat);
      if (baseLintFocusMode === 'activeTemplate') {
        const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (!activeUri || activeUri !== originalUri.toString()) {
          return { diagnostics: [] };
        }
      }
      const strategyDecision = resolveBaseLintStrategy({
        mode: baseLintStrategyMode,
        detectedFormat: normalizedFormat,
        capabilities: capabilityRegistry.capabilitiesForFormat(normalizedFormat),
      });

      if (strategyDecision.strategy === 'embedded') {
        if (shouldLogBaseLint(effectiveBaseLintLogLevel, 'debug')) {
          outputChannel.appendLine(
            `[${EXTENSION_NAME}] Base lint strategy=embedded for ${originalUri.toString()} (${normalizedFormat || 'unknown'}): ${strategyDecision.reason}; expecting embedded diagnostics from linter`
          );
        }
        return { diagnostics: [] };
      }

      const targetUri =
        strategyDecision.strategy === 'mirror-file'
          ? resolveMirrorFileTargetUri(originalUri, normalizedFormat)
          : originalUri.with({ scheme: VIRTUAL_SCHEME });
      const sourceCandidate = effectiveTempleExtensions
        .map((extension) =>
          originalUri.scheme === 'file'
            ? vscode.Uri.file(`${originalUri.fsPath}${normalizeTempleExtension(extension)}`)
            : undefined
        )
        .find((candidate): candidate is vscode.Uri => {
          if (!candidate) {
            return false;
          }
          return vscode.workspace.textDocuments.some(
            (doc) => doc.uri.toString() === candidate.toString()
          );
        });
      if (sourceCandidate) {
        sourceToBaseUriMap.set(sourceCandidate.toString(), originalUri.toString());
      }

      const uriKey = targetUri.toString();
      const nextVersion = (cleanedContentVersionMap.get(uriKey) ?? 0) + 1;
      cleanedContentVersionMap.set(uriKey, nextVersion);
      if (strategyDecision.strategy === 'mirror-file') {
        fs.writeFileSync(targetUri.fsPath, params.content, 'utf8');
      } else {
        cleanedContentMap.set(uriKey, params.content);
        virtualDocumentChangeEmitter.fire(targetUri);
      }
      const existingShadow = shadowDocHandles.get(originalUri.toString());
      shadowDocHandles.set(originalUri.toString(), {
        sourceUri: sourceCandidate ?? existingShadow?.sourceUri ?? originalUri,
        baseUri: originalUri,
        targetUri,
        strategy: strategyDecision.strategy,
        detectedFormat: normalizedFormat,
        version: nextVersion,
        updatedAt: Date.now(),
        projection: existingShadow?.projection,
      });

      const diagnostics = await collectDiagnosticsForVirtualUri(targetUri, nextVersion);
      if (shouldLogBaseLint(effectiveBaseLintLogLevel, 'trace')) {
        const sources = dedupe(
          diagnostics
            .map((diag) => (diag.source ?? '').trim())
            .filter((source) => source.length > 0)
        );
        outputChannel.appendLine(
          `[${EXTENSION_NAME}] Base lint strategy=${strategyDecision.strategy} target=${targetUri.toString()} (${normalizedFormat || 'unknown'}) -> ${diagnostics.length} diagnostics` +
            ` [reason: ${strategyDecision.reason}]` +
            ` [publish-uri: ${originalUri.toString()}]` +
            (sources.length ? ` [sources: ${sources.join(', ')}]` : '')
        );
      }
      return { diagnostics: diagnostics.map(vscDiagToLspDiag) };
    }
  );

  client.onNotification('temple/createVirtualDocument', async (params: unknown) => {
    if (!isCreateVirtualDocumentParams(params)) {
      return;
    }

    const uri = vscode.Uri.parse(params.uri);
    const uriKey = uri.toString();
    const nextVersion = (cleanedContentVersionMap.get(uriKey) ?? 0) + 1;
    cleanedContentVersionMap.set(uriKey, nextVersion);
    cleanedContentMap.set(uriKey, params.content);
    virtualDocumentChangeEmitter.fire(uri);
    await vscode.workspace.openTextDocument(uri);
  });

  client.onNotification(
    'temple/publishNodeDiagnostics',
    (params: unknown) => {
      if (!isPublishNodeDiagnosticsParams(params)) {
        return;
      }

      const uri = vscode.Uri.parse(params.uri);
      const diagnostics = params.diagnostics.map(lspDiagToVscDiag);
      nodeDiagCollection.set(uri, diagnostics);
    }
  );

  return { __testing };
}

export const __testing = {
  normalizeDetectedFormat,
  resolveBaseLintStrategy,
  DefaultBaseLintCapabilityRegistry,
  resolveMirrorFileTargetUri,
  cleanupMirrorFileTargetUri,
  MIRROR_GHOST_DIRNAME,
};

export function deactivate(): Thenable<void> | undefined {
  for (const mirrorPath of tempBaseLintFileMap.values()) {
    cleanupMirrorFileTargetUri(vscode.Uri.file(mirrorPath));
  }
  cleanupMirrorDirectories();
  resetBaseLintSessionCaches();
  if (!client) {
    return undefined;
  }
  return client.stop();
}
