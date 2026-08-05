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
  pipelines: {
    loop: {
      kind: 'composite',
      nodes: {
        run: { kind: 'agent.pi', role: 'planner', prompt: 'Do it' },
      },
    },
  },
});

test('ConfigShadowModel renameAgent propagates all name references and emits change', () => {
  const model = new ConfigShadowModel(baseConfig());
  const changes = [];
  model.onChange((change) => changes.push(change));

  model.renameAgent('planner', 'planner1');
  const snapshot = model.snapshot();

  assert.equal(snapshot.agents.planner, undefined);
  assert.equal(snapshot.agents.planner1.name, 'planner1');
  assert.equal(snapshot.pipelines.loop.nodes.run.role, 'planner1');
  assert.equal(model.isDirty(), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'rename-agent');
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

test('ConfigShadowModel sets Doc-Vader Work Source action commands when selected', () => {
  const model = new ConfigShadowModel({ ...baseConfig(), workSourceCommands: { close: 'custom close {{ itemId }}' } });
  model.setConfigValue('workSource', 'doc-vader');
  const snapshot = model.snapshot();

  assert.equal(snapshot.workSource, 'doc-vader');
  assert.equal(snapshot.workSourceSetupCommand, 'dv sandcastle init');
  assert.deepEqual(snapshot.workSourceCommands, {
    ready: 'dv work ready {{ args }}',
    list: 'dv work list',
    inspect: 'dv work show {{ itemId }}',
    validate: 'dv work validate {{ itemId }}',
    close: 'dv work close {{ itemId }}',
  });
});

test('ConfigShadowModel edits pipeline fields and graph node overrides', () => {
  const model = new ConfigShadowModel(baseConfig());
  model.setConfigValue('pipelines.loop.description', 'Loop pipeline');
  model.setConfigValue('pipelines.loop.nodes.run.role', 'worker');
  model.setConfigValue('pipelines.loop.nodes.run.model', 'model-b');
  model.setConfigValue('pipelines.loop.nodes.run.model', 'default');
  const snapshot = model.snapshot();
  assert.equal(snapshot.pipelines.loop.description, 'Loop pipeline');
  assert.equal(snapshot.pipelines.loop.nodes.run.role, 'worker');
  assert.equal(snapshot.pipelines.loop.nodes.run.model, 'default');
});

test('ConfigShadowModel rejects pipeline step editing', () => {
  const model = new ConfigShadowModel(baseConfig());
  assert.throws(() => model.setConfigValue('pipelines.loop.steps.0.role', 'worker'), /unsupported pipeline step/);
  assert.throws(() => model.addPipelineStep('loop'), /unsupported pipeline step/);
  assert.throws(() => model.deletePipelineStep('loop', 0), /unsupported pipeline step/);
});

test('ConfigShadowModel preserves and edits graph pipeline node fields', () => {
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
  };
  const model = new ConfigShadowModel(cfg);

  model.setConfigValue('pipelines.graph.description', 'Updated graph pipeline');
  model.setConfigValue('pipelines.graph.nodes.workspace.nodes.implement.role', 'worker');
  model.setConfigValue('pipelines.graph.nodes.workspace.nodes.implement.prompt', 'Implement graph work');

  const snapshot = model.snapshot();
  assert.equal(snapshot.pipelines.graph.description, 'Updated graph pipeline');
  assert.equal(snapshot.pipelines.graph.nodes.workspace.nodes.implement.role, 'worker');
  assert.equal(snapshot.pipelines.graph.nodes.workspace.nodes.implement.prompt, 'Implement graph work');
});

test('ConfigShadowModel creates missing nested pipeline and role entries when edited', () => {
  const model = new ConfigShadowModel(baseConfig());
  model.setConfigValue('defaultAgent', 'pi');
  model.setConfigValue('roles.newRole.sandbox', 'podman');
  model.setConfigValue('pipelines.newPipeline.description', 'New pipeline');
  model.setConfigValue('pipelines.newPipeline.nodes.workspace.kind', 'git.worktree');
  model.setConfigValue('pipelines.newPipeline.nodes.workspace.nodes.run.kind', 'agent.pi');
  model.setConfigValue('pipelines.newPipeline.nodes.workspace.nodes.run.role', 'worker');
  const snapshot = model.snapshot();
  assert.equal(snapshot.defaultAgent, 'pi');
  assert.equal(snapshot.agents.newRole.sandbox, 'podman');
  assert.equal(snapshot.pipelines.newPipeline.description, 'New pipeline');
  assert.equal(snapshot.pipelines.newPipeline.kind, 'composite');
  assert.equal(snapshot.pipelines.newPipeline.nodes.workspace.kind, 'git.worktree');
  assert.equal(snapshot.pipelines.newPipeline.nodes.workspace.nodes.run.role, 'worker');
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
