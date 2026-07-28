import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  formatBacklogRunList,
  formatResumeSelection,
  formatStatusSelection,
  isBacklogRunResumable,
  listBacklogRuns,
  readBacklogRunRecords,
  resumeBacklogRun,
  selectBacklogRunForResume,
  selectBacklogRunForStatus,
  backlogRunRecordPath,
  writeBacklogRunRecord,
} from '../extensions/agent-workflows/work-runs.mjs';

async function withTempDir(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-backlog-'));
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function backlogRun(overrides = {}) {
  return {
    id: 'run-1',
    query: 'auth bugs',
    pipeline: 'implement',
    status: 'running',
    createdAt: 100,
    updatedAt: 100,
    itemIds: ['wi-123'],
    resolvedItems: [{ id: 'wi-123', title: 'Auth bugs' }],
    branches: ['sandcastle/run-1'],
    logs: ['.pi/sandcastle/results/run-1.log'],
    sessionId: 'ses-123',
    providerSession: { id: 'ses-123', supportsResume: true },
    ...overrides,
  };
}

test('reads and filters backlog runs deterministically', async () => {
  await withTempDir(async (cwd) => {
    await writeJson(path.join(cwd, '.pi/sandcastle/backlog-runs/run-1.json'), backlogRun());
    await writeJson(
      path.join(cwd, '.pi/sandcastle/results/run-2.json'),
      backlogRun({
        id: 'run-2',
        query: 'docs cleanup',
        pipeline: 'review',
        status: 'done',
        createdAt: 200,
        updatedAt: 200,
        itemIds: ['wi-999'],
        resolvedItems: [{ id: 'wi-999', title: 'Docs cleanup' }],
        providerSession: { id: 'ses-999', supportsResume: true },
        sessionId: 'ses-999',
      }),
    );
    await writeJson(
      path.join(cwd, '.pi/sandcastle/results/delegation-run.json'),
      {
        id: 'delegate-1',
        agent: 'researcher',
        task: 'look around',
        status: 'done',
      },
    );

    assert.equal(readBacklogRunRecords(cwd).length, 2);
    assert.equal(listBacklogRuns(cwd, 'auth').length, 1);
    assert.equal(listBacklogRuns(cwd, 'wi-999').length, 1);
    assert.match(formatBacklogRunList(listBacklogRuns(cwd, 'auth')), /run-1/);
  });
});

test('reads backlog process records from unified run records and ignores other run kinds', async () => {
  await withTempDir(async (cwd) => {
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/work-1.json'), backlogRun({ id: 'work-1', kind: 'work-process' }));
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/direct-1.json'), {
      id: 'direct-1',
      kind: 'direct-role',
      agent: 'implementer',
      prompt: 'do work',
      status: 'completed',
      createdAt: 100,
      updatedAt: 100,
    });
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/pipeline-1/record.json'), {
      id: 'pipeline-1',
      kind: 'pipeline',
      pipeline: 'simple-loop',
      prompt: 'do work',
      status: 'completed',
      startedAt: new Date(100).toISOString(),
      completedAt: new Date(200).toISOString(),
      steps: [],
    });

    const records = readBacklogRunRecords(cwd);
    assert.deepEqual(records.map((record) => record.id), ['work-1']);
    assert.equal(records[0].kind, 'work-process');
  });
});

test('flattens orchestrator execution context branches for work run listing', async () => {
  await withTempDir(async (cwd) => {
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/work-contexts.json'), {
      id: 'work-contexts',
      kind: 'work-process',
      query: 'auth',
      pipeline: 'simple-loop',
      status: 'done',
      startedAt: 100,
      updatedAt: 200,
      resolvedItems: [{ id: 'wi-1', title: 'One' }, { id: 'wi-2', title: 'Two' }],
      executionContexts: [
        { itemId: 'wi-1', contextId: 'run/wi-1/0-0', branch: 'agent-workflows/simple-loop/run/wi-1' },
        { itemId: 'wi-2', contextId: 'run/wi-2/0-1', branch: 'agent-workflows/simple-loop/run/wi-2' },
      ],
      logs: ['runtime.log'],
    });

    const [record] = readBacklogRunRecords(cwd);
    assert.deepEqual(record.branches, ['agent-workflows/simple-loop/run/wi-1', 'agent-workflows/simple-loop/run/wi-2']);
    assert.equal(listBacklogRuns(cwd, 'wi-2').length, 1);
    assert.match(formatBacklogRunList([record]), /agent-workflows\/simple-loop\/run\/wi-1/);
  });
});

test('infers backlog status safely and reports ambiguity', async () => {
  const running = backlogRun({ id: 'run-a', updatedAt: 10 });
  const queued = backlogRun({ id: 'run-b', status: 'queued', updatedAt: 20 });
  const finished = backlogRun({
    id: 'run-c',
    status: 'done',
    updatedAt: 30,
    sessionId: 'ses-c',
    providerSession: { id: 'ses-c', supportsResume: true },
  });

  const activeSelection = selectBacklogRunForStatus([running, queued, finished]);
  assert.equal(activeSelection.kind, 'ambiguous');
  assert.match(formatStatusSelection(activeSelection), /run-a/);
  assert.match(formatStatusSelection(activeSelection), /run-b/);

  const latestSelection = selectBacklogRunForStatus([finished], '');
  assert.equal(latestSelection.kind, 'record');
  const latestStatus = formatStatusSelection(latestSelection);
  assert.match(latestStatus, /Latest work run/);
  assert.match(latestStatus, /Work process run-c/);
  assert.match(latestStatus, /Status: ✓ done/);
  assert.match(latestStatus, /Pipeline: implement/);

  const missingSelection = selectBacklogRunForStatus([finished], 'missing');
  assert.equal(missingSelection.kind, 'missing');
  assert.match(formatStatusSelection(missingSelection), /No work run found/);
});

test('status shows lane-captured commits and rejected review reason', async () => {
  await withTempDir(async (cwd) => {
    const reviewLog = path.join(cwd, '.pi/sandcastle/runs/run-1/logs/reviewer.log');
    await fs.mkdir(path.dirname(reviewLog), { recursive: true });
    await fs.writeFile(reviewLog, 'Recommendation: Reject\n\nFindings:\n1. `sample-tests/fixture.test.mjs:1` — The branch adds a new fixture instead of renaming the existing fixture.\n\nMerge blocker: The implementation does not satisfy the rename-based acceptance criteria.');
    const record = backlogRun({
      status: 'done',
      workerStatuses: [
        { index: 0, role: 'git.worktree', kind: 'git.worktree', status: 'completed', itemId: 'wi-002', laneId: 'run/wi-002/0-1', branch: 'agent-workflows/run/wi-002', commits: ['abc123'] },
        { index: 1, role: 'implementer', kind: 'agent.pi', status: 'completed', itemId: 'wi-002', laneId: 'run/wi-002/0-1', branch: 'agent-workflows/run/wi-002', commits: [] },
        { index: 2, role: 'reviewer', kind: 'agent.pi', status: 'completed', itemId: 'wi-002', laneId: 'run/wi-002/0-1', branch: 'agent-workflows/run/wi-002', commits: [], logPath: reviewLog },
      ],
    });
    const status = formatStatusSelection({ kind: 'record', record, inference: 'latest' });
    assert.match(status, /Execution workers: 1/);
    assert.match(status, /reviewer\s+0s · item wi-002; lane run\/wi-002\/0-1; rejected · captured 1 commit\(s\) on lane branch · `sample-tests\/fixture\.test\.mjs:1` — The branch adds a new fixture instead of renaming the existing fixture\./);
  });
});

test('status indents nested parallel lanes beneath parent lanes', async () => {
  const record = backlogRun({
    status: 'running',
    workerStatuses: [
      { index: 0, role: 'reviewer', kind: 'agent.pi', status: 'running', itemId: 'parent', laneId: 'run/parent/0-0', nodePath: 'root.nodes.outer.iterations.0.nodes.review', commits: [] },
      { index: 1, role: 'implementer', kind: 'agent.pi', status: 'running', itemId: 'child', laneId: 'run/parent/0-0/child/0-0', nodePath: 'root.nodes.outer.iterations.0.nodes.inner.iterations.0.nodes.implement', commits: [] },
    ],
  });
  const lines = formatStatusSelection({ kind: 'record', record, inference: 'latest' }).split('\n');
  const parentIndex = lines.findIndex((line) => /item parent/.test(line));
  const childIndex = lines.findIndex((line) => /item child/.test(line));
  assert.ok(parentIndex > -1, 'missing parent lane row');
  assert.ok(childIndex > parentIndex, 'nested lane should appear beneath parent lane');
  assert.match(lines[parentIndex], /^running\s+reviewer/);
  assert.match(lines[childIndex], /^  running\s+implementer/);
});

test('selects resumable backlog runs and rejects non-resumable ones', async () => {
  const resumable = backlogRun({
    id: 'run-resume',
    status: 'failed',
    updatedAt: 100,
    sessionId: 'ses-resume',
    providerSession: { id: 'ses-resume', supportsResume: true },
  });
  const notResumable = backlogRun({
    id: 'run-nope',
    status: 'failed',
    updatedAt: 200,
    sessionId: 'ses-nope',
    providerSession: { id: 'ses-nope', supportsResume: false },
  });

  const resumableSelection = selectBacklogRunForResume([resumable, notResumable]);
  assert.equal(resumableSelection.kind, 'record');
  assert.equal(isBacklogRunResumable(resumableSelection.record), true);
  assert.equal(isBacklogRunResumable(notResumable), false);
  assert.match(formatResumeSelection(resumableSelection), /run-resume/);
});

test('resumes backlog runs through an injected capability and writes the durable record', async () => {
  await withTempDir(async (cwd) => {
    const original = backlogRun({
      id: 'run-resume',
      status: 'failed',
      updatedAt: 100,
      sessionId: 'ses-resume',
      providerSession: { id: 'ses-resume', supportsResume: true },
    });
    await writeBacklogRunRecord(cwd, original);

    const calls = [];
    const result = await resumeBacklogRun(cwd, 'run-resume', async (record) => {
      calls.push(record);
      return { ok: true };
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 'run-resume');
    assert.equal(calls[0].status, 'running');

    const saved = JSON.parse(
      await fs.readFile(backlogRunRecordPath(cwd, 'run-resume'), 'utf8'),
    );
    assert.equal(saved.status, 'running');
    assert.ok(saved.resumedAt);
    assert.ok(saved.updatedAt >= saved.createdAt);
  });
});

test('returns clear errors for missing and non-resumable backlog runs without mutation', async () => {
  await withTempDir(async (cwd) => {
    await writeBacklogRunRecord(
      cwd,
      backlogRun({
        id: 'run-nope',
        status: 'failed',
        updatedAt: 100,
        sessionId: 'ses-nope',
        providerSession: { id: 'ses-nope', supportsResume: false },
      }),
    );

    const missing = await resumeBacklogRun(cwd, 'missing', async () => {
      throw new Error('should not be called');
    });
    assert.equal(missing.ok, false);
    assert.match(missing.message, /No work run found/);

    const before = await fs.readFile(
      backlogRunRecordPath(cwd, 'run-nope'),
      'utf8',
    );
    const nonResumable = await resumeBacklogRun(cwd, 'run-nope', async () => {
      throw new Error('should not be called');
    });
    assert.equal(nonResumable.ok, false);
    assert.match(nonResumable.message, /not resumable/);
    const after = await fs.readFile(
      backlogRunRecordPath(cwd, 'run-nope'),
      'utf8',
    );
    assert.equal(after, before);
  });
});

test('registers the backlog run-management commands in the extension source', async () => {
  const extensionText = await fs.readFile(new URL('../extensions/agent-workflows/index.ts', import.meta.url), 'utf8');

  assert.match(extensionText, /registerCommand\("work:runs"/);
  assert.match(extensionText, /registerCommand\("work:status"/);
  assert.match(extensionText, /registerCommand\("work:resume"/);
});
