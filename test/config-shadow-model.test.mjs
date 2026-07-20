import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigShadowModel } from '../extensions/agent-workflows/config-shadow-model.ts';

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

test('ConfigShadowModel edits pipeline fields and step overrides', () => {
  const model = new ConfigShadowModel(baseConfig());
  model.setConfigValue('pipelines.loop.description', 'Loop pipeline');
  model.setConfigValue('pipelines.loop.steps.0.role', 'worker');
  model.setConfigValue('pipelines.loop.steps.0.model', 'model-b');
  model.setConfigValue('pipelines.loop.steps.0.model', 'default');
  const snapshot = model.snapshot();
  assert.equal(snapshot.pipelines.loop.description, 'Loop pipeline');
  assert.equal(snapshot.pipelines.loop.steps[0].role, 'worker');
  assert.equal(snapshot.pipelines.loop.steps[0].model, undefined);
});

test('ConfigShadowModel adds and deletes pipeline steps', () => {
  const model = new ConfigShadowModel(baseConfig());
  const changes = [];
  model.onChange((change) => changes.push(change));
  model.addPipelineStep('loop');
  assert.equal(model.snapshot().pipelines.loop.steps.length, 2);
  model.deletePipelineStep('loop', 0);
  assert.equal(model.snapshot().pipelines.loop.steps.length, 1);
  assert.equal(model.snapshot().pipelines.loop.steps[0].role, 'worker');
  assert.deepEqual(changes.map((change) => change.type), ['add-pipeline-step', 'delete-pipeline-step']);
});

test('ConfigShadowModel preserves and edits graph pipeline node fields without legacy step mutation', () => {
  const cfg = baseConfig();
  cfg.pipelines.graph = {
    description: 'Graph pipeline',
    kind: 'composite',
    nodes: {
      workspace: {
        kind: 'git.worktree',
        nodes: {
          implement: { kind: 'agent.pi', role: 'planner', prompt: 'Do it' },
        },
      },
    },
    steps: [{ role: 'planner', prompt: 'legacy compatibility' }],
  };
  const model = new ConfigShadowModel(cfg);

  model.setConfigValue('pipelines.graph.description', 'Updated graph pipeline');
  model.setConfigValue('pipelines.graph.nodes.workspace.nodes.implement.role', 'worker');
  model.setConfigValue('pipelines.graph.nodes.workspace.nodes.implement.prompt', 'Implement graph work');

  assert.throws(() => model.addPipelineStep('graph'), /graph-native/);
  assert.throws(() => model.deletePipelineStep('graph', 0), /graph-native/);
  assert.throws(() => model.setConfigValue('pipelines.graph.steps.0.role', 'worker'), /graph-native/);

  const snapshot = model.snapshot();
  assert.equal(snapshot.pipelines.graph.description, 'Updated graph pipeline');
  assert.equal(snapshot.pipelines.graph.nodes.workspace.nodes.implement.role, 'worker');
  assert.equal(snapshot.pipelines.graph.nodes.workspace.nodes.implement.prompt, 'Implement graph work');
  assert.deepEqual(snapshot.pipelines.graph.steps, [{ role: 'planner', prompt: 'legacy compatibility' }]);
});

test('ConfigShadowModel creates missing nested pipeline and role entries when edited', () => {
  const model = new ConfigShadowModel(baseConfig());
  model.setConfigValue('defaultAgent', 'pi');
  model.setConfigValue('roles.newRole.sandbox', 'podman');
  model.setConfigValue('pipelines.newPipeline.description', 'New pipeline');
  model.setConfigValue('pipelines.newPipeline.steps.1.sandbox', 'podman');
  model.setConfigValue('pipelines.newPipeline.steps.1.sandbox', 'default');
  model.addPipelineStep('createdByStep');
  model.deletePipelineStep('missing', 0);
  const snapshot = model.snapshot();
  assert.equal(snapshot.defaultAgent, 'pi');
  assert.equal(snapshot.agents.newRole.sandbox, 'podman');
  assert.equal(snapshot.pipelines.newPipeline.description, 'New pipeline');
  assert.equal(snapshot.pipelines.newPipeline.steps[1].role, 'worker');
  assert.equal(snapshot.pipelines.newPipeline.steps[1].sandbox, undefined);
  assert.equal(snapshot.pipelines.createdByStep.steps.length, 1);
});

test('ConfigShadowModel creates new pipelines as graph-native worktree pipelines', () => {
  const model = new ConfigShadowModel(baseConfig());
  model.addPipeline('newGraph');
  const pipeline = model.snapshot().pipelines.newGraph;
  assert.equal(pipeline.kind, 'composite');
  assert.equal(pipeline.nodes.workspace.kind, 'git.worktree');
  assert.equal(pipeline.nodes.workspace.nodes.run.kind, 'agent.pi');
  assert.equal(pipeline.nodes.workspace.nodes.run.role, 'worker');
  assert.equal(pipeline.steps, undefined);
});
