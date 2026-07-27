import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileRuntimeSteps,
  listRuntimeAgents,
  listRuntimePipelines,
  loadExecutionRuntimePack,
  runtimeToSandcastleConfig,
  validateExecutionRuntimePack,
} from '../extensions/agent-workflows/execution-runtime.ts';
import { readFileSync } from 'node:fs';
import { configToYaml, packsToConfig } from '../extensions/agent-workflows/pipeline-packs.mjs';

test('execution runtime pack ports prompts, roles, and pipelines', () => {
  const pack = loadExecutionRuntimePack();
  assert.equal(pack.runtimeVersion, 1);
  assert.ok(pack.prompts['simple-loop'].template.includes('$INPUT'));
  assert.equal(pack.roles.implementer.role, 'implementer');
  assert.equal(pack.pipelines['parallel-planner-with-review'].kind, 'composite');
  assert.equal(pack.pipelines['parallel-planner-with-review'].nodes.implement.kind, 'loop');
  assert.equal(pack.pipelines['parallel-planner-with-review'].nodes.implement.each, '$.executionContexts');
  assert.equal(pack.pipelines['parallel-planner-with-review'].steps[0].kind, 'fanOut');
  assert.equal(pack.pipelines['parallel-planner-with-review'].steps[1].kind, 'fanOut');
  assert.ok(listRuntimeAgents(pack).some((agent) => agent.name === 'reviewer'));
  assert.ok(listRuntimePipelines(pack).some((pipeline) => pipeline.name === 'archive'));
});

test('execution runtime validates negative fixtures with useful diagnostics', () => {
  assert.throws(() => validateExecutionRuntimePack(null), /runtime pack must be an object/);
  assert.throws(() => validateExecutionRuntimePack({ runtimeVersion: 0, roles: {}, prompts: {}, pipelines: {} }), /runtimeVersion/);
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {} },
      prompts: { bad: { format: 'markdown' } },
      pipelines: { p: { steps: [{ id: 's', kind: 'runRole', foo: 'missing', prompt: 'bad' }] } },
    }),
    /prompt 'bad' must define template or file.*must reference a role/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {} },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: { p: { steps: [{ id: 'fan', kind: 'fanOut' }] } },
    }),
    /fanOut must define over.*fanOut must define nested step/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {}, reviewer: { kind: 'review' } },
      prompts: { implement: { format: 'markdown', template: 'x' }, review: { format: 'markdown', template: 'x' } },
      pipelines: {
        p: {
          kind: 'composite',
          nodes: {
            fan: {
              kind: 'loop',
              each: '$.items',
              node: {
                kind: 'git.worktree',
                nodes: {
                  implement: { kind: 'agent.pi', role: 'worker', prompt: 'implement' },
                  review: { kind: 'agent.pi', role: 'reviewer', prompt: 'review', needs: ['implement'] },
                },
              },
            },
          },
        },
      },
    }),
    /loop compiles to 2 nested legacy steps.*legacy fanOut supports exactly one nested step/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {} },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: {
        p: {
          kind: 'composite',
          nodes: {
            fan: {
              kind: 'loop',
              each: '$.items',
              node: { kind: 'agent.pi', role: 'worker', prompt: 'ok' },
              nodes: {
                other: { kind: 'agent.pi', role: 'worker', prompt: 'ok' },
              },
            },
          },
        },
      },
    }),
    /loop must define exactly one of node or nodes/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {} },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: {
        p: {
          kind: 'composite',
          nodes: {
            fan: {
              kind: 'loop',
              each: '$.items',
              node: { kind: 'agent.pi', role: 'worker', prompt: 'ok' },
              nodes: {},
            },
          },
        },
      },
    }),
    /loop must define exactly one of node or nodes/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { planner: { kind: 'planWork' }, otherPlanner: { kind: 'planWork' } },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: { p: { steps: [{ id: 'plan', kind: 'planWork', role: 'planner', prompt: 'ok' }] } },
    }),
    /planWork must not reference a role.*exactly one role with kind planWork/s,
  );
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {} },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: { p: { kind: 'composite', nodes: { sandbox: { kind: 'docker.container', image: { strategy: 'auto' } } } } },
    }),
    /image\.name is required.*image\.strategy is not supported/s,
  );
});

test('runtime compiler preserves map-form concrete-node pipelines and legacy-compatible steps', () => {
  const pack = validateExecutionRuntimePack({
    runtimeVersion: 1,
    defaults: { branchPolicy: 'merge-to-head' },
    roles: {
      worker: { role: 'worker' },
      reviewer: { role: 'reviewer', kind: 'review' },
      merger: { role: 'merger', kind: 'merge' },
    },
    prompts: {
      blank: { format: 'markdown', template: '$INPUT' },
      review: { format: 'markdown', template: 'Review $INPUT' },
      merge: { format: 'markdown', template: 'Merge $INPUT' },
    },
    pipelines: {
      map: {
        description: 'Concrete map pipeline',
        kind: 'composite',
        nodes: {
          run: { kind: 'agent.pi', role: 'worker', prompt: 'blank' },
          review: { kind: 'agent.pi', needs: ['run'], role: 'reviewer', prompt: 'review' },
          merge: { kind: 'git.merge', needs: ['review'], prompt: 'merge' },
        },
      },
      legacy: {
        description: 'Legacy step pipeline',
        steps: [{ id: 'run', kind: 'runRole', role: 'worker', prompt: 'blank' }],
      },
    },
  });
  assert.equal(pack.pipelines.map.kind, 'composite');
  assert.equal(pack.pipelines.map.nodes.run.kind, 'agent.pi');
  assert.deepEqual(pack.pipelines.map.steps.map((step) => step.id), ['run', 'review', 'merge']);
  assert.equal(pack.pipelines.map.steps[0].kind, 'runRole');
  assert.equal(pack.pipelines.map.steps[1].kind, 'review');
  assert.equal(pack.pipelines.map.steps[2].kind, 'merge');
  assert.equal(pack.pipelines.legacy.kind, 'composite');
  assert.equal(pack.pipelines.legacy.nodes.run.kind, 'agent.pi');
  const cfg = runtimeToSandcastleConfig(pack);
  assert.equal(cfg.pipelines.map.kind, 'composite');
  assert.equal(cfg.pipelines.map.nodes.run.kind, 'agent.pi');
  assert.equal(cfg.pipelines.map.nodes.merge.kind, 'git.merge');
  assert.equal(cfg.pipelines.map.steps[0].role, 'worker');
  assert.equal(cfg.pipelines.map.steps[1].role, 'reviewer');
  assert.equal(cfg.pipelines.map.steps[2].role, 'merger');
});

test('runtime compiler preserves all git.worktree child agent nodes in legacy DAG order', () => {
  const pack = validateExecutionRuntimePack({
    runtimeVersion: 1,
    defaults: {},
    roles: {
      worker: { role: 'worker' },
      reviewer: { role: 'reviewer', kind: 'review' },
    },
    prompts: {
      implement: { format: 'markdown', template: 'Implement $INPUT' },
      review: { format: 'markdown', template: 'Review $INPUT' },
    },
    pipelines: {
      worktree: {
        kind: 'composite',
        nodes: {
          branch: {
            kind: 'git.worktree',
            nodes: {
              review: { kind: 'agent.pi', role: 'reviewer', prompt: 'review', needs: ['implement'] },
              implement: { kind: 'agent.pi', role: 'worker', prompt: 'implement' },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(pack.pipelines.worktree.steps.map((step) => step.id), ['branch.implement', 'branch.review']);
  assert.deepEqual(pack.pipelines.worktree.steps.map((step) => step.role), ['worker', 'reviewer']);
  assert.deepEqual(pack.pipelines.worktree.steps.map((step) => step.prompt), ['implement', 'review']);
  const cfg = runtimeToSandcastleConfig(pack);
  assert.deepEqual(cfg.pipelines.worktree.steps.map((step) => step.role), ['worker', 'reviewer']);
});

test('execution runtime schema supports composite map nodes and concrete container image requirements', () => {
  const schema = JSON.parse(readFileSync(new URL('../extensions/agent-workflows/schema/execution-runtime.schema.json', import.meta.url), 'utf8'));
  const configSchema = JSON.parse(readFileSync(new URL('../extensions/agent-workflows/schema/config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.required, ['runtimeVersion', 'defaults', 'roles', 'prompts', 'pipelines']);
  assert.ok(schema.properties.pipelines, 'repo root schema keeps pipelines key');
  assert.ok(schema.$defs.pipeline.properties.kind, 'pipeline values support kind');
  assert.ok(schema.$defs.pipeline.properties.nodes, 'pipeline values support map-form nodes');
  assert.match(JSON.stringify(schema.$defs.concreteNode.properties.kind), /git\.worktree/);
  assert.match(JSON.stringify(schema.$defs.concreteNode.properties.kind), /git\.merge/);
  assert.match(JSON.stringify(schema.$defs.concreteNode.allOf), /oneOf/);
  assert.match(JSON.stringify(configSchema.$defs.concreteNode.allOf), /oneOf/);
  assert.deepEqual(schema.$defs.containerImage.required, ['name']);
  assert.equal(schema.$defs.containerImage.properties.strategy, undefined);
});

test('runtime compiler converts deterministic runtime pipelines to graph-native execution config', () => {
  const pack = loadExecutionRuntimePack();
  const cfg = runtimeToSandcastleConfig(pack, { defaultSandbox: 'podman', defaultPipeline: 'archive' });
  assert.equal(cfg.defaultSandbox, 'podman');
  assert.equal(cfg.defaultPipeline, 'archive');
  assert.equal(cfg.defaultAgent, 'claude-code');
  assert.equal(cfg.maxWorkers, 5);
  assert.equal(cfg.maxIterations, 10);
  assert.equal(cfg.agents.planner.provider, undefined);
  assert.equal(cfg.agents.planner.sandbox, undefined);
  assert.equal(cfg.pipelines.archive.sandbox, undefined);
  assert.ok(cfg.agents.planner.systemPrompt.includes('planner'));
  assert.equal(cfg.pipelines.archive.branchStrategy.type, 'merge-to-head');
  assert.equal(cfg.pipelines['parallel-planner'].kind, 'composite');
  assert.equal(cfg.pipelines['parallel-planner'].nodes.implement.kind, 'loop');
  assert.equal(cfg.pipelines['parallel-planner'].nodes.implement.each, '$.executionContexts');
  assert.equal(cfg.pipelines['parallel-planner'].nodes.implement.node.kind, 'git.worktree');
  assert.equal(cfg.pipelines['parallel-planner'].nodes.merge.kind, 'git.merge');
  assert.equal(cfg.pipelines['parallel-planner'].steps[0].kind, 'runRole');
  assert.equal(cfg.pipelines['parallel-planner'].steps[0].role, 'implementer');
  assert.equal(cfg.pipelines['parallel-planner'].steps[0].maxIterations, undefined);
  assert.equal(cfg.pipelines['parallel-planner'].steps[0].concurrency, undefined);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.merge.kind, 'git.merge');
  assert.deepEqual(cfg.pipelines['parallel-planner-with-review'].nodes.merge.needs, ['implement', 'review']);
  assert.deepEqual(cfg.pipelines['parallel-planner-with-review'].nodes.merge.inputs, ['implement']);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].steps.at(-1).role, 'merger');
  assert.equal(compileRuntimeSteps([{ id: 'plan', kind: 'planWork', prompt: 'plan-work' }], pack)[0].role, 'planner');
  assert.equal(compileRuntimeSteps([{ id: 'noop', kind: 'gate' }], pack)[0].prompt, '$INPUT');
});

test('configToYaml renders graph-native runtime roles and pipelines', () => {
  const yaml = configToYaml(packsToConfig());
  assert.match(yaml, /^roles:/m);
  assert.match(yaml, /^  implementer:/m);
  assert.doesNotMatch(yaml, /^    provider:/m);
  assert.match(yaml, /systemPrompt: \|\n      You are the Agent Workflows implementer role/s);
  assert.doesNotMatch(yaml, /^    sandbox: docker/m);
  assert.match(yaml, /^pipelines:/m);
  assert.match(yaml, /^  parallel-planner-with-review:/m);
  assert.match(yaml, /^prompts:/m);
  assert.match(yaml, /template: \|\n      Inspect the configured Work Source/s);
  assert.doesNotMatch(yaml, /configured issue tracker|next open task|selected work item/);
  assert.match(yaml, /^    kind: composite/m);
  assert.match(yaml, /^    nodes:/m);
  assert.match(yaml, /kind: git\.worktree/);
  assert.match(yaml, /kind: git\.merge/);
  assert.doesNotMatch(yaml, /^    steps:/m);
  assert.match(yaml, /^maxWorkers: 5/m);
  assert.match(yaml, /^maxIterations: 10/m);
  assert.doesNotMatch(yaml, /role: implementer[\s\S]{0,120}maxIterations:/);
  assert.doesNotMatch(yaml, /concurrency:/);
  assert.doesNotMatch(yaml, /^teams:/m);
});
