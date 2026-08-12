const SCHEMA_VERSION = "v1";

const priorityRank = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});

function invalid(message) {
  throw new TypeError(`Invalid structured Doc-Vader output: ${message}`);
}

function validateItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    invalid(`workItems[${index}] must be an object`);
  }
  if (typeof item.id !== "string" || item.id.length === 0) {
    invalid(`workItems[${index}].id must be a non-empty string`);
  }
  if (!Object.hasOwn(priorityRank, item.priority)) {
    invalid(`${item.id}.priority is invalid`);
  }
  if (typeof item.status !== "string") {
    invalid(`${item.id}.status must be a string`);
  }
  if (typeof item.afk !== "boolean" || typeof item.hitl !== "boolean") {
    invalid(`${item.id} must specify boolean afk and hitl values`);
  }
  if (!Array.isArray(item.dependencies) || !item.dependencies.every((id) => typeof id === "string")) {
    invalid(`${item.id}.dependencies must be an array of work IDs`);
  }
}

function parseReadyResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    invalid("missing or malformed result; structured dv output is required");
  }
  if (result.schemaVersion !== SCHEMA_VERSION) {
    invalid(`unsupported schema version ${String(result.schemaVersion)}`);
  }
  if (!Array.isArray(result.workItems)) {
    invalid("workItems must be an array");
  }
  result.workItems.forEach(validateItem);
  return result.workItems;
}

function ineligibility(item) {
  if (item.status === "ambiguous") return "has ambiguous readiness";
  if (item.status !== "ready") return `has status ${item.status}`;
  if (!item.afk) return "is not AFK-ready";
  if (item.hitl) return "requires HITL";
  if (item.dependencies.length > 0) return "has unresolved dependencies";
  return null;
}

export const builtInCommands = Object.freeze({
  ready: () => ["dv", "work", "ready", "--json"],
  show: (workId) => ["dv", "work", "show", workId, "--json"],
  validate: (workId) => ["dv", "work", "status", workId, "--validate", "--json"],
  close: (workId) => ["dv", "work", "close", workId, "--json"],
});

/**
 * Select from the structured result of the built-in `dv work ready --json`
 * contract. This module deliberately performs no filesystem or Markdown reads.
 */
export function selectReadyWork(result, { workId } = {}) {
  const workItems = parseReadyResult(result);
  const candidates = workId === undefined
    ? workItems
    : workItems.filter((item) => item.id === workId);

  if (workId !== undefined && candidates.length !== 1) {
    invalid(candidates.length === 0 ? `work item ${workId} is missing` : `work item ${workId} is ambiguous`);
  }

  if (workId !== undefined) {
    const reason = ineligibility(candidates[0]);
    if (reason) invalid(`work item ${workId} ${reason}`);
    return candidates[0];
  }

  const eligible = candidates.filter((item) => ineligibility(item) === null);
  if (eligible.length === 0) invalid("no AFK-ready work items are available");
  return eligible.sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority] || left.id.localeCompare(right.id),
  )[0];
}
