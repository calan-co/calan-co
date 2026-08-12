const SCHEMA_VERSION = "v1";
const CONTRACT_VERSION = "doc-vader-contract/v1";

const schema = (name, properties, required) => Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://babysitter.dev/schemas/doc-vader/${name}/v1.schema.json`,
  type: "object",
  additionalProperties: true,
  required,
  properties,
});

/** Versioned JSON Schema documents for accepted structured Doc-Vader results. */
export const resultSchemas = Object.freeze({
  ready: schema("work-ready", {
    schemaVersion: { const: "v1" },
    workItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "priority", "status", "afk", "hitl", "dependencies"],
        properties: {
          id: { type: "string", minLength: 1 },
          priority: { enum: ["critical", "high", "medium", "low"] },
          status: { type: "string" },
          afk: { type: "boolean" },
          hitl: { type: "boolean" },
          dependencies: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, ["schemaVersion", "workItems"]),
  show: schema("work-show", {
    schemaVersion: { const: "task-model/v1" },
    id: { type: "string", minLength: 1 },
    title: { type: "string" },
    filePath: { type: "string", minLength: 1 },
    status: { type: "string" }, lifecycle: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    dependencies: { type: "array", items: { type: "string" } },
    body: { type: "object" }, acceptanceCriteria: { type: "array" },
    validation: { type: "object" }, runtime: { type: "object" },
  }, ["schemaVersion", "id", "title", "filePath", "status", "lifecycle", "tags", "dependencies", "body", "acceptanceCriteria", "validation", "runtime"]),
  statusValidate: schema("work-status-validate", {
    schemaVersion: { const: "task-status/v1" }, id: { type: "string", minLength: 1 },
    title: { type: "string" }, filePath: { type: "string", minLength: 1 },
    status: { type: "string" }, lifecycle: { type: "string" },
    validation: {
      type: "object",
      additionalProperties: true,
      required: ["isActive", "isReady", "isAfk", "isHitl", "dependenciesSatisfied"],
      properties: {
        isActive: { type: "boolean" },
        isReady: { type: "boolean" },
        isAfk: { type: "boolean" },
        isHitl: { type: "boolean" },
        dependenciesSatisfied: { type: "boolean" },
      },
    },
    runtime: { type: "object" }, recovery: { type: "object" }, graph: { type: "object" },
  }, ["schemaVersion", "id", "title", "filePath", "status", "lifecycle", "validation", "runtime", "recovery", "graph"]),
  close: schema("work-close", {
    schemaVersion: { const: "task-close/v1" }, id: { type: "string", minLength: 1 },
    status: { const: "closed" }, lifecycle: { const: "closed" },
  }, ["schemaVersion", "id", "status", "lifecycle"]),
  repositoryOverride: schema("repository-override", {
    schemaVersion: { const: "doc-vader-override/v1" },
    compatibleWith: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
      contains: { const: CONTRACT_VERSION },
    },
    commands: {
      type: "object",
      additionalProperties: false,
      properties: {
        ready: {
          type: "array", minItems: 1,
          items: { type: "string", minLength: 1 },
          contains: { const: "--json" },
        },
        show: {
          type: "array", minItems: 1,
          items: { type: "string", minLength: 1 },
          allOf: [{ contains: { const: "--json" } }, { contains: { const: "{workId}" } }],
        },
        validate: {
          type: "array", minItems: 1,
          items: { type: "string", minLength: 1 },
          allOf: [{ contains: { const: "--json" } }, { contains: { const: "{workId}" } }],
        },
        close: {
          type: "array", minItems: 1,
          items: { type: "string", minLength: 1 },
          allOf: [{ contains: { const: "--json" } }, { contains: { const: "{workId}" } }],
        },
      },
    },
  }, ["schemaVersion", "compatibleWith", "commands"]),
});

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

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) invalid(`${label} must be a non-empty string`);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
}

function requireVersion(result, version) {
  requireObject(result, "result");
  if (result.schemaVersion !== version) invalid(`unsupported schema version ${String(result.schemaVersion)}`);
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

/** Parse the canonical `dv work show --json` result; no Markdown fallback exists. */
export function parseShowResult(result) {
  requireVersion(result, "task-model/v1");
  for (const key of ["id", "title", "filePath", "status", "lifecycle"]) requireString(result[key], key);
  for (const key of ["tags", "dependencies", "acceptanceCriteria"]) requireArray(result[key], key);
  for (const key of ["body", "validation", "runtime"]) requireObject(result[key], key);
  if (!result.tags.every((value) => typeof value === "string") || !result.dependencies.every((value) => typeof value === "string")) invalid("show arrays must contain strings");
  return result;
}

/** Parse the canonical `dv work status --validate --json` result. */
export function parseStatusValidateResult(result) {
  requireVersion(result, "task-status/v1");
  for (const key of ["id", "title", "filePath", "status", "lifecycle"]) requireString(result[key], key);
  for (const key of ["validation", "runtime", "recovery", "graph"]) requireObject(result[key], key);
  for (const key of ["isActive", "isReady", "isAfk", "isHitl", "dependenciesSatisfied"]) requireBoolean(result.validation[key], `validation.${key}`);
  return result;
}

/** Parse the canonical structured close acknowledgement. */
export function parseCloseResult(result) {
  requireVersion(result, "task-close/v1");
  requireString(result.id, "id");
  if (result.status !== "closed" || result.lifecycle !== "closed") invalid("close result must confirm closed status and lifecycle");
  return result;
}

/**
 * Validate an optional repository command override. Overrides may change argv
 * construction only; every declared command remains JSON-only and must return
 * the corresponding built-in versioned result schema.
 */
export function parseRepositoryOverride(override) {
  requireVersion(override, "doc-vader-override/v1");
  requireArray(override.compatibleWith, "compatibleWith");
  if (!override.compatibleWith.every((version) => typeof version === "string")) invalid("compatibleWith must contain only strings");
  if (!override.compatibleWith.includes(CONTRACT_VERSION)) invalid(`override is not compatible with ${CONTRACT_VERSION}`);
  requireObject(override.commands, "commands");
  const commandNames = new Set(["ready", "show", "validate", "close"]);
  for (const [name, argv] of Object.entries(override.commands)) {
    if (!commandNames.has(name)) invalid(`unknown override command ${name}`);
    requireArray(argv, `commands.${name}`);
    if (argv.length === 0 || !argv.every((token) => typeof token === "string" && token.length > 0)) invalid(`commands.${name} must be a non-empty string argv`);
    if (!argv.includes("--json")) invalid(`commands.${name} must request structured JSON output`);
    if (name !== "ready" && !argv.includes("{workId}")) invalid(`commands.${name} must include {workId}`);
  }
  return override;
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

  const itemIds = new Set();
  for (const item of candidates) {
    if (itemIds.has(item.id)) invalid(`duplicate work item ID ${item.id}`);
    itemIds.add(item.id);
  }
  const eligible = candidates.filter((item) => ineligibility(item) === null);
  if (eligible.length === 0) invalid("no AFK-ready work items are available");
  return eligible.sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority] || left.id.localeCompare(right.id),
  )[0];
}
