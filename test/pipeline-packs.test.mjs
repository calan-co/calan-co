import assert from 'node:assert/strict';
import test from 'node:test';
import { loadExecutionRuntimePack } from '../extensions/pi-sandcastle/execution-runtime.ts';
import { loadPipelinePacks, packsToConfig, buildDefaultConfigText } from '../extensions/pi-sandcastle/pipeline-packs.mjs';

test('pipeline packs are discovered from the Pi-Sandcastle execution runtime pack', () => {
  const packs = loadPipelinePacks();
  const names = packs.map((pack) => pack.name).sort();
  assert.deepEqual(names, ['archive', 'blank', 'parallel-planner', 'parallel-planner-with-review', 'sequential-reviewer', 'simple-loop']);
  const runtime = loadExecutionRuntimePack();
  assert.ok(runtime.prompts['implement-work'].template.length > 20);
  assert.equal(runtime.stepModules['plan-work'].role, 'planner');
});

test('pipeline packs map into pi-sandcastle agent and pipeline inventory', () => {
  const cfg = packsToConfig(loadPipelinePacks());
  assert.ok(cfg.agents.planner);
  assert.ok(cfg.agents.worker);
  assert.ok(cfg.agents.implementer);
  assert.ok(cfg.agents.reviewer);
  assert.ok(cfg.agents.merger);
  assert.equal(cfg.pipelines['simple-loop'].steps[0].role, 'worker');
  assert.equal(cfg.pipelines['parallel-planner'].steps[0].role, 'planner');
  assert.equal(cfg.pipelines['parallel-planner-with-review'].steps[2].role, 'reviewer');
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
