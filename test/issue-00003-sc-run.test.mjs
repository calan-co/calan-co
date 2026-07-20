import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import agentWorkflows from '../extensions/agent-workflows/index.ts';

function makeFakeExtensionAPI() {
  const commands = new Map();
  return {
    commands,
    on() {},
    registerCommand(name, config) {
      commands.set(name, config);
    },
    registerTool() {},
  };
}

test('/work:run honors explicit role provider even when it differs from defaultAgent', async () => {
  const repoDir = await mkdtemp(join(tmpdir(), 'agent-workflows-sc-run-explicit-provider-'));
  try {
    const configDir = join(repoDir, '.pi', 'sandcastle');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.yaml'),
      [
        'defaultAgent: pi',
        'defaultModel: Agent Default',
        'roles:',
        '  planner:',
        '    kind: planWork',
        '    provider: claude-code',
        '    model: Agent Default',
        '    sandbox: no-sandbox',
        '',
      ].join('\n'),
    );

    const calls = [];
    const sandcastle = {
      makeAgent(model, provider) {
        calls.push({ type: 'makeAgent', model, provider });
        return { model, provider };
      },
      makeSandbox(kind) { return { kind }; },
      async run() { return { iterations: [], stdout: '', commits: [], branch: 'feature/sc-run' }; },
    };
    const fakePi = makeFakeExtensionAPI();
    agentWorkflows(fakePi, { sandcastle, now: () => 1700000000000, randomId: () => 'run-explicit-provider' });

    await fakePi.commands.get('work:run').handler('planner Create a plan', {
      cwd: repoDir,
      ui: { notify() {}, setWidget() {} },
    });

    assert.deepEqual(calls[0], { type: 'makeAgent', model: 'claude-opus-4-8', provider: 'claude-code' });
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('/work:run uses host Pi provider defaults when configured for the pi provider', async () => {
  const repoDir = await mkdtemp(join(tmpdir(), 'agent-workflows-sc-run-pi-provider-'));
  const hostPiDir = await mkdtemp(join(tmpdir(), 'agent-workflows-sc-run-host-pi-'));
  const previousHostPiDir = process.env.PI_HOST_AGENT_DIR;
  try {
    const configDir = join(repoDir, '.pi', 'sandcastle');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(hostPiDir, 'settings.json'), JSON.stringify({ defaultProvider: 'azure-openai-responses', defaultModel: 'host-pi-model' }), 'utf8');
    process.env.PI_HOST_AGENT_DIR = hostPiDir;
    await writeFile(
      join(configDir, 'config.yaml'),
      [
        'defaultAgent: pi',
        'defaultModel: Agent Default',
        'roles:',
        '  worker:',
        '    provider: pi',
        '    model: Agent Default',
        '    sandbox: no-sandbox',
        '',
      ].join('\n'),
    );

    const calls = [];
    const sandcastle = {
      makeAgent() { throw new Error('pi provider should use shared host Pi agent factory'); },
      makeSandbox() { throw new Error('pi provider should use shared host Pi sandbox setup'); },
      async run(options) {
        calls.push(options.agent.buildPrintCommand({ prompt: options.prompt }).command);
        return { iterations: [], stdout: '', commits: [], branch: 'feature/sc-run-pi', logFilePath: options.logging.path };
      },
    };
    const fakePi = makeFakeExtensionAPI();
    agentWorkflows(fakePi, { sandcastle, now: () => 1700000000000, randomId: () => 'run-pi-provider' });

    await fakePi.commands.get('work:run').handler('worker Use host pi', {
      cwd: repoDir,
      ui: { notify() {}, setWidget() {} },
    });

    assert.match(calls[0], /pi -p --mode json --no-session/);
    assert.match(calls[0], /--provider 'azure-openai-responses'/);
    assert.match(calls[0], /--model 'host-pi-model'/);
  } finally {
    if (previousHostPiDir === undefined) delete process.env.PI_HOST_AGENT_DIR;
    else process.env.PI_HOST_AGENT_DIR = previousHostPiDir;
    await rm(repoDir, { recursive: true, force: true });
    await rm(hostPiDir, { recursive: true, force: true });
  }
});

test('issue 00003 registers /work:run and uses the injected Sandcastle capability', async () => {
  const repoDir = await mkdtemp(join(tmpdir(), 'agent-workflows-sc-run-'));
  try {
    const configDir = join(repoDir, '.pi', 'sandcastle');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.yaml'),
      [
        'roles:',
        '  reviewer:',
        '    model: claude-opus-4-8',
        '    sandbox: no-sandbox',
        '',
      ].join('\n'),
    );

    const calls = [];
    const notifications = [];
    const sandcastle = {
      makeAgent(model) {
        calls.push({ type: 'makeAgent', model });
        return { model };
      },
      makeSandbox(kind) {
        calls.push({ type: 'makeSandbox', kind });
        return { kind };
      },
      async run(options) {
        calls.push({
          type: 'run',
          options: {
            agent: options.role,
            sandbox: options.sandbox,
            cwd: options.cwd,
            prompt: options.prompt,
            maxIterations: options.maxIterations,
            name: options.name,
            logging: options.logging,
            branchStrategy: options.branchStrategy,
          },
        });

        return {
          iterations: [],
          stdout: '',
          commits: [{ sha: 'abc123' }],
          branch: 'feature/sc-run',
          logFilePath: join(repoDir, '.pi', 'sandcastle', 'logs', 'run-123.log'),
        };
      },
      async createSandbox() {
        throw new Error('createSandbox should not be called by /work:run');
      },
    };
    const fakePi = makeFakeExtensionAPI();

    agentWorkflows(fakePi, {
      sandcastle,
      now: () => 1700000000000,
      randomId: () => 'run-123',
    });

    assert.ok(fakePi.commands.has('work:run'), '/work:run should be registered');

    const handler = fakePi.commands.get('work:run').handler;
    await handler('Check the docs --not-a-flag', {
      cwd: repoDir,
      ui: {
        notify(message, type) {
          notifications.push({ message, type });
        },
        setWidget() {},
      },
    });

    assert.deepEqual(
      calls.map((entry) => entry.type),
      ['makeAgent', 'makeSandbox', 'run'],
      'the handler should resolve Sandcastle dependencies through the injected capability',
    );
    assert.deepEqual(calls[0], { type: 'makeAgent', model: 'claude-opus-4-8' });
    assert.deepEqual(calls[1], { type: 'makeSandbox', kind: 'no-sandbox' });
    assert.equal(calls[2].options.prompt, 'Check the docs --not-a-flag');
    assert.equal(calls[2].options.cwd, repoDir);
    assert.equal(calls[2].options.maxIterations, 1);
    assert.equal(calls[2].options.name, 'backlog-run:run-123');
    assert.equal(calls[2].options.logging.path, join(repoDir, '.pi', 'sandcastle', 'logs', 'run-123.log'));
    assert.equal(calls[2].options.branchStrategy, undefined);

    const recordPath = join(repoDir, '.pi', 'sandcastle', 'runs', 'run-123.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    assert.deepEqual(record, {
      id: 'run-123',
      kind: 'direct-role',
      agent: 'reviewer',
      prompt: 'Check the docs --not-a-flag',
      promptSummary: 'Check the docs --not-a-flag',
      status: 'completed',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      startedAt: 1700000000000,
      finishedAt: 1700000000000,
      branch: 'feature/sc-run',
      commits: ['abc123'],
      logPath: join(repoDir, '.pi', 'sandcastle', 'logs', 'run-123.log'),
    });

    assert.deepEqual(notifications, [
      {
        message:
          'Run run-123 completed: agent reviewer; branch feature/sc-run; commits abc123; log ' +
          join(repoDir, '.pi', 'sandcastle', 'logs', 'run-123.log'),
        type: 'success',
      },
    ]);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});
