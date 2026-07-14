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
          return { status: 'done', branches: ['worker-chosen-branch'], logs: ['runtime.log'] };
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
