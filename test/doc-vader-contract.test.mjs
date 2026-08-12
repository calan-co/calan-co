import assert from "node:assert/strict";
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
