import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPipelinePacks, packsToConfig, buildDefaultConfigText } from '../extensions/pi-sandcastle/pipeline-packs.mjs';

test('pipeline packs are discovered from Sandcastle template filesystem', () => {
  const packs = loadPipelinePacks();
  const names = packs.map((pack) => pack.name).sort();
  assert.deepEqual(names, ['blank', 'parallel-planner', 'parallel-planner-with-review', 'sequential-reviewer', 'simple-loop']);
  const parallel = packs.find((pack) => pack.name === 'parallel-planner');
  assert.deepEqual(parallel.agents, ['planner', 'implementer', 'merger']);
  assert.equal(parallel.steps[0].prompt.length > 20, true);
});

test('pipeline packs map into pi-sandcastle agent and pipeline inventory', () => {
  const cfg = packsToConfig(loadPipelinePacks());
  assert.ok(cfg.agents.planner);
  assert.ok(cfg.agents.worker);
  assert.ok(cfg.agents.implementer);
  assert.ok(cfg.agents.reviewer);
  assert.ok(cfg.agents.merger);
  assert.equal(cfg.pipelines['simple-loop'].steps[0].agent, 'worker');
  assert.equal(cfg.pipelines['parallel-planner'].steps[0].agent, 'planner');
  assert.equal(cfg.pipelines['parallel-planner-with-review'].steps[2].agent, 'reviewer');
});

test('default config yaml stores only user-selected/default override settings', () => {
  const text = buildDefaultConfigText();
  assert.match(text, /^defaultPipeline: simple-loop/m);
  assert.match(text, /^defaultAgent: claude-code/m);
  assert.match(text, /^issueTracker: github-issues/m);
  assert.doesNotMatch(text, /^agents:/m);
  assert.doesNotMatch(text, /^pipelines:/m);
  assert.doesNotMatch(text, /^teams:/m);
});
