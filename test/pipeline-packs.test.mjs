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
  assert.equal(runtime.roles.planner.kind, 'planWork');
  assert.equal(runtime.pipelines['parallel-planner'].steps, undefined);
  assert.equal(runtime.pipelines['parallel-planner'].nodes.implement.kind, 'loop');
  assert.deepEqual(runtime.pipelines['parallel-planner'].nodes.implement.capabilities, ['loop']);
  assert.deepEqual(runtime.pipelines['parallel-planner'].nodes.implement.node.capabilities, ['worktree', 'git.worktree']);
  assert.deepEqual(runtime.pipelines['parallel-planner'].nodes.implement.node.nodes.implement.capabilities, ['runRole', 'agent.pi']);
  assert.equal(runtime.pipelines['parallel-planner'].nodes.implement.node.nodes.implement.role, 'implementer');
});

test('pipeline packs map into agent-workflows agent and pipeline inventory', () => {
  const cfg = packsToConfig(loadPipelinePacks());
  assert.ok(cfg.agents.planner);
  assert.ok(cfg.agents.worker);
  assert.ok(cfg.agents.implementer);
  assert.ok(cfg.agents.reviewer);
  assert.ok(cfg.agents.merger);
  for (const name of ['blank', 'simple-loop', 'sequential-reviewer', 'parallel-planner', 'parallel-planner-with-review', 'archive']) {
    assert.equal(cfg.pipelines[name].kind, 'composite');
    assert.ok(cfg.pipelines[name].nodes, `${name} should keep graph nodes`);
  }
  assert.equal(cfg.pipelines['simple-loop'].nodes.workspace.kind, 'git.worktree');
  assert.equal(cfg.pipelines['simple-loop'].nodes.workspace.nodes.run.role, 'worker');
  assert.equal(cfg.pipelines['sequential-reviewer'].nodes.workspace.nodes.review.needs[0], 'implement');
  assert.equal(cfg.pipelines.archive.nodes.workspace.kind, 'git.worktree');
  assert.equal(cfg.pipelines['parallel-planner'].nodes.implement.node.kind, 'git.worktree');
  assert.equal(cfg.pipelines['parallel-planner'].nodes.merge.kind, 'git.merge');
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.review.node.kind, 'git.worktree');
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.merge.kind, 'git.merge');
  assert.equal(cfg.pipelines['parallel-planner'].steps, undefined);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].steps, undefined);
});

test('configToYaml renders graph-native default workflow definitions without steps arrays', () => {
  const text = configToYaml(packsToConfig());
  assert.match(text, /^  parallel-planner-with-review:/m);
  assert.match(text, /^    kind: composite/m);
  assert.match(text, /kind: git\.worktree/);
  assert.match(text, /kind: git\.merge/);
  assert.doesNotMatch(text, /^    steps:/m);
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
