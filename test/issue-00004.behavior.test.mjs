import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import agentWorkflows, { parseSimpleYaml } from '../extensions/agent-workflows/index.ts';

function createFakePi() {
  const commands = new Map();
  return {
    commands,
    on() {},
    registerCommand(name, spec) {
      commands.set(name, spec.handler);
    },
    registerTool() {},
  };
}

function createTempRepoConfig() {
  return [
        'defaultSandbox: docker',
    'defaultModel: claude-opus-4-8',
    '',
    'roles:',
    '  researcher:',
    '    description: Researcher',
    '    sandbox: docker',
    '    model: claude-opus-4-8',
    '    systemPrompt: Researcher system prompt.',
    '  builder:',
    '    description: Builder',
    '    sandbox: docker',
    '    model: claude-opus-4-8',
    '',
    '  default: [researcher, builder]',
    '',
    'chains:',
    '',
    'pipelines:',
    '  implement:',
    '    description: Fixed-domain implementation pipeline.',
    '    branchStrategy:',
    '      type: branch',
    '      branch: sandcastle/implement',
    '    sandbox: docker',
    '    model: claude-opus-4-8',
    '    steps:',
    '      - role: researcher',
    '        prompt: |',
    '          Research the requested work and identify the relevant files.',
    '          $INPUT',
    '      - role: builder',
    '        prompt: |',
    '          Implement the requested work.',
    '          Original request: $ORIGINAL',
    '          Research: $INPUT',
    '',
    '  broken:',
    '    description: Pipeline that fails on the first step.',
    '    branchStrategy:',
    '      type: branch',
    '      branch: sandcastle/broken',
    '    sandbox: docker',
    '    steps:',
    '      - role: researcher',
    '        prompt: |',
    '          Trigger a failure.',
  ].join('\n');
}

async function createRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle/config.yaml'), createTempRepoConfig(), 'utf8');
  return repoRoot;
}

test('parseSimpleYaml keeps chain and pipeline step indentation rules aligned with the sample config', () => {
  const parsed = parseSimpleYaml([
    'chains:',
    '  review-flow:',
    '    - role: reviewer',
    '      prompt: |',
    '        Review the branch.',
    '        $INPUT',
    '',
    'pipelines:',
    '  implement:',
    '    branchStrategy:',
    '      type: branch',
    '      branch: sandcastle/implement',
    '    steps:',
    '      - role: builder',
    '        prompt: |',
    '          Implement the requested work.',
    '          $INPUT',
  ].join('\n'));

  assert.equal(parsed.chains['review-flow'].length, 1);
  assert.equal(parsed.chains['review-flow'][0].role, 'reviewer');
  assert.match(parsed.chains['review-flow'][0].prompt, /Review the branch\.\n\$INPUT/);
  assert.equal(parsed.pipelines.implement.steps.length, 1);
  assert.equal(parsed.pipelines.implement.branchStrategy.branch, 'sandcastle/implement');
  assert.match(parsed.pipelines.implement.steps[0].prompt, /Implement the requested work\.\n\$INPUT/);
});

test('parseSimpleYaml preserves unsupported pipeline step keys for validation', () => {
  const parsed = parseSimpleYaml([
    'roles:',
    '  worker:',
    '    description: Worker',
    '    systemPrompt: Worker system prompt.',
    '',
    'pipelines:',
    '  simple-loop:',
    '    steps:',
    '      - agent: worker',
    '        prompt: do work',
  ].join('\n'));

  assert.equal(parsed.agents.worker.systemPrompt, 'Worker system prompt.');
  assert.equal(parsed.pipelines['simple-loop'].steps[0].agent, 'worker');
  assert.equal(parsed.pipelines['simple-loop'].steps[0].role, '');
});

test('/work:config-raw validate rejects agent terminology where role is required', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-agent-term-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'agents:',
    '  worker:',
    '    description: Worker',
    '',
    'roles:',
    '  reviewer:',
    '    description: Reviewer',
    '',
    'pipelines:',
    '  simple-loop:',
    '    steps:',
    '      - agent: worker',
    '        prompt: do work',
  ].join('\n'), 'utf8');

  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];
  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /config\.agents is not supported/);
  assert.match(notifications[0].message, /config\.pipelines\.simple-loop\.steps\[0\]\.agent is not supported/);
});

test('/work:pipeline registers and parses prompt text deterministically', async () => {
  const repoRoot = await createRepo();
  const fakePi = createFakePi();
  const calls = [];
  const notifications = [];

  agentWorkflows(fakePi, {
    pipeline: {
      now: () => 1700000000000,
      createWorktree: async () => ({
        branch: 'sandcastle/implement',
        worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees/implement'),
        close: async () => ({}),
        run: async (options) => {
          calls.push(options);
          return {
            iterations: [],
            commits: [{ sha: `commit-${calls.length}` }],
            branch: 'sandcastle/implement',
            stdout: '',
            logFilePath: options.logging.path,
          };
        },
      }),
      loadSandboxProvider: async (kind) => ({ kind }),
      claudeCode: (model) => ({ model }),
    },
  });

  assert.ok(fakePi.commands.has('work:pipeline'), '/work:pipeline command should be registered');

  const handler = fakePi.commands.get('work:pipeline');
  const ctx = {
    cwd: repoRoot,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  };

  await handler('implement finish docs steps: should stay prompt text', ctx);

  assert.equal(calls.length, 2);
  assert.match(calls[0].prompt, /Researcher system prompt/);
  assert.match(calls[0].prompt, /finish docs steps: should stay prompt text/);
  assert.equal(calls[0].sandbox.kind, 'docker');
  assert.equal(calls[0].agent.model, 'claude-opus-4-8');
  assert.match(notifications.at(-1).message, /Pipeline implement completed/);

  const runId = `${(1700000000000).toString(36)}-implement`;
  const recordPath = path.join(
    repoRoot,
    '.pi/sandcastle/runs',
    runId,
    'record.json',
  );
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.pipeline, 'implement');
  assert.equal(record.status, 'completed');
  assert.equal(record.steps.length, 2);
  assert.equal(record.steps[0].status, 'completed');
  assert.equal(record.steps[1].status, 'completed');
  assert.equal(record.steps[0].commits[0], 'commit-1');
  assert.equal(record.steps[1].commits[0], 'commit-2');
});

test('/work:pipeline rejects unknown pipelines with available options', async () => {
  const repoRoot = await createRepo();
  const fakePi = createFakePi();
  const notifications = [];
  let createWorktreeCalls = 0;

  agentWorkflows(fakePi, {
    pipeline: {
      createWorktree: async () => {
        createWorktreeCalls += 1;
        throw new Error('should not be called');
      },
      loadSandboxProvider: async () => ({ kind: 'docker' }),
      claudeCode: (model) => ({ model }),
    },
  });

  const handler = fakePi.commands.get('work:pipeline');
  await handler('missing anything at all', {
    cwd: repoRoot,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  });

  assert.equal(createWorktreeCalls, 0);
  assert.match(notifications.at(-1).message, /Unknown pipeline 'missing'/);
  assert.match(notifications.at(-1).message, /Available pipelines: .*broken.*implement/);
});

test('/work:pipeline records failed steps and stops after the first error', async () => {
  const repoRoot = await createRepo();
  const fakePi = createFakePi();
  const notifications = [];
  let runCalls = 0;

  agentWorkflows(fakePi, {
    pipeline: {
      now: () => 1700000001000,
      createWorktree: async () => ({
        branch: 'sandcastle/broken',
        worktreePath: path.join(repoRoot, '.pi/sandcastle/worktrees/broken'),
        close: async () => ({}),
        run: async () => {
          runCalls += 1;
          throw new Error('step exploded');
        },
      }),
      loadSandboxProvider: async () => ({ kind: 'docker' }),
      claudeCode: (model) => ({ model }),
    },
  });

  const handler = fakePi.commands.get('work:pipeline');
  await handler('broken recover from failure', {
    cwd: repoRoot,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  });

  assert.equal(runCalls, 1);
  assert.match(notifications.at(-1).message, /step exploded/);

  const runId = `${(1700000001000).toString(36)}-broken`;
  const recordPath = path.join(
    repoRoot,
    '.pi/sandcastle/runs',
    runId,
    'record.json',
  );
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.pipeline, 'broken');
  assert.equal(record.status, 'failed');
  assert.equal(record.steps.length, 1);
  assert.equal(record.steps[0].status, 'failed');
  assert.match(record.steps[0].error, /step exploded/);
  assert.match(record.error, /step exploded/);
});
