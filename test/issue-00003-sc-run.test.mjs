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
