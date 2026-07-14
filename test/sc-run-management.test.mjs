import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createFileRunStore,
  createMemoryRunStore,
  createRunManagementService,
  registerRunManagementCommands,
} from '../extensions/pi-sandcastle/run-management.mjs';

function makeTempRepo() {
  return mkdtempSync(join(tmpdir(), 'pi-sandcastle-runs-'));
}

function fakePi() {
  const commands = new Map();
  return {
    commands,
    registerCommand(name, spec) {
      commands.set(name, spec);
    },
  };
}

test('registerRunManagementCommands registers the /work:* run management surface', () => {
  const pi = fakePi();

  registerRunManagementCommands(pi);

  assert.deepEqual([...pi.commands.keys()].sort(), [
    'work:cancel',
    'work:logs',
    'work:resume',
    'work:runs',
    'work:status',
  ]);
});

test('piSandcastle registers only the updated /work:* and /work:* slash-command surface on reload', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
        import piSandcastle from './extensions/pi-sandcastle/index.ts';
        const commands = [];
        const pi = {
          on() {},
          registerCommand(name) { commands.push(name); },
          registerTool() {},
        };
        piSandcastle(pi);
        console.log(JSON.stringify(commands.sort()));
      `,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  const commands = JSON.parse(output.trim());
  assert.deepEqual(commands, [
    'work:build-image',
    'work:cancel',
    'work:config',
    'work:config-raw',
    'work:inspect',
    'work:list',
    'work:logs',
    'work:next',
    'work:pipeline',
    'work:plan',
    'work:process',
    'work:ready',
    'work:resume',
    'work:run',
    'work:runs',
    'work:status',
  ]);
  assert.deepEqual(commands.filter((name) => name.startsWith('sc:')), []);
  assert.deepEqual(commands.filter((name) => !name.startsWith('work:')), []);
});

test('sc run management lists recent runs and infers active status safely', async () => {
  const cwd = makeTempRepo();
  const store = createFileRunStore();
  await store.writeRun(cwd, {
    id: 'run-completed',
    repoRoot: cwd,
    agent: 'builder',
    status: 'completed',
    startedAt: 10,
    updatedAt: 20,
    logPath: join(cwd, 'logs', 'completed.log'),
  });
  await store.writeRun(cwd, {
    id: 'run-active',
    repoRoot: cwd,
    agent: 'reviewer',
    status: 'running',
    startedAt: 30,
    updatedAt: 40,
    logPath: join(cwd, 'logs', 'active.log'),
  });
  mkdirSync(join(cwd, 'logs'), { recursive: true });
  writeFileSync(join(cwd, 'logs', 'active.log'), 'active');

  const service = createRunManagementService({ store });
  const listed = await service.list(cwd);
  assert.match(listed.message, /Sandcastle runs \(2\)/);
  assert.ok(listed.message.indexOf('run-active') < listed.message.indexOf('run-completed'));

  const selected = await service.status(cwd);
  assert.equal(selected.run.id, 'run-active');

  await store.writeRun(cwd, {
    id: 'run-second-active',
    repoRoot: cwd,
    agent: 'scout',
    status: 'running',
    startedAt: 50,
    updatedAt: 60,
  });
  const ambiguous = await service.status(cwd);
  assert.match(ambiguous.error, /Ambiguous Sandcastle run selection/);
});

test('sc logs returns the stored path and reports missing logs clearly', async () => {
  const cwd = makeTempRepo();
  const store = createMemoryRunStore([
    {
      id: 'run-with-log',
      repoRoot: cwd,
      agent: 'builder',
      status: 'completed',
      startedAt: 1,
      updatedAt: 2,
      logPath: join(cwd, 'logs', 'run-with-log.log'),
    },
    {
      id: 'run-missing-log',
      repoRoot: cwd,
      agent: 'builder',
      status: 'completed',
      startedAt: 3,
      updatedAt: 4,
      logPath: join(cwd, 'logs', 'run-missing-log.log'),
    },
  ]);
  mkdirSync(join(cwd, 'logs'), { recursive: true });
  writeFileSync(join(cwd, 'logs', 'run-with-log.log'), 'hello');

  const service = createRunManagementService({ store });
  const logs = await service.logs(cwd, 'run-with-log');
  assert.equal(logs.logPath, join(cwd, 'logs', 'run-with-log.log'));

  const missingLogs = await service.logs(cwd, 'run-missing-log');
  assert.match(missingLogs.error, /log file is missing/);
});

test('sc cancel aborts active runs through injected controllers and updates records', async () => {
  const cwd = makeTempRepo();
  const store = createMemoryRunStore([
    {
      id: 'run-1',
      repoRoot: cwd,
      agent: 'builder',
      status: 'running',
      startedAt: 10,
      updatedAt: 10,
    },
    {
      id: 'run-2',
      repoRoot: cwd,
      agent: 'reviewer',
      status: 'running',
      startedAt: 20,
      updatedAt: 20,
    },
    {
      id: 'run-3',
      repoRoot: cwd,
      agent: 'scout',
      status: 'completed',
      startedAt: 30,
      updatedAt: 30,
    },
  ]);
  const cancelled = [];
  const service = createRunManagementService({
    store,
    controllers: new Map([
      ['run-1', { cancel: async () => cancelled.push('run-1') }],
      ['run-2', { cancel: async () => cancelled.push('run-2') }],
    ]),
    now: () => 1234,
  });

  const result = await service.cancel(cwd);
  const run1 = await store.readRun(cwd, 'run-1');
  const run2 = await store.readRun(cwd, 'run-2');
  const run3 = await store.readRun(cwd, 'run-3');
  assert.equal(result.runs.length, 2);
  assert.deepEqual(cancelled, ['run-2', 'run-1']);
  assert.equal(run1.status, 'cancelled');
  assert.equal(run1.updatedAt, 1234);
  assert.equal(run1.cancelledAt, 1234);
  assert.equal(run1.endedAt, 1234);
  assert.equal(run2.status, 'cancelled');
  assert.equal(run2.updatedAt, 1234);
  assert.equal(run2.cancelledAt, 1234);
  assert.equal(run2.endedAt, 1234);
  assert.equal(run3.status, 'completed');
});

test('sc resume requires resumable metadata and injected resume support', async () => {
  const cwd = makeTempRepo();
  const store = createMemoryRunStore([
    {
      id: 'run-unsupported',
      repoRoot: cwd,
      agent: 'builder',
      status: 'failed',
      startedAt: 10,
      updatedAt: 10,
    },
    {
      id: 'run-supported',
      repoRoot: cwd,
      agent: 'builder',
      status: 'failed',
      startedAt: 20,
      updatedAt: 20,
      resumable: true,
      providerSessionId: 'session-1',
    },
  ]);
  const resumed = [];
  const service = createRunManagementService({
    store,
    controllers: new Map([
      ['run-supported', { resume: async () => resumed.push('run-supported') }],
    ]),
    now: () => 5678,
  });

  const unsupported = await service.resume(cwd, 'run-unsupported');
  assert.match(unsupported.error, /cannot be resumed/);

  const supported = await service.resume(cwd, 'run-supported');
  const supportedRun = await store.readRun(cwd, 'run-supported');
  assert.equal(supported.run.id, 'run-supported');
  assert.deepEqual(resumed, ['run-supported']);
  assert.equal(supportedRun.status, 'running');
  assert.equal(supportedRun.updatedAt, 5678);
  assert.equal(supportedRun.resumedAt, 5678);
});
