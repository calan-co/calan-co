import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileRuntimeSteps,
  listRuntimeAgents,
  listRuntimePipelines,
  loadExecutionRuntimePack,
  runtimeToSandcastleConfig,
  validateExecutionRuntimePack,
} from '../extensions/pi-sandcastle/execution-runtime.ts';
import { configToYaml, packsToConfig } from '../extensions/pi-sandcastle/pipeline-packs.mjs';

test('execution runtime pack ports prompts, agents, pipelines, and step modules', () => {
  const pack = loadExecutionRuntimePack();
  assert.equal(pack.runtimeVersion, 1);
  assert.ok(pack.prompts['simple-loop'].template.includes('$INPUT'));
  assert.equal(pack.agents.implementer.role, 'implementer');
  assert.equal(pack.stepModules['implement-work'].prompt, 'implement-work');
  assert.equal(pack.pipelines['parallel-planner-with-review'].steps[2].kind, 'fanOut');
  assert.ok(listRuntimeAgents(pack).some((agent) => agent.name === 'reviewer'));
  assert.ok(listRuntimePipelines(pack).some((pipeline) => pipeline.name === 'archive'));
});

test('execution runtime validates negative fixtures with useful diagnostics', () => {
  assert.throws(() => validateExecutionRuntimePack(null), /runtime pack must be an object/);
  assert.throws(() => validateExecutionRuntimePack({ runtimeVersion: 0, agents: {}, prompts: {}, pipelines: {} }), /runtimeVersion/);
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      agents: { worker: {} },
      prompts: { bad: { format: 'markdown' } },
      pipelines: { p: { steps: [{ id: 's', kind: 'runAgent', agent: 'missing', prompt: 'bad' }] } },
    }),
    /prompt 'bad' must define template or file.*unknown agent/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      agents: { worker: {} },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: { p: { steps: [{ id: 'fan', kind: 'fanOut' }] } },
    }),
    /fanOut must define over.*fanOut must define nested step/s,
  );
});

test('runtime compiler converts deterministic runtime pipelines to legacy execution config', () => {
  const pack = loadExecutionRuntimePack();
  const cfg = runtimeToSandcastleConfig(pack, { defaultSandbox: 'podman', defaultPipeline: 'archive' });
  assert.equal(cfg.defaultSandbox, 'podman');
  assert.equal(cfg.defaultPipeline, 'archive');
  assert.equal(cfg.defaultAgent, 'claude-code');
  assert.equal(cfg.agents.planner.provider, 'claude-code');
  assert.equal(cfg.pipelines.archive.branchStrategy.type, 'merge-to-head');
  assert.equal(cfg.pipelines['parallel-planner'].steps[1].agent, 'implementer');
  assert.equal(compileRuntimeSteps([{ id: 'noop', kind: 'gate' }], pack)[0].prompt, '$INPUT');
});

test('configToYaml renders compiled runtime agents and pipelines', () => {
  const yaml = configToYaml(packsToConfig());
  assert.match(yaml, /^agents:/m);
  assert.match(yaml, /^  implementer:/m);
  assert.match(yaml, /provider: claude-code/);
  assert.match(yaml, /^pipelines:/m);
  assert.match(yaml, /^  parallel-planner-with-review:/m);
  assert.match(yaml, /prompt: \|\n          Inspect the configured issue tracker/s);
  assert.doesNotMatch(yaml, /^teams:/m);
});
