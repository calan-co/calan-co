import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as workRuns from '../extensions/agent-workflows/work-runs.mjs';
import {
  formatResumeSelection,
  formatStatusSelection,
  formatWorkRunList,
  isWorkRunResumable,
  listWorkRuns,
  readWorkRunRecords,
  resumeWorkRun,
  selectWorkRunForResume,
  selectWorkRunForStatus,
  workRunRecordPath,
  writeWorkRunRecord,
} from '../extensions/agent-workflows/work-runs.mjs';

async function withTempDir(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-work-'));
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

function workRun(overrides = {}) {
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

test('reads and filters unified work runs deterministically', async () => {
  await withTempDir(async (cwd) => {
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/run-1.json'), workRun({ kind: 'work-process' }));
    await writeJson(
      path.join(cwd, '.pi/sandcastle/runs/run-2.json'),
      workRun({
        id: 'run-2',
        kind: 'work-process',
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
      path.join(cwd, '.pi/sandcastle/runs/delegation-run.json'),
      {
        id: 'delegate-1',
        kind: 'direct-role',
        agent: 'researcher',
        task: 'look around',
        status: 'done',
      },
    );

    assert.equal(readWorkRunRecords(cwd).length, 2);
    assert.equal(listWorkRuns(cwd, 'auth').length, 1);
    assert.equal(listWorkRuns(cwd, 'wi-999').length, 1);
    assert.match(formatWorkRunList(listWorkRuns(cwd, 'auth')), /run-1/);
  });
});

test('reads work process records from unified run records and ignores other run kinds', async () => {
  await withTempDir(async (cwd) => {
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/work-1.json'), workRun({ id: 'work-1', kind: 'work-process' }));
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

    const records = readWorkRunRecords(cwd);
    assert.deepEqual(records.map((record) => record.id), ['work-1']);
    assert.equal(records[0].kind, 'work-process');
  });
});

test('ignores obsolete legacy work run directories', async () => {
  await withTempDir(async (cwd) => {
    await writeJson(path.join(cwd, '.pi/sandcastle/backlog-runs/legacy-only.json'), workRun({
      id: 'legacy-only',
      status: 'failed',
      updatedAt: 300,
      resolvedItems: [{ id: 'wi-legacy', title: 'Legacy record' }],
    }));
    await writeJson(path.join(cwd, '.pi/sandcastle/results/conflict.json'), workRun({
      id: 'conflict',
      status: 'failed',
      updatedAt: 400,
      itemIds: ['wi-old'],
      resolvedItems: [{ id: 'wi-old', title: 'Legacy conflict' }],
    }));
    await writeJson(path.join(cwd, '.pi/sandcastle/runs/conflict.json'), workRun({
      id: 'conflict',
      kind: 'work-process',
      status: 'done',
      updatedAt: 400,
      itemIds: ['wi-new'],
      resolvedItems: [{ id: 'wi-new', title: 'Unified conflict winner' }],
    }));

    const records = readWorkRunRecords(cwd);
    assert.deepEqual(records.map((record) => record.id), ['conflict']);
    assert.deepEqual(records[0].itemIds, ['wi-new']);
    assert.equal(records[0].sourcePath.endsWith('.pi/sandcastle/runs/conflict.json'), true);
  });
});

test('work run module no longer exports obsolete backlog compatibility aliases', () => {
  assert.equal('readBacklogRunRecords' in workRuns, false);
  assert.equal('listBacklogRuns' in workRuns, false);
  assert.equal('BACKLOG_RUNS_DIR' in workRuns, false);
  assert.equal('WORK_RESULTS_DIR' in workRuns, false);
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

    const [record] = readWorkRunRecords(cwd);
    assert.deepEqual(record.branches, ['agent-workflows/simple-loop/run/wi-1', 'agent-workflows/simple-loop/run/wi-2']);
    assert.equal(listWorkRuns(cwd, 'wi-2').length, 1);
    assert.match(formatWorkRunList([record]), /agent-workflows\/simple-loop\/run\/wi-1/);
  });
});

test('infers work status safely and reports ambiguity', async () => {
  const running = workRun({ id: 'run-a', updatedAt: 10 });
  const queued = workRun({ id: 'run-b', status: 'queued', updatedAt: 20 });
  const finished = workRun({
    id: 'run-c',
    status: 'done',
    updatedAt: 30,
    sessionId: 'ses-c',
    providerSession: { id: 'ses-c', supportsResume: true },
  });

  const activeSelection = selectWorkRunForStatus([running, queued, finished]);
  assert.equal(activeSelection.kind, 'ambiguous');
  assert.match(formatStatusSelection(activeSelection), /run-a/);
  assert.match(formatStatusSelection(activeSelection), /run-b/);

  const latestSelection = selectWorkRunForStatus([finished], '');
  assert.equal(latestSelection.kind, 'record');
  const latestStatus = formatStatusSelection(latestSelection);
  assert.match(latestStatus, /Latest work run/);
  assert.match(latestStatus, /Work process run-c/);
  assert.match(latestStatus, /Status: ✓ done/);
  assert.match(latestStatus, /Pipeline: implement/);

  const missingSelection = selectWorkRunForStatus([finished], 'missing');
  assert.equal(missingSelection.kind, 'missing');
  assert.match(formatStatusSelection(missingSelection), /No work run found/);
});

test('status shows lane-captured commits and rejected review reason', async () => {
  await withTempDir(async (cwd) => {
    const reviewLog = path.join(cwd, '.pi/sandcastle/runs/run-1/logs/reviewer.log');
    await fs.mkdir(path.dirname(reviewLog), { recursive: true });
    await fs.writeFile(reviewLog, 'Recommendation: Reject\n\nFindings:\n1. `sample-tests/fixture.test.mjs:1` — The branch adds a new fixture instead of renaming the existing fixture.\n\nMerge blocker: The implementation does not satisfy the rename-based acceptance criteria.');
    const record = workRun({
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

test('status indents nested parallel lanes beneath parent lanes without overwriting parent', async () => {
  const record = workRun({
    status: 'running',
    workerStatuses: [
      { index: 0, role: 'planner', kind: 'agent.pi', status: 'completed', itemId: 'wi-parent', laneId: 'run/wi-parent/0-0', nodePath: 'root.nodes.plan.iterations.0.nodes.plan', commits: [] },
      { index: 1, role: 'implementer', kind: 'agent.pi', status: 'running', itemId: 'wi-parent', laneId: 'run/wi-parent/0-0', nodePath: 'root.nodes.plan.iterations.0.nodes.implement.iterations.0.nodes.implement', commits: [] },
      { index: 2, role: 'merger', kind: 'git.merge', status: 'running', nodePath: 'root.nodes.merge', commits: [] },
    ],
  });
  const lines = formatStatusSelection({ kind: 'record', record, inference: 'latest' }).split('\n');
  const plannerIndex = lines.findIndex((line) => /planner/.test(line));
  const implementerIndex = lines.findIndex((line) => /implementer/.test(line));
  const mergerIndex = lines.findIndex((line) => /merger/.test(line));
  assert.ok(plannerIndex > -1, 'missing parent planner lane row');
  assert.ok(implementerIndex > plannerIndex, 'nested implementer lane should appear beneath planner lane');
  assert.ok(mergerIndex > implementerIndex, 'merger should appear beneath child lanes');
  assert.match(lines[plannerIndex], /^completed\s+planner/);
  assert.match(lines[implementerIndex], /^  running\s+implementer/);
  assert.match(lines[mergerIndex], /^running\s+merger/);
});

test('selects resumable work runs and rejects non-resumable ones', async () => {
  const resumable = workRun({
    id: 'run-resume',
    status: 'failed',
    updatedAt: 100,
    sessionId: 'ses-resume',
    providerSession: { id: 'ses-resume', supportsResume: true },
  });
  const notResumable = workRun({
    id: 'run-nope',
    status: 'failed',
    updatedAt: 200,
    sessionId: 'ses-nope',
    providerSession: { id: 'ses-nope', supportsResume: false },
  });

  const resumableSelection = selectWorkRunForResume([resumable, notResumable]);
  assert.equal(resumableSelection.kind, 'record');
  assert.equal(isWorkRunResumable(resumableSelection.record), true);
  assert.equal(isWorkRunResumable(notResumable), false);
  assert.match(formatResumeSelection(resumableSelection), /run-resume/);
});

test('resumes work runs through an injected capability and writes the durable record', async () => {
  await withTempDir(async (cwd) => {
    const original = workRun({
      id: 'run-resume',
      status: 'failed',
      updatedAt: 100,
      sessionId: 'ses-resume',
      providerSession: { id: 'ses-resume', supportsResume: true },
    });
    await writeWorkRunRecord(cwd, original);

    const calls = [];
    const result = await resumeWorkRun(cwd, 'run-resume', async (record) => {
      calls.push(record);
      return { ok: true };
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 'run-resume');
    assert.equal(calls[0].status, 'running');

    const saved = JSON.parse(
      await fs.readFile(workRunRecordPath(cwd, 'run-resume'), 'utf8'),
    );
    assert.equal(saved.status, 'running');
    assert.ok(saved.resumedAt);
    assert.ok(saved.updatedAt >= saved.createdAt);
  });
});

test('resume rejects Work Source Registration drift before invoking provider resume', async () => {
  await withTempDir(async (cwd) => {
    await writeWorkRunRecord(cwd, workRun({
      id: 'run-drift',
      status: 'failed',
      updatedAt: 100,
      sessionId: 'ses-drift',
      providerSession: { id: 'ses-drift', supportsResume: true },
      workSourceRegistration: { name: 'issues', kind: 'github-issues' },
    }));

    let resumeCalls = 0;
    const result = await resumeWorkRun(
      cwd,
      'run-drift',
      async () => {
        resumeCalls += 1;
        return { ok: true };
      },
      { currentWorkSourceRegistration: async () => ({ name: 'tasks', kind: 'beads' }) },
    );

    assert.equal(result.ok, false);
    assert.equal(resumeCalls, 0);
    assert.match(result.message, /Work Source Registration changed/);
    assert.match(result.message, /issues:github-issues/);
    assert.match(result.message, /tasks:beads/);
  });
});

test('returns clear errors for missing and non-resumable work runs without mutation', async () => {
  await withTempDir(async (cwd) => {
    await writeWorkRunRecord(
      cwd,
      workRun({
        id: 'run-nope',
        status: 'failed',
        updatedAt: 100,
        sessionId: 'ses-nope',
        providerSession: { id: 'ses-nope', supportsResume: false },
      }),
    );

    const missing = await resumeWorkRun(cwd, 'missing', async () => {
      throw new Error('should not be called');
    });
    assert.equal(missing.ok, false);
    assert.match(missing.message, /No work run found/);

    const before = await fs.readFile(
      workRunRecordPath(cwd, 'run-nope'),
      'utf8',
    );
    const nonResumable = await resumeWorkRun(cwd, 'run-nope', async () => {
      throw new Error('should not be called');
    });
    assert.equal(nonResumable.ok, false);
    assert.match(nonResumable.message, /not resumable/);
    const after = await fs.readFile(
      workRunRecordPath(cwd, 'run-nope'),
      'utf8',
    );
    assert.equal(after, before);
  });
});

test('registers the work run-management commands in the extension source', async () => {
  const extensionText = await fs.readFile(new URL('../extensions/agent-workflows/index.ts', import.meta.url), 'utf8');

  assert.match(extensionText, /registerCommand\("work:runs"/);
  assert.match(extensionText, /registerCommand\("work:status"/);
  assert.match(extensionText, /registerCommand\("work:resume"/);
});
