import assert from 'node:assert/strict';
import test from 'node:test';
import { loadExecutionRuntimePack } from '../extensions/agent-workflows/execution-runtime.ts';
import { loadPipelinePacks, packsToConfig, buildDefaultConfigText, configToYaml } from '../extensions/agent-workflows/pipeline-packs.mjs';

test('pipeline packs are discovered from the Agent Workflows execution runtime pack', () => {
  const packs = loadPipelinePacks();
  const names = packs.map((pack) => pack.name).sort();
  assert.deepEqual(names, ['archive', 'blank', 'parallel-planner', 'parallel-planner-with-review', 'sequential-reviewer', 'simple-loop']);
  const runtime = loadExecutionRuntimePack();
  assert.ok(runtime.prompts['implement-work'].template.length > 20);
  assert.equal(runtime.pipelines['parallel-planner'].steps[0].role, 'planner');
});

test('pipeline packs map into agent-workflows agent and pipeline inventory', () => {
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
  assert.match(text, /^workSource: github-issues/m);
assert.doesNotMatch(text, /^issueTracker:/m);
  assert.doesNotMatch(text, /^agents:/m);
  assert.doesNotMatch(text, /^pipelines:/m);
  assert.doesNotMatch(text, /^teams:/m);
});

test('configToYaml preserves legacy chains when rewriting drafts', () => {
  const cfg = packsToConfig();
  cfg.chains = { review: [{ role: 'reviewer', prompt: 'Review the branch.' }] };
  const text = configToYaml(cfg);
  assert.match(text, /^chains:/m);
  assert.match(text, /^  review:/m);
  assert.match(text, /^    - role: reviewer/m);
  assert.match(text, /Review the branch\./);
});
