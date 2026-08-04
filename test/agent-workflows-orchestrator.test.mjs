import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildExecutionGroups,
  deriveWorkExecutionContext,
  runWorkProcess,
  selectWorkProcessPipeline,
  validateExecutablePlanArtifact,
} from '../extensions/agent-workflows/orchestrator.ts';

test('orchestrator selects pipeline deterministically without planner recommendations', () => {
  assert.equal(selectWorkProcessPipeline({ explicitPipeline: 'review', defaultPipeline: 'simple-loop' }), 'review');
  assert.equal(selectWorkProcessPipeline({ defaultPipeline: 'simple-loop' }), 'simple-loop');
  assert.equal(selectWorkProcessPipeline({}), 'simple-loop');
});

test('orchestrator derives stable branch and context identity from work item fan-out', () => {
  const context = deriveWorkExecutionContext({
    runId: 'run 123',
    pipeline: 'Simple Loop',
    item: { id: 'WI 001', title: 'One' },
    groupIndex: 0,
    itemIndex: 0,
  });

  assert.deepEqual(context, {
    contextId: 'run-123/wi-001/0-0',
    branch: 'agent-workflows/simple-loop/run-123/wi-001',
    groupIndex: 0,
    itemIndex: 0,
    itemId: 'WI 001',
  });
});

test('orchestrator groups sequential and parallel work deterministically', () => {
  const sequential = buildExecutionGroups({
    runId: 'run-1',
    pipeline: 'implement',
    iteration: { parallelizable: false, items: [{ id: 'wi-1' }, { id: 'wi-2' }] },
  });
  assert.equal(sequential.length, 2);
  assert.deepEqual(sequential.map((group) => group.contexts.map((context) => context.itemId)), [['wi-1'], ['wi-2']]);

  const parallel = buildExecutionGroups({
    runId: 'run-1',
    pipeline: 'implement',
    iteration: { items: [{ id: 'wi-1' }, { id: 'wi-2' }] },
  });
  assert.equal(parallel.length, 1);
  assert.deepEqual(parallel[0].contexts.map((context) => context.itemId), ['wi-1', 'wi-2']);
});

test('runWorkProcess owns record writes, branch policy, and ignores planner recommendations', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  const writes = [];
  const executeInputs = [];
  let planCalls = 0;
  try {
    const result = await runWorkProcess(
      {
        cwd,
        query: 'review work',
        defaultPipeline: undefined,
        now: () => 1000,
        createRunId: () => 'run-fixed',
      },
      {
        async plan() {
          planCalls += 1;
          if (planCalls > 1) return { query: 'review work', iterations: [] };
          return {
            query: 'review work',
            iterations: [
              {
                recommendedPipeline: 'planner-owned-review',
                items: [{ id: 'wi-1', title: 'One' }, { id: 'wi-2', title: 'Two' }],
              },
            ],
          };
        },
        async execute(_cwd, input) {
          executeInputs.push(input);
          return { status: 'done', branches: ['worker-chosen-branch'], logs: ['runtime.log'], workSourceMutations: input.items.map((item) => ({ itemId: item.id, action: 'close', status: 'succeeded' })) };
        },
        writeRecord(repo, record) {
          writes.push(JSON.parse(JSON.stringify(record)));
          const path = join(repo, `${record.id}.json`);
          return path;
        },
      },
    );

    assert.equal(result.record.pipeline, 'simple-loop');
    assert.deepEqual(result.record.branches, ['worker-chosen-branch']);
    assert.deepEqual(result.record.logs, ['runtime.log']);
    assert.equal(result.record.executionContexts.length, 2);
    assert.deepEqual(result.record.executionContexts.map((context) => context.branch), [
      'agent-workflows/simple-loop/run-fixed/wi-1',
      'agent-workflows/simple-loop/run-fixed/wi-2',
    ]);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].status, 'running');
    assert.equal(writes[1].status, 'done');
    assert.deepEqual(executeInputs[0].executionContexts.map((context) => context.branch), result.record.executionContexts.map((context) => context.branch));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess omits dependency-blocked and HITL items before execution', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  const executeInputs = [];
  let planCalls = 0;
  try {
    const result = await runWorkProcess(
      {
        cwd,
        query: 'ready work',
        defaultPipeline: 'simple-loop',
        now: () => 1000,
        createRunId: () => 'run-filtered',
      },
      {
        async plan() {
          planCalls += 1;
          if (planCalls > 1) return { query: 'ready work', iterations: [] };
          return {
            query: 'ready work',
            iterations: [
              {
                hitl: ['wi-human'],
                items: [
                  { id: 'wi-ready', title: 'Ready', tags: ['afk'] },
                  { id: 'wi-blocked', title: 'Blocked', dependsOn: ['wi-foundation'], readiness: 'dependency-blocked', tags: ['afk'] },
                  { id: 'wi-dependent', title: 'Dependent in same pass', dependsOn: ['wi-ready'], tags: ['afk'] },
                  { id: 'wi-human', title: 'Human', tags: ['hitl'] },
                ],
              },
            ],
          };
        },
        async execute(_cwd, input) {
          executeInputs.push(input);
          return { status: 'done', branches: ['branch-ready'], logs: [], workSourceMutations: input.items.map((item) => ({ itemId: item.id, action: 'close', status: 'succeeded' })) };
        },
        writeRecord(repo, record) {
          return join(repo, `${record.id}.json`);
        },
      },
    );

    assert.deepEqual(executeInputs[0].items.map((item) => item.id), ['wi-ready']);
    assert.deepEqual(result.record.resolvedItems.map((item) => item.id), ['wi-ready']);
    assert.match(result.advisoryNotes.join('\n'), /omitted non-executable Work Items: wi-blocked, wi-dependent, wi-human/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess executes work waves until no eligible work remains', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  const executeInputs = [];
  let planCalls = 0;
  try {
    const result = await runWorkProcess(
      {
        cwd,
        query: 'ready work',
        defaultPipeline: 'simple-loop',
        now: () => 1000 + planCalls,
        createRunId: () => 'run-waves',
        maxIterations: 5,
      },
      {
        async plan() {
          planCalls += 1;
          if (planCalls === 1) return { query: 'ready work', iterations: [{ items: [{ id: 'wi-1', title: 'One' }, { id: 'wi-2', title: 'Two' }] }] };
          if (planCalls === 2) return { query: 'ready work', iterations: [{ items: [{ id: 'wi-3', title: 'Three' }] }] };
          return { query: 'ready work', iterations: [] };
        },
        async execute(_cwd, input) {
          executeInputs.push(input);
          return { status: 'done', branches: input.items.map((item) => `branch-${item.id}`), logs: input.items.map((item) => `log-${item.id}`), workSourceMutations: input.items.map((item) => ({ itemId: item.id, action: 'close', status: 'succeeded' })) };
        },
        writeRecord(repo, record) { return join(repo, `${record.id}.json`); },
      },
    );

    assert.deepEqual(executeInputs.map((input) => input.items.map((item) => item.id)), [['wi-1', 'wi-2'], ['wi-3']]);
    assert.deepEqual(result.record.resolvedItems.map((item) => item.id), ['wi-1', 'wi-2', 'wi-3']);
    assert.deepEqual(result.record.branches, ['branch-wi-1', 'branch-wi-2', 'branch-wi-3']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess resolves selected wave pipeline through the work-wave wrapper', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  const resolvedPipelines = [];
  let planCalls = 0;
  try {
    const result = await runWorkProcess(
      {
        cwd,
        query: 'ready work',
        defaultPipeline: 'selected-wave',
        entrypoint: 'configured-process',
        createRunId: () => 'run-wrapper',
      },
      {
        async plan() {
          planCalls += 1;
          return planCalls === 1 ? { query: 'ready work', iterations: [{ items: [{ id: 'wi-1', title: 'One' }] }] } : { query: 'ready work', iterations: [] };
        },
        resolveEntrypointPipeline(name) {
          assert.equal(name, 'configured-process');
          return { kind: 'composite', nodes: { waves: { kind: 'loop', max: 1, node: { $ref: '$.defaultPipeline' } } } };
        },
        resolveWavePipeline(name) {
          resolvedPipelines.push(name);
          return name === 'selected-wave' ? { kind: 'work.wave' } : undefined;
        },
        async execute(_cwd, input) {
          return { status: 'done', branches: [`branch-${input.pipeline}`], logs: [], workSourceMutations: input.items.map((item) => ({ itemId: item.id, action: 'close', status: 'succeeded' })) };
        },
      },
    );

    assert.deepEqual(resolvedPipelines, ['selected-wave']);
    assert.equal(result.record.pipeline, 'selected-wave');
    assert.deepEqual(result.record.branches, ['branch-selected-wave']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess fails closed when the Work Source returns already-closed work as ready', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  let planCalls = 0;
  try {
    await assert.rejects(
      runWorkProcess(
        {
          cwd,
          query: 'ready work',
          defaultPipeline: 'simple-loop',
          createRunId: () => 'run-cycle',
          maxIterations: 5,
        },
        {
          async plan() {
            planCalls += 1;
            return { query: 'ready work', iterations: [{ items: [{ id: 'wi-repeat', title: 'Repeat' }] }] };
          },
          async execute() { return { status: 'done', branches: ['branch-repeat'], logs: [], workSourceMutations: [{ itemId: 'wi-repeat', action: 'close', status: 'succeeded' }] }; },
        },
      ),
      /Work Source returned already-closed Work as ready: wi-repeat/,
    );
    assert.equal(planCalls, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess retries unclosed ready no-effect work until the workflow loop max', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  const executeInputs = [];
  try {
    await assert.rejects(
      runWorkProcess(
        {
          cwd,
          query: 'retry work',
          defaultPipeline: 'simple-loop',
          createRunId: () => 'run-retry',
          maxIterations: 2,
        },
        {
          async plan() {
            return { query: 'retry work', iterations: [{ items: [{ id: 'wi-retry', title: 'Retry' }] }] };
          },
          async execute(_cwd, input) {
            executeInputs.push(input);
            return { status: 'done', logs: [`log-${executeInputs.length}`] };
          },
        },
      ),
      /Work wave limit exceeded after 2 iteration\(s\)/,
    );
    assert.equal(executeInputs.length, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess fails closed when effectful done work remains ready without closure evidence', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  const executeInputs = [];
  try {
    await assert.rejects(
      runWorkProcess(
        {
          cwd,
          query: 'effectful unclosed work',
          defaultPipeline: 'simple-loop',
          createRunId: () => 'run-effectful-unclosed',
          maxIterations: 5,
        },
        {
          async plan() {
            return { query: 'effectful unclosed work', iterations: [{ items: [{ id: 'wi-effect', title: 'Effectful' }] }] };
          },
          async execute(_cwd, input) {
            executeInputs.push(input);
            return { status: 'done', branches: ['branch-effect'], logs: [] };
          },
        },
      ),
      /Work Items produced repository effects but are still reported ready without closure evidence: wi-effect/,
    );
    assert.equal(executeInputs.length, 1);
    const record = JSON.parse(readFileSync(join(cwd, '.pi/sandcastle/runs/run-effectful-unclosed.json'), 'utf8'));
    assert.equal(record.status, 'error');
    assert.match(record.error, /Work Items produced repository effects but are still reported ready without closure evidence: wi-effect/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess fails closed when no currently executable items remain', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  try {
    await assert.rejects(
      runWorkProcess(
        {
          cwd,
          query: 'blocked work',
          defaultPipeline: 'simple-loop',
        },
        {
          async plan() {
            return { iterations: [{ items: [{ id: 'wi-blocked', dependsOn: ['wi-foundation'], readiness: 'dependency-blocked' }, { id: 'wi-human', tags: ['hitl'] }] }] };
          },
          async execute() {
            throw new Error('execute should not be called');
          },
        },
      ),
      /No currently executable Work Items were selected.*wi-blocked, wi-human/s,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess validates cached plans before execution', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  try {
    await assert.rejects(
      runWorkProcess(
        {
          cwd,
          query: '',
          planId: 'plan-bad',
          defaultPipeline: 'simple-loop',
          createRunId: () => 'run-never',
        },
        {
          readPlanRecord() {
            return { kind: 'work-plan', plan: { iterations: [{ recommendedPipeline: 'review', items: [{ id: 'wi-1' }] }] } };
          },
          async plan() {
            throw new Error('plan should not be called');
          },
          async execute() {
            throw new Error('execute should not be called');
          },
        },
      ),
      /recommendedPipeline/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkProcess applies strict cached Work Plan schema checks', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-orchestrator-'));
  try {
    await assert.rejects(
      runWorkProcess(
        {
          cwd,
          query: '',
          planId: 'plan-bad-schema',
          defaultPipeline: 'simple-loop',
        },
        {
          readPlanRecord() {
            return { kind: 'work-plan', plan: { schemaVersion: 2, iterations: [{ parallelizable: 'yes', items: [{ id: 'wi-1', tags: 'not-array' }] }] } };
          },
          async plan() {
            throw new Error('plan should not be called');
          },
          async execute() {
            throw new Error('execute should not be called');
          },
        },
      ),
      /schemaVersion|parallelizable|tags/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('validateExecutablePlanArtifact rejects execution mechanics', () => {
  const errors = validateExecutablePlanArtifact({
    iterations: [{ branch: 'feature/work', items: [{ id: 'wi-1', pipeline: 'implement' }] }],
  });

  assert.match(errors.join('\n'), /branch/);
  assert.match(errors.join('\n'), /pipeline/);
});
