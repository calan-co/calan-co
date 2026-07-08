import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BACKLOG_RUNS_DIR = ".pi/sandcastle/backlog-runs";
export const BACKLOG_RESULTS_DIR = ".pi/sandcastle/results";

const ACTIVE_STATUSES = new Set([
  "active",
  "in-progress",
  "in_progress",
  "queued",
  "running",
]);

const RESUME_STATUSES = new Set([
  "cancelled",
  "error",
  "failed",
  "interrupted",
  "paused",
]);

function toNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function safeJsonParse(raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse backlog run record ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeItems(record) {
  let rawItems = [];
  if (Array.isArray(record?.resolvedItems)) {
    rawItems = record.resolvedItems;
  } else if (Array.isArray(record?.items)) {
    rawItems = record.items;
  }

  return rawItems
    .map((item) => {
      if (typeof item === "string") {
        return { id: item };
      }
      if (item && typeof item === "object") {
        const id = item.id ?? item.itemId ?? item.key ?? item.name;
        if (!id) return null;
        return {
          id: String(id),
          title: item.title ? String(item.title) : undefined,
          summary: item.summary ? String(item.summary) : undefined,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeArray(values) {
  if (Array.isArray(values)) return values.map((value) => String(value));
  if (typeof values === "string" && values.trim()) return [values];
  return [];
}

function isBacklogLikeRecord(raw) {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      (raw.pipeline ||
        raw.query ||
        raw.resolvedItems ||
        raw.items ||
        raw.itemIds ||
        raw.itemId ||
        raw.resumable ||
        raw.providerSession ||
        raw.session ||
        raw.backlogSession),
  );
}

function getRecordTime(record) {
  return Math.max(record.updatedAt || 0, record.createdAt || 0);
}

function compareRecordsByRecency(a, b) {
  const delta = getRecordTime(b) - getRecordTime(a);
  if (delta !== 0) return delta;
  return a.id.localeCompare(b.id);
}

function isBacklogRunsSource(record) {
  return String(record.sourcePath || "").includes(`/${BACKLOG_RUNS_DIR}/`);
}

function normalizeBacklogRunRecord(raw, filePath) {
  const createdAt = toNumber(raw.createdAt ?? raw.startedAt ?? raw.timestamp);
  const updatedAt = toNumber(raw.updatedAt ?? raw.finishedAt ?? raw.createdAt ?? raw.startedAt ?? raw.timestamp);
  const pipeline = String(raw.pipeline ?? raw.name ?? "");
  const query = String(raw.query ?? raw.prompt ?? raw.task ?? "");
  const status = String(raw.status ?? raw.state ?? "unknown");
  const record = {
    ...raw,
    id: String(raw.id ?? raw.runId ?? raw.name ?? filePath),
    query,
    pipeline,
    status,
    createdAt,
    startedAt: toNumber(raw.startedAt, createdAt),
    updatedAt,
    finishedAt: raw.finishedAt === undefined ? undefined : toNumber(raw.finishedAt, updatedAt),
    branches: normalizeArray(raw.branches ?? raw.branch),
    logs: normalizeArray(raw.logs ?? raw.logPath),
    resolvedItems: normalizeItems(raw),
    itemIds: normalizeArray(raw.itemIds ?? raw.itemId),
    sourcePath: filePath,
  };

  if (!record.itemIds.length && record.resolvedItems.length) {
    record.itemIds = record.resolvedItems.map((item) => item.id);
  }

  if (!record.branches.length && raw.branch) {
    record.branches = [String(raw.branch)];
  }
  if (!record.logs.length && raw.logPath) {
    record.logs = [String(raw.logPath)];
  }

  return record;
}

function readJsonRecordsFromDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join(dirPath, entry.name);
    const raw = readFileSync(filePath, "utf8");
    const parsed = safeJsonParse(raw, filePath);
    if (!isBacklogLikeRecord(parsed)) continue;
    records.push(normalizeBacklogRunRecord(parsed, filePath));
  }
  return records;
}

function dedupeRecords(records) {
  const byId = new Map();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, record);
      continue;
    }

    const existingScore = getRecordTime(existing);
    const nextScore = getRecordTime(record);
    if (nextScore > existingScore) {
      byId.set(record.id, record);
      continue;
    }

    if (nextScore === existingScore) {
      const existingPreferred = isBacklogRunsSource(existing);
      const nextPreferred = isBacklogRunsSource(record);
      if (nextPreferred && !existingPreferred) byId.set(record.id, record);
    }
  }

  return [...byId.values()].sort(compareRecordsByRecency);
}

export function readBacklogRunRecords(cwd) {
  return dedupeRecords([
    ...readJsonRecordsFromDir(join(cwd, BACKLOG_RUNS_DIR)),
    ...readJsonRecordsFromDir(join(cwd, BACKLOG_RESULTS_DIR)),
  ]);
}

export function matchesBacklogRunQuery(record, query) {
  const normalizedQuery = lower(query).trim();
  if (!normalizedQuery) return true;
  const haystacks = [
    record.id,
    record.query,
    record.pipeline,
    record.status,
    ...(record.itemIds || []),
    ...(record.branches || []),
    ...(record.logs || []),
    ...(record.resolvedItems || []).flatMap((item) => [item.id, item.title, item.summary]),
  ]
    .filter(Boolean)
    .map(lower);

  if (haystacks.some((value) => value === normalizedQuery || value.includes(normalizedQuery))) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystacks.some((value) => value.includes(token)));
}

export function listBacklogRuns(cwd, query = "") {
  return readBacklogRunRecords(cwd).filter((record) => matchesBacklogRunQuery(record, query));
}

function isActiveRun(record) {
  return ACTIVE_STATUSES.has(lower(record.status));
}

function isResumableRun(record) {
  if (!RESUME_STATUSES.has(lower(record.status))) return false;
  const session = record.providerSession || record.session || record.backlogSession || {};
  const sessionId =
    record.sessionId ||
    record.providerSessionId ||
    session.id ||
    session.sessionId ||
    session.sessionID;
  if (!sessionId) return false;
  if (record.resumable === false || session.resumable === false || session.supportsResume === false) return false;
  return true;
}

function findRecordById(records, runId) {
  const explicitId = String(runId || "").trim();
  if (!explicitId) return null;

  const record = records.find((candidate) => candidate.id === explicitId);
  if (!record) return { kind: "missing", runId: explicitId };
  return { kind: "record", record };
}

function withInference(selection, inference) {
  return { ...selection, inference };
}

function selectLatest(records) {
  if (records.length === 0) return null;
  const sorted = [...records].sort(compareRecordsByRecency);
  const latestTime = getRecordTime(sorted[0]);
  const tied = sorted.filter((record) => getRecordTime(record) === latestTime);
  if (tied.length > 1) return { kind: "ambiguous", candidates: tied };
  return { kind: "record", record: sorted[0] };
}

export function selectBacklogRunForStatus(records, runId = "") {
  const explicitSelection = findRecordById(records, runId);
  if (explicitSelection) return explicitSelection;

  const active = records.filter(isActiveRun);
  if (active.length === 1) return withInference({ kind: "record", record: active[0] }, "active");
  if (active.length > 1) return withInference({ kind: "ambiguous", candidates: active }, "active");

  const latest = selectLatest(records);
  if (!latest) return { kind: "missing", runId: undefined, inference: "latest" };
  return withInference(latest, "latest");
}

export function selectBacklogRunForResume(records, runId = "") {
  const explicitSelection = findRecordById(records, runId);
  if (explicitSelection) return explicitSelection;

  const resumable = records.filter(isResumableRun);
  if (resumable.length === 1) {
    return withInference({ kind: "record", record: resumable[0] }, "latest-resumable");
  }
  if (resumable.length > 1) {
    const latest = selectLatest(resumable);
    return withInference(latest, "latest-resumable");
  }

  return { kind: "missing", runId: undefined, inference: "latest-resumable" };
}

export function isBacklogRunResumable(record) {
  return isResumableRun(record);
}

export function summarizeBacklogRun(record) {
  const itemText = record.itemIds?.length ? ` items=${record.itemIds.join(",")}` : "";
  const branchText = record.branches?.length ? ` branches=${record.branches.join(",")}` : "";
  const statusText = `status=${record.status}`;
  const queryText = record.query ? ` query=${JSON.stringify(record.query)}` : "";
  return `${record.id} ${statusText} pipeline=${record.pipeline}${itemText}${branchText}${queryText}`.trim();
}

export function formatBacklogRunList(runs) {
  if (runs.length === 0) return "No backlog runs found.";
  return ["Backlog runs:", ...runs.map((run) => `- ${summarizeBacklogRun(run)}`)].join("\n");
}

function formatMissingSelection(runId, fallbackMessage) {
  if (runId) return `No backlog run found for '${runId}'.`;
  return fallbackMessage;
}

function formatAmbiguousSelection(prefix, candidates) {
  const ids = candidates.map((candidate) => candidate.id).join(", ");
  return `Ambiguous ${prefix} selection: ${ids}. Provide a run id.`;
}

function formatStatusPrefix(inference) {
  if (inference === "active") return "Active backlog run";
  if (inference === "latest") return "Latest backlog run";
  return "Backlog run";
}

export function formatStatusSelection(selection) {
  if (selection.kind === "missing") {
    return formatMissingSelection(selection.runId, "No backlog runs are available.");
  }
  if (selection.kind === "ambiguous") {
    return formatAmbiguousSelection("backlog run", selection.candidates);
  }

  return `${formatStatusPrefix(selection.inference)}: ${summarizeBacklogRun(selection.record)}`;
}

export function formatResumeSelection(selection) {
  if (selection.kind === "missing") {
    return formatMissingSelection(selection.runId, "No resumable backlog run is available.");
  }
  if (selection.kind === "ambiguous") {
    return formatAmbiguousSelection("resumable backlog run", selection.candidates);
  }
  return `Selected backlog run for resume: ${summarizeBacklogRun(selection.record)}`;
}

export function writeBacklogRunRecord(cwd, record) {
  const dirPath = join(cwd, BACKLOG_RUNS_DIR);
  mkdirSync(dirPath, { recursive: true });
  const filePath = join(dirPath, `${record.id}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  return filePath;
}

export async function resumeBacklogRun(cwd, runId, resumeCapability) {
  const records = readBacklogRunRecords(cwd);
  const selection = selectBacklogRunForResume(records, runId);
  if (selection.kind !== "record") {
    return { ok: false, message: formatResumeSelection(selection) };
  }

  const record = selection.record;
  if (!isBacklogRunResumable(record)) {
    return {
      ok: false,
      message: `Backlog run '${record.id}' is not resumable. It needs failed/interrupted status plus provider/session metadata.`,
    };
  }

  if (typeof resumeCapability !== "function") {
    return {
      ok: false,
      message: `Backlog run '${record.id}' is resumable, but this extension context does not provide a resume capability.`,
    };
  }

  const resumedAt = Date.now();
  const resumedRecord = {
    ...record,
    status: "running",
    updatedAt: resumedAt,
    resumedAt,
  };

  const result = await resumeCapability(resumedRecord);
  writeBacklogRunRecord(cwd, resumedRecord);

  return {
    ok: true,
    record: resumedRecord,
    result,
    message: `Resumed backlog run '${record.id}'.`,
  };
}
