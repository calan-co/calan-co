import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executePipeline } from '../extensions/agent-workflows/index.ts';

async function createGraphRepo(configLines) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-graph-runtime-'));
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

function fakeWorktree(repoRoot, runImpl) {
  return {
    branch: 'sandcastle/graph',
    worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees/graph'),
    close: async () => ({}),
    run: runImpl,
  };
}

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
