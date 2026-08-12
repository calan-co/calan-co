import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// This is deliberately the public, built-in contract surface.  It must not
// consult backlog Markdown or repository configuration to make these calls.
const loadContract = () => import("../src/doc-vader-contract.mjs");

const ready = (overrides = {}) => ({
  schemaVersion: "v1",
  workItems: [{
    id: "wi-002",
    priority: "high",
    status: "ready",
    afk: true,
    hitl: false,
    dependencies: [],
  }],
  ...overrides,
});

test("builds only the versioned built-in dv argv contracts", async () => {
  const { builtInCommands } = await loadContract();

  assert.deepEqual(builtInCommands.ready(), ["dv", "work", "ready", "--json"]);
  assert.deepEqual(builtInCommands.show("wi-002"), ["dv", "work", "show", "wi-002", "--json"]);
  assert.deepEqual(builtInCommands.validate("wi-002"), ["dv", "work", "status", "wi-002", "--validate", "--json"]);
  assert.deepEqual(builtInCommands.close("wi-002"), ["dv", "work", "close", "wi-002", "--json"]);
});

test("accepts an explicit ID only when its canonical result is AFK-ready", async () => {
  const { selectReadyWork } = await loadContract();

  assert.equal(selectReadyWork(ready(), { workId: "wi-002" }).id, "wi-002");
  assert.throws(
    () => selectReadyWork(ready({ workItems: [{ ...ready().workItems[0], hitl: true }] }), { workId: "wi-002" }),
    /wi-002.*HITL|HITL.*wi-002/i,
  );
  assert.throws(
    () => selectReadyWork(ready({ workItems: [{ ...ready().workItems[0], dependencies: ["wi-001"] }] }), { workId: "wi-002" }),
    /wi-002.*dependenc|dependenc.*wi-002/i,
  );
});

test("filters before deterministically sorting automatic AFK-ready candidates", async () => {
  const { selectReadyWork } = await loadContract();
  const result = ready({ workItems: [
    { id: "wi-900", priority: "critical", status: "ready", afk: true, hitl: true, dependencies: [] },
    { id: "wi-010", priority: "high", status: "ready", afk: true, hitl: false, dependencies: [] },
    { id: "wi-002", priority: "high", status: "ready", afk: true, hitl: false, dependencies: [] },
    { id: "wi-001", priority: "low", status: "ready", afk: true, hitl: false, dependencies: [] },
  ] });

  assert.equal(selectReadyWork(result).id, "wi-002");
});

test("rejects duplicate eligible IDs during automatic selection", async () => {
  const { selectReadyWork } = await loadContract();
  const item = ready().workItems[0];

  assert.throws(
    () => selectReadyWork(ready({ workItems: [item, { ...item }] })),
    /duplicate.*wi-002|wi-002.*duplicate/i,
  );
});

test("fails closed with actionable diagnostics for malformed, incompatible, and ambiguous readiness", async () => {
  const { selectReadyWork } = await loadContract();

  for (const result of [undefined, "not JSON", ready({ schemaVersion: "v999" })]) {
    assert.throws(() => selectReadyWork(result), /malformed|schema|version|invalid/i);
  }
  assert.throws(
    () => selectReadyWork(ready({ workItems: [{ ...ready().workItems[0], status: "ambiguous" }] }), { workId: "wi-002" }),
    /ambiguous.*wi-002|wi-002.*ambiguous/i,
  );
});

test("never substitutes backlog Markdown when structured dv output is absent", async () => {
  const { selectReadyWork } = await loadContract();

  assert.throws(
    () => selectReadyWork(undefined, { workId: "wi-001", backlogDirectory: "backlog" }),
    /structured|dv.*output|missing/i,
  );
});

test("parses only the versioned canonical show, status/validate, and close results", async () => {
  const {
    parseCloseResult,
    parseShowResult,
    parseStatusValidateResult,
  } = await loadContract();
  const show = {
    schemaVersion: "task-model/v1",
    id: "wi-002",
    title: "A work item",
    filePath: "backlog/002-work.md",
    status: "ready",
    lifecycle: "active",
    tags: ["afk"],
    dependencies: [],
    body: { sections: [] },
    acceptanceCriteria: [],
    validation: { type: "work-item", subtype: "story", priority: "high", links: { depends_on: [] }, archived: false },
    runtime: { markdownReady: true, executionReady: true, ready: true, sourceDisagreement: false },
  };
  const status = {
    schemaVersion: "task-status/v1",
    id: "wi-002",
    title: "A work item",
    filePath: "backlog/002-work.md",
    status: "ready",
    lifecycle: "active",
    validation: { isActive: true, isReady: true, isAfk: true, isHitl: false, dependenciesSatisfied: true },
    runtime: { markdownReady: true, executionReady: true, ready: true, sourceDisagreement: false },
    recovery: { state: "ready", forceRequired: false, forceReasons: [], blockedReasons: [], warnings: [] },
    graph: { relationships: [], diagnostics: { projection: [], informationalReferences: [] } },
  };
  const close = { schemaVersion: "task-close/v1", id: "wi-002", status: "closed", lifecycle: "closed" };

  assert.equal(parseShowResult(show), show);
  assert.equal(parseStatusValidateResult(status), status);
  assert.equal(parseCloseResult(close), close);
  for (const [parse, malformed] of [
    [parseShowResult, { ...show, schemaVersion: "task-model/v999" }],
    [parseStatusValidateResult, { ...status, validation: { ...status.validation, isAfk: "yes" } }],
    [parseCloseResult, { ...close, status: "ready" }],
  ]) {
    assert.throws(() => parse(malformed), /structured|schema|version|invalid|close/i);
  }
});

test("exposes a versioned JSON Schema for ready results and accepts only compatible override declarations", async () => {
  const { parseRepositoryOverride, resultSchemas } = await loadContract();

  assert.deepEqual(resultSchemas.ready, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://babysitter.dev/schemas/doc-vader/work-ready/v1.schema.json",
    type: "object",
    additionalProperties: true,
    required: ["schemaVersion", "workItems"],
    properties: {
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
    },
  });
  for (const schema of Object.values(resultSchemas)) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(schema.$id, /\/v1\.schema\.json$/);
  }
  const override = {
    schemaVersion: "doc-vader-override/v1",
    compatibleWith: ["doc-vader-contract/v1"],
    commands: { show: ["dv", "work", "show", "{workId}", "--json"] },
  };
  assert.equal(parseRepositoryOverride(override), override);
  assert.throws(
    () => parseRepositoryOverride({ ...override, compatibleWith: ["doc-vader-contract/v999"] }),
    /compatible|version/i,
  );
  assert.throws(
    () => parseRepositoryOverride({ ...override, commands: { show: ["dv", "work", "show"] } }),
    /workId|command|invalid/i,
  );
});


test("README documents the compatible optional repository override seam", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /optional repository override/i);
  assert.match(readme, /doc-vader-contract\/v1/);
  assert.match(readme, /compatibleWith/);
});
