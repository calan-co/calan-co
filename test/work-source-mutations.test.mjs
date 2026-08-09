import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import agentWorkflows from '../extensions/agent-workflows/index.ts';

async function setup({ failValidate = false, targetDirtyStatus = '' } = {}) {
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
  let createWorktreeCalls = 0;
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
      createWorktree: async () => {
        createWorktreeCalls += 1;
        return {
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
      };
      },
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
      runGit: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'sandcastle/graph-process\n', stderr: '' };
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${gitHead}\n`, stderr: '' };
        if (args[0] === 'status' && args[1] === '--porcelain') return { status: 0, stdout: targetDirtyStatus, stderr: '' };
        if (args[0] === 'merge') {
          gitHead = 'merged';
          return { status: 0, stdout: `Merged ${args.at(-1)}\n`, stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  });

  const ctx = { cwd: repoRoot, ui: { notify(message, type = 'info') { notifications.push({ message, type }); }, setWidget() {} } };
  return { repoRoot, commands, ctx, notifications, mutations, get createWorktreeCalls() { return createWorktreeCalls; } };
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

test('/work:process fails fast before agent work when merge target worktree is dirty', async () => {
  const fixture = await setup({ targetDirtyStatus: ' M .pi/sandcastle/config.yaml\n' });
  try {
    await fixture.commands.get('work:process').handler('demo', fixture.ctx);
    assert.equal(fixture.createWorktreeCalls, 0);
    assert.deepEqual(fixture.mutations, []);
    assert.equal(fixture.notifications.at(-1).type, 'error');
    assert.match(fixture.notifications.at(-1).message, /Pipeline 'graph-process' requires a clean target worktree before starting/);
    assert.match(fixture.notifications.at(-1).message, /\.pi\/sandcastle\/config\.yaml/);
    await assert.rejects(readProcessRecord(fixture.repoRoot), /missing work process record/);
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
    const finalizePrompts = [];
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
          run: async (options) => {
            if (options.logging.path.includes('reviewer')) return { iterations: [], commits: [], branch: 'sandcastle/explicit-close', stdout: 'Review result: ACCEPT', logFilePath: options.logging.path };
            if (options.prompt.includes('Prepare work for close')) finalizePrompts.push(options.prompt);
            return { iterations: [], commits: [{ sha: 'sha-1' }], branch: 'sandcastle/explicit-close', stdout: '', logFilePath: options.logging.path };
          },
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
    assert.deepEqual(finalizePrompts, []);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), ['wi-1:close:succeeded']);
    assert.equal(notifications.at(-1).type, 'success');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('/work:process runs configured work.close command inside item worktree for finalizer retries', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-close-command-cwd-'));
  const worktreePath = path.join(repoRoot, '.pi/sandcastle/worktrees/command-cwd');
  const closeScript = path.join(repoRoot, 'close.mjs');
  try {
    await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
    await fs.mkdir(path.join(worktreePath, 'backlog'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'backlog'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'backlog/wi-1.md'), '---\nid: wi-1\nlinks:\n  evidence: []\n---\n', 'utf8');
    await fs.writeFile(path.join(worktreePath, 'backlog/wi-1.md'), '---\nid: wi-1\nlinks:\n  evidence: []\n---\n', 'utf8');
    await fs.writeFile(closeScript, [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "const text = fs.readFileSync(path.join(process.cwd(), 'backlog/wi-1.md'), 'utf8');",
      "if (!/actual: 1/.test(text) || !/evidence:\\n    - validation passed/.test(text)) {",
      "  console.error('WORK_UPDATE_CLOSED_METADATA_REQUIRED: Closing work with --status closed requires terminal metadata before mutation: provide --actual or existing actual, and at least one links.evidence entry.');",
      "  process.exit(1);",
      "}",
      "console.log('closed');",
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), [
      'defaultPipeline: graph-close',
      'defaultSandbox: no-sandbox',
      'defaultModel: test-model',
      'workSourceCommands:',
      `  close: node ${JSON.stringify(closeScript)} --item {{ itemId }}`,
      'roles:',
      '  implementer:',
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
      '          close:',
      '            kind: work.close',
      '            needs: [implement]',
      '            maxIterations: 2',
      '            finalize:',
      '              role: implementer',
      '              promptOverride: Prepare close metadata.',
      '      merge:',
      '        kind: git.merge',
      '        needs: [work]',
    ].join('\n'), 'utf8');

    const commands = new Map();
    const finalizePrompts = [];
    let planCalls = 0;
    let gitHead = 'base';
    agentWorkflows({ registerCommand(name, spec) { commands.set(name, spec); }, on() {}, registerTool() {} }, {
      work: {
        now: () => 1710000260000,
        plan: async (_cwd, query) => {
          planCalls += 1;
          return planCalls === 1 ? { query, iterations: [{ items: [{ id: 'wi-1', title: 'First item', tags: [] }] }] } : { query, iterations: [] };
        },
      },
      pipeline: {
        now: () => 1700000026000,
        createWorktree: async () => ({
          branch: 'sandcastle/command-cwd',
          worktreePath,
          close: async () => ({}),
          run: async (options) => {
            if (options.prompt.includes('Prepare close metadata')) {
              finalizePrompts.push(options.prompt);
              await fs.writeFile(path.join(worktreePath, 'backlog/wi-1.md'), '---\nid: wi-1\nactual: 1\nlinks:\n  evidence:\n    - validation passed\n---\n', 'utf8');
            }
            return { iterations: [], commits: [{ sha: `sha-${finalizePrompts.length + 1}` }], branch: 'sandcastle/command-cwd', stdout: 'ACCEPT', logFilePath: options.logging.path };
          },
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
    assert.equal(finalizePrompts.length, 1);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), ['wi-1:close:succeeded']);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('/work:process repeats close and finalization up to work.close maxIterations', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-finalize-close-'));
  const worktreePath = path.join(repoRoot, '.pi/sandcastle/worktrees/finalize-close');
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
      '          close:',
      '            kind: work.close',
      '            needs: [implement]',
      '            when: needs.implement.accepted == true',
      '            maxIterations: 3',
      '            finalize:',
      '              role: implementer',
      '              promptOverride: Prepare work for close using the provider-reported missing requirements.',
      '      merge:',
      '        kind: git.merge',
      '        needs: [work]',
      '        when: has(needs.work.children.close.closed) && needs.work.children.close.closed == true',
    ].join('\n'), 'utf8');

    const commands = new Map();
    const mutations = [];
    const finalizePrompts = [];
    let planCalls = 0;
    let closeAttempts = 0;
    let gitHead = 'base';
    agentWorkflows({ registerCommand(name, spec) { commands.set(name, spec); }, on() {}, registerTool() {} }, {
      work: {
        now: () => 1710000250000,
        plan: async (_cwd, query) => {
          planCalls += 1;
          return planCalls === 1 ? { query, iterations: [{ items: [{ id: 'wi-1', title: 'First item', tags: [] }] }] } : { query, iterations: [] };
        },
        workSourceAdapter: {
          close: async ({ itemId, cwd }) => {
            closeAttempts += 1;
            mutations.push(`close:${itemId}:${cwd === worktreePath}:attempt-${closeAttempts}`);
            if (closeAttempts === 1) throw new Error('provider refused close because terminal metadata is missing');
            if (closeAttempts === 2) throw new Error('provider refused close because completion criteria are unchecked');
            return { status: 0, stdout: 'closed', stderr: '', command: `close ${itemId}` };
          },
        },
      },
      pipeline: {
        now: () => 1700000025000,
        createWorktree: async () => ({
          branch: 'sandcastle/finalize-close',
          worktreePath,
          close: async () => ({}),
          run: async (options) => {
            if (options.prompt.includes('Prepare work for close')) finalizePrompts.push(options.prompt);
            return { iterations: [], commits: [{ sha: `sha-${finalizePrompts.length + 1}` }], branch: 'sandcastle/finalize-close', stdout: 'ACCEPT', logFilePath: options.logging.path };
          },
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
    assert.deepEqual(mutations, ['close:wi-1:true:attempt-1', 'close:wi-1:true:attempt-2', 'close:wi-1:true:attempt-3']);
    assert.equal(finalizePrompts.length, 2);
    assert.match(finalizePrompts[0], /terminal metadata is missing/);
    assert.match(finalizePrompts[1], /completion criteria are unchecked/);
    assert.match(finalizePrompts[0], /Work Item: wi-1/);
    assert.match(finalizePrompts[1], /Close node: root\.nodes\.work\.nodes\.close/);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), ['wi-1:close:succeeded']);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('custom Work Source commands can provide ready and close actions', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-custom-source-'));
  const worktreePath = path.join(repoRoot, '.pi/sandcastle/worktrees/custom-close');
  const statePath = path.join(repoRoot, 'custom-source-state.log');
  const commandPath = path.join(repoRoot, 'custom-source.mjs');
  try {
    await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(commandPath, [
      'import { appendFileSync } from "node:fs";',
      'const [action, statePath, id, flag, runId] = process.argv.slice(2);',
      'if (action === "ready") console.log("custom-ready-output");',
      'if (action === "close") appendFileSync(statePath, `${id}:${flag}:${runId}:${process.cwd()}\\n`);',
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), [
      'defaultPipeline: graph-close',
      'defaultSandbox: no-sandbox',
      'defaultModel: test-model',
      'workSource: custom',
      'workSourceCommands:',
      `  ready: node ${commandPath} ready ${statePath}`,
      `  close: node ${commandPath} close ${statePath} {{ itemId }} --run {{ runId }}`,
      'roles:',
      '  implementer:',
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
      '          close:',
      '            kind: work.close',
      '            needs: [implement]',
      '            when: needs.implement.accepted == true',
      '      merge:',
      '        kind: git.merge',
      '        needs: [work]',
      '        when: has(needs.work.children.close.closed) && needs.work.children.close.closed == true',
    ].join('\n'), 'utf8');

    const commands = new Map();
    const notifications = [];
    let planCalls = 0;
    let gitHead = 'base';
    agentWorkflows({ registerCommand(name, spec) { commands.set(name, spec); }, on() {}, registerTool() {} }, {
      work: {
        now: () => 1710000300000,
        plan: async (_cwd, query) => {
          planCalls += 1;
          return planCalls === 1 ? { query, iterations: [{ items: [{ id: 'wi-1', title: 'First item', tags: [] }] }] } : { query, iterations: [] };
        },
      },
      pipeline: {
        now: () => 1700000030000,
        createWorktree: async () => ({
          branch: 'sandcastle/custom-close',
          worktreePath,
          close: async () => ({}),
          run: async (options) => ({ iterations: [], commits: [{ sha: 'sha-1' }], branch: 'sandcastle/custom-close', stdout: 'ACCEPT', logFilePath: options.logging.path }),
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

    const ctx = { cwd: repoRoot, ui: { notify(message, type = 'info') { notifications.push({ message, type }); }, setWidget() {} } };
    await commands.get('work:ready').handler('', ctx);
    assert.equal(notifications.at(-1).message, 'custom-ready-output');

    await commands.get('work:process').handler('demo', ctx);
    const record = await readProcessRecord(repoRoot);
    assert.equal(record.status, 'done', notifications.at(-1)?.message);
    const state = await fs.readFile(statePath, 'utf8');
    assert.match(state, /^wi-1:--run:[a-z0-9-]+-graph-close:/);
    assert.match(state, /\.pi\/sandcastle\/worktrees\/custom-close\n$/);
    assert.deepEqual(record.workSourceMutations.map((entry) => `${entry.itemId}:${entry.action}:${entry.status}`), ['wi-1:close:succeeded']);
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
