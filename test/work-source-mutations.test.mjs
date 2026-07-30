import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import agentWorkflows from '../extensions/agent-workflows/index.ts';

async function setup({ failValidate = false } = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-work-source-mutations-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), [
    'defaultPipeline: graph-process',
    'defaultSandbox: no-sandbox',
    'defaultModel: test-model',
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
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [work]',
  ].join('\n'), 'utf8');

  const commands = new Map();
  const notifications = [];
  const mutations = [];
  let gitHead = 'base';
  let planCalls = 0;
  agentWorkflows({
    registerCommand(name, spec) { commands.set(name, spec); },
    on() {},
    registerTool() {},
  }, {
    work: {
      now: () => 1710000100000,
      plan: async (_cwd, query) => {
        planCalls += 1;
        if (planCalls > 1) return { query, iterations: [] };
        return {
          query,
          iterations: [{
            supportsParallel: false,
            items: [{ id: 'wi-1', title: 'First item', tags: [], sourcePath: 'backlog/wi-1.md' }],
          }],
        };
      },
      workSourceAdapter: {
        validate: async ({ itemId, runId, cwd }) => {
          mutations.push(`validate:${itemId}:${runId}:${cwd === repoRoot}`);
          if (failValidate) throw new Error('validation failed');
        },
        close: async ({ itemId, runId }) => {
          mutations.push(`close:${itemId}:${runId}`);
        },
      },
    },
    pipeline: {
      now: () => 1700000010000,
      createWorktree: async () => ({
        branch: 'sandcastle/graph-process',
        worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees/graph-process'),
        close: async () => ({}),
        run: async (options) => ({
          iterations: [],
          commits: [{ sha: 'sha-1' }],
          branch: 'agent-invented',
          stdout: '',
          logFilePath: options.logging.path,
        }),
      }),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
      runGit: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'sandcastle/graph-process\n', stderr: '' };
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${gitHead}\n`, stderr: '' };
        if (args[0] === 'merge') {
          gitHead = 'merged';
          return { status: 0, stdout: `Merged ${args.at(-1)}\n`, stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  });

  const ctx = { cwd: repoRoot, ui: { notify(message, type = 'info') { notifications.push({ message, type }); }, setWidget() {} } };
  return { repoRoot, commands, ctx, notifications, mutations };
}

async function readProcessRecord(repoRoot) {
  const dir = path.join(repoRoot, '.pi/sandcastle/runs');
  const names = await fs.readdir(dir);
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    if (record.kind === 'work-process') return record;
  }
  throw new Error('missing work process record');
}

test('/work:process validates then closes each item after successful graph execution', async () => {
  const fixture = await setup();
  try {
    await fixture.commands.get('work:process').handler('demo', fixture.ctx);
    const record = await readProcessRecord(fixture.repoRoot);
    assert.equal(record.status, 'done');
    assert.deepEqual(fixture.mutations, [
      `validate:wi-1:${record.id}:true`,
      `close:wi-1:${record.id}`,
    ]);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), [
      'wi-1:validate:succeeded',
      'wi-1:close:succeeded',
    ]);
    assert.match(fixture.notifications.at(-1).message, /Work Source:\n  ✓ wi-1: validate succeeded\n  ✓ wi-1: close succeeded/);
  } finally {
    await fs.rm(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('/work:process can close work through an explicit graph work.close node before merge', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-explicit-close-'));
  const worktreePath = path.join(repoRoot, '.pi/sandcastle/worktrees/explicit-close');
  try {
    await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), [
      'defaultPipeline: graph-close',
      'defaultSandbox: no-sandbox',
      'defaultModel: test-model',
      'roles:',
      '  implementer:',
      '    provider: claude-code',
      '    sandbox: no-sandbox',
      '    model: test-model',
      '  reviewer:',
      '    provider: claude-code',
      '    sandbox: no-sandbox',
      '    model: test-model',
      'pipelines:',
      '  graph-close:',
      '    kind: composite',
      '    nodes:',
      '      work:',
      '        kind: git.worktree',
      '        nodes:',
      '          implement:',
      '            kind: agent.pi',
      '            role: implementer',
      '            prompt: Implement $INPUT',
      '          review:',
      '            kind: agent.pi',
      '            role: reviewer',
      '            prompt: Review $INPUT',
      '            needs: [implement]',
      '          close:',
      '            kind: work.close',
      '            needs: [review]',
      '            when: needs.review.accepted == true',
      '      merge:',
      '        kind: git.merge',
      '        needs: [work]',
      '        when: has(needs.work.children.close.closed) && needs.work.children.close.closed == true',
    ].join('\n'), 'utf8');

    const commands = new Map();
    const mutations = [];
    let planCalls = 0;
    let gitHead = 'base';
    agentWorkflows({ registerCommand(name, spec) { commands.set(name, spec); }, on() {}, registerTool() {} }, {
      work: {
        now: () => 1710000200000,
        plan: async (_cwd, query) => {
          planCalls += 1;
          return planCalls === 1 ? { query, iterations: [{ items: [{ id: 'wi-1', title: 'First item', tags: [] }] }] } : { query, iterations: [] };
        },
        workSourceAdapter: {
          close: async ({ itemId, cwd }) => {
            mutations.push(`close:${itemId}:${cwd === worktreePath}`);
            return { status: 0, stdout: 'closed', stderr: '', command: `close ${itemId}` };
          },
        },
      },
      pipeline: {
        now: () => 1700000020000,
        createWorktree: async () => ({
          branch: 'sandcastle/explicit-close',
          worktreePath,
          close: async () => ({}),
          run: async (options) => ({
            iterations: [],
            commits: options.prompt.includes('reviewer role') ? [] : [{ sha: 'sha-1' }],
            branch: 'sandcastle/explicit-close',
            stdout: options.prompt.includes('reviewer role') ? 'Review result: ACCEPT' : '',
            logFilePath: options.logging.path,
          }),
        }),
        loadSandboxProvider: async (kind) => ({ kind }),
        makeAgent: (model, provider) => ({ model, provider }),
        runGit: async (args) => {
          if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'main\n', stderr: '' };
          if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${gitHead}\n`, stderr: '' };
          if (args[0] === 'merge') { gitHead = 'merged'; return { status: 0, stdout: 'merged\n', stderr: '' }; }
          return { status: 0, stdout: '', stderr: '' };
        },
      },
    });

    const notifications = [];
    const ctx = { cwd: repoRoot, ui: { notify(message, type = 'info') { notifications.push({ message, type }); }, setWidget() {} } };
    await commands.get('work:process').handler('demo', ctx);
    const record = await readProcessRecord(repoRoot);
    assert.equal(record.status, 'done', notifications.at(-1)?.message);
    assert.deepEqual(mutations, ['close:wi-1:true']);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), ['wi-1:close:succeeded']);
    assert.equal(notifications.at(-1).type, 'success');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('/work:process does not close an item when Work Source validation fails', async () => {
  const fixture = await setup({ failValidate: true });
  try {
    await fixture.commands.get('work:process').handler('demo', fixture.ctx);
    const record = await readProcessRecord(fixture.repoRoot);
    assert.equal(record.status, 'error');
    assert.deepEqual(fixture.mutations, [`validate:wi-1:${record.id}:true`]);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), ['wi-1:validate:failed']);
    assert.equal(fixture.notifications.at(-1).type, 'error');
  } finally {
    await fs.rm(fixture.repoRoot, { recursive: true, force: true });
  }
});
