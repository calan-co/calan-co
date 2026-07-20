import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import agentWorkflows from '../extensions/agent-workflows/index.ts';

async function setupProcessGraphRepo({ noEffects = false } = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-process-graph-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), [
    'defaultPipeline: graph-process',
    'defaultSandbox: no-sandbox',
    'defaultModel: test-model',
    'maxWorkers: 2',
    'roles:',
    '  implementer:',
    '    provider: claude-code',
    '    sandbox: no-sandbox',
    '    model: test-model',
    'pipelines:',
    '  graph-process:',
    '    kind: composite',
    '    branchStrategy:',
    '      type: branch',
    '      branch: sandcastle/graph-process',
    '    nodes:',
    '      work:',
    '        kind: loop',
    '        mode: parallel',
    '        each: executionContexts',
    '        max: 2',
    '        node:',
    '          kind: git.worktree',
    '          nodes:',
    '            implement:',
    '              kind: agent.pi',
    '              role: implementer',
    '              prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [work]',
  ].join('\n'), 'utf8');

  const commands = new Map();
  const events = new Map();
  const notifications = [];
  const widgets = [];
  const runCalls = [];
  agentWorkflows({
    registerCommand(name, spec) { commands.set(name, spec); },
    on(name, handler) { events.set(name, handler); },
    registerTool() {},
  }, {
    work: {
      now: () => 1710000100000,
      plan: async (_cwd, query) => ({
        query,
        iterations: [{
          supportsParallel: true,
          items: [
            { id: 'wi-1', title: 'First graph item', tags: [], sourcePath: 'backlog/wi-1.md' },
            { id: 'wi-2', title: 'Second graph item', tags: [], sourcePath: 'backlog/wi-2.md' },
          ],
        }],
      }),
    },
    pipeline: {
      now: () => 1700000010000,
      createWorktree: async () => ({
        branch: 'sandcastle/graph-process',
        worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees/graph-process'),
        close: async () => ({}),
        run: async (options) => {
          runCalls.push(options);
          const index = runCalls.length;
          return {
            iterations: [],
            commits: noEffects ? [] : [{ sha: `sha-${index}` }],
            branch: `agent-invented-${index}`,
            stdout: '',
            logFilePath: options.logging.path,
          };
        },
      }),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    },
  });

  const ctx = {
    cwd: repoRoot,
    ui: {
      notify(message, type = 'info') { notifications.push({ message, type }); },
      setWidget(id, lines) { widgets.push({ id, lines }); },
    },
  };
  await events.get('session_start')?.({}, ctx);
  return { repoRoot, commands, ctx, notifications, widgets, runCalls };
}

async function readWorkProcessRecords(repoRoot) {
  const dir = path.join(repoRoot, '.pi/sandcastle/runs');
  const names = await fs.readdir(dir);
  const records = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    if (record.kind === 'work-process') records.push(record);
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

async function readPipelineRecords(repoRoot) {
  const root = path.join(repoRoot, '.pi/sandcastle/runs');
  const entries = await fs.readdir(root, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const record = JSON.parse(await fs.readFile(path.join(root, entry.name, 'record.json'), 'utf8'));
      if (record.kind === 'pipeline') records.push(record);
    } catch {}
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

test('work:process executes graph pipelines and records context-bound lane statuses', async () => {
  const { repoRoot, commands, ctx, notifications, runCalls } = await setupProcessGraphRepo();
  try {
    await commands.get('work:process').handler('graph', ctx);

    assert.equal(runCalls.length, 2, 'graph loop should run one implementer per execution context');
    assert.equal(notifications.at(-1).type, 'success');

    const [processRecord] = await readWorkProcessRecords(repoRoot);
    assert.equal(processRecord.status, 'done');
    assert.equal(processRecord.pipeline, 'graph-process');
    assert.equal(processRecord.workerStatuses.length >= 2, true);
    for (const itemId of ['wi-1', 'wi-2']) {
      const context = processRecord.executionContexts.find((entry) => entry.itemId === itemId);
      assert.ok(context, `missing execution context for ${itemId}`);
      const status = processRecord.workerStatuses.find((entry) => entry.itemId === itemId && entry.kind === 'git.worktree');
      assert.ok(status, `missing graph workspace status for ${itemId}`);
      assert.equal(status.branch, context.branch, 'workspace status must use orchestrator-owned branch');
      assert.equal(status.status, 'completed');
    }

    const [pipelineRecord] = await readPipelineRecords(repoRoot);
    assert.equal(pipelineRecord.executor, 'graph');
    assert.equal(pipelineRecord.status, 'completed');
    assert.ok(pipelineRecord.nodes.some((node) => node.nodePath.includes('iterations.0') && node.itemId === 'wi-1'));
    assert.ok(pipelineRecord.nodes.some((node) => node.nodePath.includes('iterations.1') && node.itemId === 'wi-2'));
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('work:process graph execution fails closed when lanes only produce logs', async () => {
  const { repoRoot, commands, ctx, notifications } = await setupProcessGraphRepo({ noEffects: true });
  try {
    await commands.get('work:process').handler('graph', ctx);

    assert.equal(notifications.at(-1).type, 'error');
    assert.match(notifications.at(-1).message, /requires effectful mergeable needs|without effects|no effects/);
    const [processRecord] = await readWorkProcessRecords(repoRoot);
    assert.equal(processRecord.status, 'error');
    assert.deepEqual(processRecord.branches, []);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
