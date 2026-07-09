import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigShadowModel } from '../extensions/pi-sandcastle/config-shadow-model.ts';

const baseConfig = () => ({
  defaultSandbox: 'docker',
  defaultModel: 'model-a',
  agents: {
    planner: { name: 'planner', provider: 'pi' },
    worker: { name: 'worker', provider: 'pi' },
  },
  chains: { legacy: [{ role: 'planner', prompt: 'Plan' }] },
  pipelines: { loop: { steps: [{ role: 'planner', prompt: 'Do it' }] } },
});

test('ConfigShadowModel renameAgent propagates all name references and emits change', () => {
  const model = new ConfigShadowModel(baseConfig());
  const changes = [];
  model.onChange((change) => changes.push(change));

  model.renameAgent('planner', 'planner1');
  const snapshot = model.snapshot();

  assert.equal(snapshot.agents.planner, undefined);
  assert.equal(snapshot.agents.planner1.name, 'planner1');
  assert.equal(snapshot.chains.legacy[0].role, 'planner1');
  assert.equal(snapshot.pipelines.loop.steps[0].role, 'planner1');
  assert.equal(model.isDirty(), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'rename-agent');
  assert.equal(changes[0].before.chains.legacy[0].role, 'planner');
  assert.equal(changes[0].after.chains.legacy[0].role, 'planner1');
});

test('ConfigShadowModel deleteAgent removes the agent', () => {
  const model = new ConfigShadowModel(baseConfig());
  model.deleteAgent('planner');
  assert.equal(model.snapshot().agents.planner, undefined);
});

test('ConfigShadowModel defaultable set-config removes explicit agent override', () => {
  const cfg = baseConfig();
  cfg.agents.planner.model = 'explicit-model';
  const model = new ConfigShadowModel(cfg);
  model.setConfigValue('roles.planner.model', 'default');
  assert.equal(model.snapshot().agents.planner.model, undefined);
});
