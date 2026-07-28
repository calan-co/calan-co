import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { executePipeline } from '../extensions/agent-workflows/index.ts';
import { configToYaml, packsToConfig } from '../extensions/agent-workflows/pipeline-packs.mjs';

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  const result = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Agent Workflows Test',
      GIT_AUTHOR_EMAIL: 'agent-workflows@example.test',
      GIT_COMMITTER_NAME: 'Agent Workflows Test',
      GIT_COMMITTER_EMAIL: 'agent-workflows@example.test',
    },
  });
  return result.stdout.trim();
}

async function initGitRepo(repoRoot) {
  await runGit(repoRoot, ['init', '-b', 'main']);
  await runGit(repoRoot, ['config', 'user.name', 'Agent Workflows Test']);
  await runGit(repoRoot, ['config', 'user.email', 'agent-workflows@example.test']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), 'base\n', 'utf8');
  await runGit(repoRoot, ['add', 'README.md']);
  await runGit(repoRoot, ['commit', '-m', 'initial commit']);
}

async function createGraphRepo(configLines, { git = false } = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-graph-runtime-'));
  if (git) await initGitRepo(repoRoot);
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), configLines.join('\n'), 'utf8');
  return repoRoot;
}

function baseGraphConfig(extraPipelineLines) {
  return [
    'defaultAgent: claude-code',
    'defaultSandbox: no-sandbox',
    'defaultModel: claude-opus-4-8',
    'roles:',
    '  implementer:',
    '    provider: claude-code',
    '    sandbox: no-sandbox',
    '    model: claude-opus-4-8',
    '    systemPrompt: Implementer system prompt.',
    '  reviewer:',
    '    provider: claude-code',
    '    sandbox: no-sandbox',
    '    model: claude-opus-4-8',
    'pipelines:',
    ...extraPipelineLines,
  ];
}

function fakeWorktree(repoRoot, runImpl, options = {}) {
  return {
    branch: options.branch || 'sandcastle/graph',
    worktreePath: options.worktreePath || path.join(repoRoot, '.pi/sandcastle/worktrees/graph'),
    close: async () => ({}),
    run: runImpl,
  };
}

function fakeSuccessfulGit() {
  let head = 'base-head';
  let merges = 0;
  return async (args) => {
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'sandcastle/graph\n', stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${head}\n`, stderr: '' };
    if (args[0] === 'merge') {
      merges += 1;
      head = `merge-head-${merges}`;
      return { status: 0, stdout: `Merged ${args.at(-1)}\n`, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('executePipeline uses graph executor for generated default runtime config', async () => {
  const repoRoot = await createGraphRepo(configToYaml(packsToConfig()).split('\n'));
  const calls = [];

  const record = await executePipeline(repoRoot, 'simple-loop', 'finish default graph work', {
    now: () => 1700000003000,
    createWorktree: async () => fakeWorktree(repoRoot, async (options) => {
      calls.push(options.prompt);
      return {
        iterations: [],
        commits: [{ sha: 'commit-default' }],
        branch: 'sandcastle/simple-loop',
        stdout: '',
        logFilePath: options.logging.path,
      };
    }),
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
  });

  assert.equal(record.status, 'completed');
  assert.equal(record.executor, 'graph');
  assert.equal(record.nodes.find((node) => node.nodePath === 'root.nodes.workspace').resultType, 'WorkspaceResult');
  assert.deepEqual(record.steps.map((step) => step.role), ['worker']);
  assert.match(calls[0], /Pick the next open Work Item/);
});

test('executePipeline rejects pipeline config that fails current graph schema', async () => {
  const repoRoot = await createGraphRepo([
    'defaultAgent: pi',
    'defaultSandbox: no-sandbox',
    'defaultModel: Agent Default',
    'pipelines:',
    '  parallel-planner-with-review:',
    '    branchStrategy:',
    '      type: branch',
    '      branch: sandcastle/parallel-planner-with-review',
    '    steps:',
    '      - kind: runRole',
    '        role: planner',
    '        prompt: plan-work',
    '        maxIterations: 1',
    '      - kind: runRole',
    '        role: implementer',
    '        prompt: implement-work',
    '      - kind: review',
    '        role: reviewer',
    '        prompt: review-work',
    '      - kind: merge',
    '        role: merger',
    '        prompt: merge-work',
    '        maxIterations: 1',
  ]);

  await assert.rejects(
    executePipeline(repoRoot, 'parallel-planner-with-review', 'process stale defaults', {
      now: () => 1700000003500,
      createWorktree: async () => { throw new Error('must not create worktree for invalid config'); },
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /Invalid Agent Workflows configuration[\s\S]*config\.pipelines\.parallel-planner-with-review\.kind is required[\s\S]*config\.pipelines\.parallel-planner-with-review\.nodes is required[\s\S]*config\.pipelines\.parallel-planner-with-review\.steps is not supported/,
  );
});

test('executePipeline runs composite graph nodes by needs and records graph node summaries', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    branchStrategy:',
    '      type: branch',
    '      branch: sandcastle/graph',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          review:',
    '            kind: agent.pi',
    '            needs: [implement]',
    '            role: reviewer',
    '            prompt: Review $INPUT',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [workspace]',
  ]));
  const calls = [];

  const record = await executePipeline(repoRoot, 'graph', 'finish graph work', {
    now: () => 1700000004000,
    createWorktree: async () => fakeWorktree(repoRoot, async (options) => {
      calls.push(options.prompt);
      return {
        iterations: [],
        commits: [{ sha: `commit-${calls.length}` }],
        branch: 'sandcastle/graph',
        stdout: '',
        logFilePath: options.logging.path,
      };
    }),
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
    runGit: fakeSuccessfulGit(),
  });

  assert.deepEqual(calls.map((prompt) => prompt.match(/(Implement|Review)/)?.[1]), ['Implement', 'Review']);
  assert.equal(record.status, 'completed');
  assert.equal(record.executor, 'graph');
  assert.deepEqual(record.steps.map((step) => step.role), ['implementer', 'reviewer']);
  assert.deepEqual(record.steps.map((step) => step.status), ['completed', 'completed']);
  assert.ok(record.nodes.some((node) => node.nodePath === 'root.nodes.workspace' && node.resultType === 'WorkspaceResult'));
  assert.ok(record.nodes.some((node) => node.nodePath === 'root.nodes.merge' && node.resultType === 'GitMergeResult'));

  const runId = `${(1700000004000).toString(36)}-graph`;
  const durable = JSON.parse(await fs.readFile(path.join(repoRoot, '.pi/sandcastle/runs', runId, 'record.json'), 'utf8'));
  assert.equal(durable.executor, 'graph');
  assert.equal(durable.nodes.find((node) => node.nodePath === 'root.nodes.merge').status, 'completed');
});

test('executePipeline creates one graph worktree per process lane and runs agents in matching worktrees', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  laneGraph:',
    '    kind: composite',
    '    nodes:',
    '      lanes:',
    '        kind: loop',
    '        mode: parallel',
    '        each: $.executionContexts',
    '        nodes:',
    '          workspace:',
    '            kind: git.worktree',
    '            nodes:',
    '              implement:',
    '                kind: agent.pi',
    '                role: implementer',
    '                prompt: Implement $INPUT',
  ]));
  const createCalls = [];
  const runCalls = [];
  const closeCalls = [];
  const contexts = [
    { contextId: 'run/item-a/0-0', branch: 'agent-workflows/lane-graph/run/item-a', groupIndex: 0, itemIndex: 0, itemId: 'item-a' },
    { contextId: 'run/item-b/0-1', branch: 'agent-workflows/lane-graph/run/item-b', groupIndex: 0, itemIndex: 1, itemId: 'item-b' },
  ];

  const record = await executePipeline(repoRoot, 'laneGraph', 'process lanes', {
    now: () => 1700000007000,
    graphInput: { prompt: 'process lanes', executionContexts: contexts },
    createWorktree: async (options) => {
      const branch = options.branchStrategy.branch;
      const worktreePath = path.join(repoRoot, '.pi/sandcastle/worktrees', branch.replaceAll('/', '-'));
      createCalls.push({ branch, worktreePath });
      return {
        branch,
        worktreePath,
        close: async () => { closeCalls.push(branch); },
        run: async (runOptions) => {
          runCalls.push({ branch, worktreePath, prompt: runOptions.prompt });
          return {
            iterations: [],
            commits: [{ sha: `commit-${branch.split('/').at(-1)}` }],
            branch,
            stdout: '',
            logFilePath: runOptions.logging.path,
          };
        },
      };
    },
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
  });

  assert.equal(record.status, 'completed');
  assert.equal(record.executor, 'graph');
  assert.deepEqual(createCalls.map((call) => call.branch).sort(), contexts.map((context) => context.branch).sort());
  assert.deepEqual(closeCalls.sort(), contexts.map((context) => context.branch).sort());
  assert.deepEqual(runCalls.map((call) => call.branch).sort(), contexts.map((context) => context.branch).sort());
  for (const context of contexts) {
    const run = runCalls.find((call) => call.branch === context.branch);
    assert.ok(run, `missing run for ${context.branch}`);
    assert.match(run.prompt, new RegExp(`Branch: ${context.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  const workspaceRecords = record.nodes.filter((node) => node.resultType === 'WorkspaceResult');
  assert.deepEqual(workspaceRecords.map((node) => node.branch).sort(), contexts.map((context) => context.branch).sort());
  assert.deepEqual(workspaceRecords.map((node) => node.itemId).sort(), ['item-a', 'item-b']);
});

test('executePipeline closes graph lane worktree when a child agent fails', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  laneGraph:',
    '    kind: composite',
    '    nodes:',
    '      lanes:',
    '        kind: loop',
    '        each: $.executionContexts',
    '        nodes:',
    '          workspace:',
    '            kind: git.worktree',
    '            nodes:',
    '              implement:',
    '                kind: agent.pi',
    '                role: implementer',
    '                prompt: Implement $INPUT',
  ]));
  const closeCalls = [];
  const contexts = [
    { contextId: 'run/item-a/0-0', branch: 'agent-workflows/lane-graph/run/item-a', groupIndex: 0, itemIndex: 0, itemId: 'item-a' },
  ];

  await assert.rejects(
    executePipeline(repoRoot, 'laneGraph', 'process lane failure', {
      now: () => 1700000008000,
      graphInput: { prompt: 'process lane failure', executionContexts: contexts },
      createWorktree: async (options) => {
        const branch = options.branchStrategy.branch;
        return {
          branch,
          worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees/failing'),
          close: async () => { closeCalls.push(branch); },
          run: async () => { throw new Error('agent failed in lane'); },
        };
      },
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /agent failed in lane/,
  );

  assert.deepEqual(closeCalls, [contexts[0].branch]);
  const runId = `${(1700000008000).toString(36)}-laneGraph`;
  const durable = JSON.parse(await fs.readFile(path.join(repoRoot, '.pi/sandcastle/runs', runId, 'record.json'), 'utf8'));
  assert.equal(durable.status, 'failed');
  assert.match(durable.error, /agent failed in lane/);
});

test('executePipeline graph git.merge accepted-only merges only review-approved branches', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      implement:',
    '        kind: loop',
    '        mode: parallel',
    '        each: $.executionContexts',
    '        node:',
    '          kind: git.worktree',
    '          nodes:',
    '            implement:',
    '              kind: agent.pi',
    '              role: implementer',
    '              prompt: Implement $INPUT',
    '      review:',
    '        kind: loop',
    '        mode: parallel',
    '        each: $.executionContexts',
    '        needs: [implement]',
    '        node:',
    '          kind: git.worktree',
    '          nodes:',
    '            review:',
    '              kind: agent.pi',
    '              role: reviewer',
    '              prompt: Review $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [implement, review]',
    '        inputs: [implement]',
    '        strategy: accepted-only',
  ]));
  const contexts = [
    { contextId: 'run/item-a/0-0', branch: 'feature/item-a', groupIndex: 0, itemIndex: 0, itemId: 'item-a' },
    { contextId: 'run/item-b/0-1', branch: 'feature/item-b', groupIndex: 0, itemIndex: 1, itemId: 'item-b' },
  ];
  const merged = [];
  let head = 'base-head';

  const record = await executePipeline(repoRoot, 'graph', 'review gated merge', {
    now: () => 1700000004400,
    graphInput: { prompt: 'review gated merge', executionContexts: contexts },
    createWorktree: async (options) => fakeWorktree(repoRoot, async (runOptions) => {
      const branch = options.branchStrategy.branch;
      const isReview = /Review/.test(runOptions.prompt);
      return {
        iterations: [],
        commits: isReview ? [] : [{ sha: `commit-${branch.split('/').at(-1)}` }],
        branch,
        stdout: isReview ? (branch.endsWith('item-a') ? 'Accepted: no blockers, safe to merge.' : 'Rejected: blocker found, do not merge.') : '',
        logFilePath: runOptions.logging.path,
      };
    }, { branch: options.branchStrategy.branch, worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees', options.branchStrategy.branch.replaceAll('/', '-')) }),
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
    runGit: async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${head}\n`, stderr: '' };
      if (args[0] === 'merge') {
        merged.push(args.at(-1));
        head = `merge-${merged.length}`;
        return { status: 0, stdout: 'merged\n', stderr: '' };
      }
      if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(record.status, 'completed');
  assert.deepEqual(merged, ['feature/item-a']);
  assert.deepEqual(record.nodes.find((node) => node.nodePath === 'root.nodes.merge').mergedBranches, ['feature/item-a']);
});

test('executePipeline graph git.merge merges accepted workspace branch content into the target worktree', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [workspace]',
  ]), { git: true });

  const record = await executePipeline(repoRoot, 'graph', 'merge feature branch', {
    now: () => 1700000004500,
    createWorktree: async () => fakeWorktree(repoRoot, async (options) => {
      await runGit(repoRoot, ['checkout', '-B', 'feature/accepted', 'main']);
      await fs.writeFile(path.join(repoRoot, 'feature.txt'), 'accepted branch content\n', 'utf8');
      await runGit(repoRoot, ['add', 'feature.txt']);
      await runGit(repoRoot, ['commit', '-m', 'add accepted feature']);
      const sha = await runGit(repoRoot, ['rev-parse', 'HEAD']);
      await runGit(repoRoot, ['checkout', 'main']);
      return {
        iterations: [],
        commits: [{ sha }],
        branch: 'feature/accepted',
        stdout: '',
        logFilePath: options.logging.path,
      };
    }, { branch: 'feature/accepted', worktreePath: repoRoot }),
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
  });

  assert.equal(record.status, 'completed');
  assert.equal(await fs.readFile(path.join(repoRoot, 'feature.txt'), 'utf8'), 'accepted branch content\n');
  const headParents = (await runGit(repoRoot, ['show', '--no-patch', '--pretty=%P', 'HEAD'])).split(/\s+/).filter(Boolean);
  assert.equal(headParents.length, 2, 'git.merge should create a merge commit on the target branch');
  const mergeNode = record.nodes.find((node) => node.nodePath === 'root.nodes.merge');
  assert.equal(mergeNode.branch, 'main');
  assert.deepEqual(mergeNode.mergedBranches, ['feature/accepted']);
  assert.ok(mergeNode.commits?.length >= 1);
  assert.ok(mergeNode.effects?.some((effect) => effect === 'merge:feature/accepted'));
});

test('executePipeline fails graph git.merge with no mergeable inputs', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      merge:',
    '        kind: git.merge',
  ]));

  await assert.rejects(
    executePipeline(repoRoot, 'graph', 'nothing to merge', {
      now: () => 1700000004700,
      createWorktree: async () => fakeWorktree(repoRoot, async () => ({ iterations: [], commits: [], branch: 'sandcastle/graph', stdout: '' })),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /requires mergeable needs/,
  );
});

test('executePipeline graph git.merge fails closed when an effectful input branch has no target merge effect', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [workspace]',
  ]), { git: true });
  const head = await runGit(repoRoot, ['rev-parse', 'HEAD']);
  await runGit(repoRoot, ['branch', 'feature/already-merged', 'HEAD']);

  await assert.rejects(
    executePipeline(repoRoot, 'graph', 'merge already merged branch', {
      now: () => 1700000004750,
      createWorktree: async () => fakeWorktree(repoRoot, async (options) => ({
        iterations: [],
        commits: [{ sha: head }],
        branch: 'feature/already-merged',
        stdout: '',
        logFilePath: options.logging.path,
      }), { branch: 'feature/already-merged', worktreePath: repoRoot }),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /completed without merge effects/,
  );
});

test('executePipeline graph git.merge fails closed on merge conflicts', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [workspace]',
  ]), { git: true });
  await fs.writeFile(path.join(repoRoot, 'conflict.txt'), 'base\n', 'utf8');
  await runGit(repoRoot, ['add', 'conflict.txt']);
  await runGit(repoRoot, ['commit', '-m', 'add conflict base']);
  await runGit(repoRoot, ['checkout', '-B', 'feature/conflict', 'main']);
  await fs.writeFile(path.join(repoRoot, 'conflict.txt'), 'feature\n', 'utf8');
  await runGit(repoRoot, ['commit', '-am', 'feature conflict change']);
  const featureSha = await runGit(repoRoot, ['rev-parse', 'HEAD']);
  await runGit(repoRoot, ['checkout', 'main']);
  await fs.writeFile(path.join(repoRoot, 'conflict.txt'), 'target\n', 'utf8');
  await runGit(repoRoot, ['commit', '-am', 'target conflict change']);

  await assert.rejects(
    executePipeline(repoRoot, 'graph', 'merge conflicting branch', {
      now: () => 1700000004800,
      createWorktree: async () => fakeWorktree(repoRoot, async (options) => ({
        iterations: [],
        commits: [{ sha: featureSha }],
        branch: 'feature/conflict',
        stdout: '',
        logFilePath: options.logging.path,
      }), { branch: 'feature/conflict', worktreePath: repoRoot }),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /failed to merge 'feature\/conflict'/,
  );

  assert.equal((await runGit(repoRoot, ['status', '--porcelain', 'conflict.txt'])), '');
  assert.equal(await fs.readFile(path.join(repoRoot, 'conflict.txt'), 'utf8'), 'target\n');
});

test('executePipeline fails graph git.merge when worktree children produce no commits but return a log path', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [workspace]',
  ]));

  await assert.rejects(
    executePipeline(repoRoot, 'graph', 'no-op work', {
      now: () => 1700000005000,
      createWorktree: async () => fakeWorktree(repoRoot, async (options) => ({
        iterations: [],
        commits: [],
        branch: 'sandcastle/graph',
        stdout: '',
        logFilePath: options.logging.path,
      })),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /requires effectful mergeable needs|no effects/,
  );

  const runId = `${(1700000005000).toString(36)}-graph`;
  const durable = JSON.parse(await fs.readFile(path.join(repoRoot, '.pi/sandcastle/runs', runId, 'record.json'), 'utf8'));
  assert.equal(durable.status, 'failed');
  assert.equal(durable.executor, 'graph');
  assert.match(durable.error, /requires effectful mergeable needs|no effects/);
});

test('executePipeline auto-commits dirty graph worktree changes before git.merge', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
    '      merge:',
    '        kind: git.merge',
    '        needs: [workspace]',
  ]), { git: true });
  const worktreePath = path.join(repoRoot, '.pi/sandcastle/worktrees/auto-commit');

  const record = await executePipeline(repoRoot, 'graph', 'dirty work', {
    now: () => 1700000005500,
    createWorktree: async (options) => {
      const branch = options.branchStrategy.branch || 'sandcastle/graph';
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      await runGit(repoRoot, ['worktree', 'add', '-B', branch, worktreePath, 'main']);
      return {
        branch,
        worktreePath,
        close: async () => { await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]); },
        run: async (runOptions) => {
          await fs.writeFile(path.join(worktreePath, 'dirty.txt'), 'auto committed\n', 'utf8');
          return {
            iterations: [],
            commits: [],
            branch,
            stdout: '',
            logFilePath: runOptions.logging.path,
          };
        },
      };
    },
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
  });

  assert.equal(record.status, 'completed');
  assert.equal(await fs.readFile(path.join(repoRoot, 'dirty.txt'), 'utf8'), 'auto committed\n');
  const workspaceNode = record.nodes.find((node) => node.nodePath === 'root.nodes.workspace');
  assert.ok(workspaceNode.commits?.length, 'dirty changes should be captured as a commit');
  assert.ok(record.nodes.find((node) => node.nodePath === 'root.nodes.merge')?.effects?.some((effect) => effect.startsWith('merge:')));
});

test('executePipeline fails graph completion when no node produced commits but returns a log path', async () => {
  const repoRoot = await createGraphRepo(baseGraphConfig([
    '  graph:',
    '    kind: composite',
    '    nodes:',
    '      workspace:',
    '        kind: git.worktree',
    '        nodes:',
    '          implement:',
    '            kind: agent.pi',
    '            role: implementer',
    '            prompt: Implement $INPUT',
  ]));

  await assert.rejects(
    executePipeline(repoRoot, 'graph', 'no-op work', {
      now: () => 1700000006000,
      createWorktree: async () => fakeWorktree(repoRoot, async (options) => ({
        iterations: [],
        commits: [],
        branch: 'sandcastle/graph',
        stdout: '',
        logFilePath: options.logging.path,
      })),
      loadSandboxProvider: async (kind) => ({ kind }),
      makeAgent: (model, provider) => ({ model, provider }),
    }),
    /Graph pipeline completed without effects/,
  );

  const runId = `${(1700000006000).toString(36)}-graph`;
  const durable = JSON.parse(await fs.readFile(path.join(repoRoot, '.pi/sandcastle/runs', runId, 'record.json'), 'utf8'));
  assert.equal(durable.status, 'failed');
  assert.equal(durable.executor, 'graph');
  assert.match(durable.error, /without effects/);
});

test('executePipeline discovers adapter graph hooks by capability and seeds hook namespaces', async () => {
  const repoRoot = await createGraphRepo(configToYaml(packsToConfig()).split('\n'));
  const seen = [];
  const skipped = [];
  const hooks = [
    {
      id: 'matching-sandcastle-hook',
      phase: 'beforeNode',
      capabilities: ['sandcastle'],
      run(context) {
        if (context.node.path === 'root.nodes.workspace.nodes.run') {
          seen.push({
            cwd: context.global.cwd,
            pipeline: context.runtime.pipeline,
            path: context.node.path,
            role: context.role.id,
            branchStrategy: context.git.branchStrategy.type,
            customGit: context.git.branchStrategyNote,
            workQuery: context.work.graphInput.query,
          });
        }
      },
    },
    {
      id: 'missing-capability-hook',
      phase: 'beforeNode',
      capabilities: ['not-present'],
      run() { skipped.push('ran'); },
    },
  ];

  const record = await executePipeline(repoRoot, 'simple-loop', 'hooked run', {
    now: () => 1700000003100,
    graphInput: { query: 'ready work' },
    graphHooks: hooks,
    graphHookCapabilities: ['sandcastle'],
    graphHookNamespaces: { git: { branchStrategyNote: 'seeded' } },
    createWorktree: async () => fakeWorktree(repoRoot, async (options) => ({
      iterations: [],
      commits: [{ sha: 'commit-hooked' }],
      branch: 'sandcastle/simple-loop',
      stdout: '',
      logFilePath: options.logging.path,
    })),
    loadSandboxProvider: async (kind) => ({ kind }),
    makeAgent: (model, provider) => ({ model, provider }),
  });

  assert.equal(record.status, 'completed');
  assert.equal(skipped.length, 0);
  assert.deepEqual(seen, [{
    cwd: repoRoot,
    pipeline: 'simple-loop',
    path: 'root.nodes.workspace.nodes.run',
    role: 'worker',
    branchStrategy: 'merge-to-head',
    customGit: 'seeded',
    workQuery: 'ready work',
  }]);
});
