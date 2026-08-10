import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listRuntimeAgents,
  listRuntimePipelines,
  loadExecutionRuntimePack,
  runtimeToSandcastleConfig,
  validateExecutionRuntimePack,
} from '../extensions/agent-workflows/execution-runtime.ts';
import { readFileSync } from 'node:fs';
import { configToYaml, packsToConfig } from '../extensions/agent-workflows/pipeline-packs.mjs';

test('execution runtime pack ports prompts, roles, and graph-native pipelines', () => {
  const pack = loadExecutionRuntimePack();
  assert.equal(pack.runtimeVersion, 1);
  assert.ok(pack.prompts['simple-loop'].template.includes('$INPUT'));
  assert.equal(pack.roles.implementer.role, 'implementer');
  assert.equal(pack.pipelines['parallel-planner-with-review'].kind, 'composite');
  assert.equal(pack.pipelines['parallel-planner-with-review'].nodes.implement.kind, 'loop');
  assert.equal(pack.pipelines['parallel-planner-with-review'].nodes.implement.each, '$.executionContexts');
  assert.equal(pack.pipelines['parallel-planner-with-review'].steps, undefined);
  assert.ok(listRuntimeAgents(pack).some((agent) => agent.name === 'reviewer'));
  assert.ok(listRuntimePipelines(pack).some((pipeline) => pipeline.name === 'archive'));
  assert.ok(listRuntimePipelines(pack).some((pipeline) => pipeline.name === 'work-process-waves'));
  assert.equal(pack.pipelines['work-process-waves'].nodes.waves.kind, 'loop');
  assert.equal(pack.pipelines['work-process-waves'].nodes.waves.each, undefined);
  assert.equal(pack.pipelines['work-process-waves'].nodes.waves.node.$ref, '$.defaultPipeline');
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
    /prompt 'bad' must define template or file.*must define graph-native nodes/s,
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
              nodes: { other: { kind: 'agent.pi', role: 'worker', prompt: 'ok' } },
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
      pipelines: { p: { kind: 'composite', nodes: { wave: { $ref: 'missing' } } } },
    }),
    /p\.wave \$ref references unknown pipeline 'missing'/s,
  );
  assert.doesNotThrow(() => validateExecutionRuntimePack({
    runtimeVersion: 1,
    roles: { worker: {} },
    prompts: { ok: { format: 'markdown', template: 'x' } },
    pipelines: {
      simple: { kind: 'composite', nodes: { run: { kind: 'agent.pi', role: 'worker', prompt: 'ok' } } },
      close: { kind: 'composite', nodes: { close: { kind: 'work.close', maxIterations: 3, finalize: { role: 'worker', prompt: 'ok' } } } },
      wrapper: { kind: 'composite', nodes: { waves: { kind: 'loop', max: 2, node: { $ref: '$.defaultPipeline' } } } },
    },
  }));
  assert.throws(
    () => validateExecutionRuntimePack({
      runtimeVersion: 1,
      roles: { worker: {} },
      prompts: { ok: { format: 'markdown', template: 'x' } },
      pipelines: { p: { kind: 'composite', nodes: { run: { kind: 'agent.pi', role: 'worker', prompt: 'ok', finalize: { prompt: 'ok' } } } } },
    }),
    /p\.run finalize is supported only on work\.close nodes/s,
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

test('runtime compiler preserves map-form concrete-node pipelines only', () => {
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
    },
  });
  assert.equal(pack.pipelines.map.kind, 'composite');
  assert.equal(pack.pipelines.map.nodes.run.kind, 'agent.pi');
  assert.equal(pack.pipelines.map.steps, undefined);
  const cfg = runtimeToSandcastleConfig(pack);
  assert.equal(cfg.pipelines.map.kind, 'composite');
  assert.equal(cfg.pipelines.map.nodes.run.kind, 'agent.pi');
  assert.equal(cfg.pipelines.map.nodes.merge.kind, 'git.merge');
  assert.equal(cfg.pipelines.map.steps, undefined);
});

test('runtime compiler preserves all git.worktree child agent nodes', () => {
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

  assert.equal(pack.pipelines.worktree.nodes.branch.nodes.implement.role, 'worker');
  assert.equal(pack.pipelines.worktree.nodes.branch.nodes.review.role, 'reviewer');
  const cfg = runtimeToSandcastleConfig(pack);
  assert.equal(cfg.pipelines.worktree.nodes.branch.nodes.implement.role, 'worker');
  assert.equal(cfg.pipelines.worktree.steps, undefined);
});

test('execution runtime schema requires graph-native composite map nodes', () => {
  const schema = JSON.parse(readFileSync(new URL('../extensions/agent-workflows/schema/execution-runtime.schema.json', import.meta.url), 'utf8'));
  const configSchema = JSON.parse(readFileSync(new URL('../extensions/agent-workflows/schema/config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.required, ['runtimeVersion', 'defaults', 'roles', 'prompts', 'pipelines']);
  assert.ok(schema.properties.pipelines, 'repo root schema keeps pipelines key');
  assert.ok(schema.$defs.pipeline.properties.kind, 'pipeline values support kind');
  assert.ok(schema.$defs.pipeline.properties.nodes, 'pipeline values support map-form nodes');
  assert.equal(schema.$defs.pipeline.properties.steps, undefined);
  assert.deepEqual(schema.$defs.pipeline.required, ['kind', 'nodes']);
  assert.equal(configSchema.$defs.pipeline.properties.steps, undefined);
  assert.deepEqual(configSchema.$defs.pipeline.required, ['kind', 'nodes']);
  assert.match(JSON.stringify(schema.$defs.concreteNode.properties.kind), /git\.worktree/);
  assert.match(JSON.stringify(schema.$defs.concreteNode.properties.kind), /git\.merge/);
  assert.ok(schema.$defs.concreteNode.properties.$ref, 'execution schema supports reserved $ref meta nodes');
  assert.ok(configSchema.$defs.concreteNode.properties.$ref, 'config schema supports reserved $ref meta nodes');
  assert.ok(schema.$defs.concreteNode.properties.finalize, 'execution schema supports work.close finalizers');
  assert.ok(configSchema.$defs.concreteNode.properties.finalize, 'config schema supports work.close finalizers');
  assert.ok(schema.$defs.concreteNode.properties.maxIterations, 'execution schema supports work.close attempt count');
  assert.ok(configSchema.$defs.concreteNode.properties.maxIterations, 'config schema supports work.close attempt count');
  assert.match(JSON.stringify(schema.$defs.concreteNode.allOf), /"mode":\{"const":"parallel"\}.*"required":\["each"\]/, 'only parallel loops require each');
  assert.match(JSON.stringify(schema.$defs.concreteNode.allOf), /oneOf/);
  assert.match(JSON.stringify(configSchema.$defs.concreteNode.allOf), /oneOf/);
  assert.deepEqual(schema.$defs.containerImage.required, ['name']);
  assert.equal(schema.$defs.containerImage.properties.strategy, undefined);
});

test('runtime pack declares ordinary named Work Source Registrations with executable argument templates', () => {
  const pack = loadExecutionRuntimePack();
  assert.ok(pack.workSources['github-issues']);
  assert.ok(pack.workSources['beads']);
  assert.ok(pack.workSources['doc-vader']);
  assert.equal(pack.defaults.workSource, 'github-issues');
  assert.equal(pack.workSources['github-issues'].kind, 'github-issues');
  assert.deepEqual(pack.workSources['github-issues'].commands.ready, {
    executable: 'gh',
    args: ['issue', 'list', '--state', 'open', '--json', 'number,title,state,body,url,labels'],
  });
  assert.equal(typeof pack.workSources['github-issues'].closeCommand, 'undefined');
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
  assert.equal(cfg.pipelines['parallel-planner'].nodes.merge.delete, true);
  assert.equal(cfg.pipelines['parallel-planner'].steps, undefined);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.implement.node.nodes.review.needs[0], 'implement');
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.implement.node.nodes.close.maxIterations, 3);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.implement.node.nodes.close.finalize.maxIterations, undefined);
  assert.equal(pack.workSources['doc-vader'].validateCommand, undefined);
  assert.equal(pack.workSources['doc-vader'].closeCommand, undefined);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.merge.kind, 'git.merge');
  assert.equal(cfg.pipelines['parallel-planner-with-review'].nodes.merge.delete, true);
  assert.deepEqual(cfg.pipelines['parallel-planner-with-review'].nodes.merge.needs, ['implement']);
  assert.deepEqual(cfg.pipelines['parallel-planner-with-review'].nodes.merge.inputs, ['implement']);
  assert.equal(cfg.pipelines['parallel-planner-with-review'].steps, undefined);
  assert.equal(cfg.pipelines['work-process-waves'].kind, 'composite');
  assert.equal(cfg.pipelines['work-process-waves'].nodes.waves.kind, 'loop');
  assert.equal(cfg.pipelines['work-process-waves'].nodes.waves.each, undefined);
  assert.equal(cfg.pipelines['work-process-waves'].nodes.waves.node.$ref, '$.defaultPipeline');
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
  assert.doesNotMatch(yaml.match(/^  implementer:\n[\s\S]*?(?=^  reviewer:)/m)?.[0] || '', /maxIterations:/);
  assert.match(yaml, /^  work-process-waves:/m);
  assert.match(yaml, /^          "\$ref": \$\.defaultPipeline/m);
  assert.doesNotMatch(yaml, /concurrency:/);
  assert.doesNotMatch(yaml, /^teams:/m);
});
