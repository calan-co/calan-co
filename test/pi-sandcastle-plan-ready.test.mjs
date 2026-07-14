import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import piSandcastle from '../extensions/pi-sandcastle/index.ts';

function fakePi() {
  const commands = new Map();
  return {
    commands,
    on() {},
    registerCommand(name, spec) { commands.set(name, spec); },
    registerTool() {},
  };
}

function makeRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-sandcastle-plan-'));
  mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
  return cwd;
}

test('Agent Workflows registers /work planning commands without legacy /backlog aliases', async () => {
  const pi = fakePi();
  piSandcastle(pi, {});

  for (const name of ['work:ready', 'work:plan', 'work:next', 'work:process']) {
    assert.equal(pi.commands.has(name), true, `${name} should be registered`);
  }
  for (const name of ['backlog:ready', 'backlog:plan', 'backlog:next', 'backlog:process']) {
    assert.equal(pi.commands.has(name), false, `${name} should not be registered`);
  }
});

test('/work:plan runs planning phase and caches authoritative plan output', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  piSandcastle(pi, {
    work: {
      now: () => 123456,
      async planPhase(repo, args) {
        calls.push({ repo, args });
        return { summary: 'Planner chose implementation first.', iterations: [{ items: [{ id: 'wi-001' }], pipeline: 'simple-loop' }] };
      },
    },
  });

  await pi.commands.get('work:plan').handler('--iterations=2', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.deepEqual(calls, [{ repo: cwd, args: '--iterations=2' }]);
  assert.match(notifications[0].message, /Planner chose implementation first/);
  assert.match(notifications[0].message, /Cached plan: plan-/);
  const planId = notifications[0].message.match(/Cached plan: (\S+)/)[1];
  const recordPath = join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`);
  assert.equal(existsSync(recordPath), true);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(record.kind, 'work-plan');
  assert.equal(record.plan.summary, 'Planner chose implementation first.');
});

test('/work:process --plan uses a cached authoritative plan', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'plan-test';
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: { iterations: [{ pipeline: 'simple-loop', items: [{ id: 'wi-001', title: 'One', sourcePath: 'backlog/001.md' }] }] },
  }, null, 2)));
  piSandcastle(pi, {
    work: {
      now: () => 123456,
      async execute(repo, input) {
        calls.push({ repo, input });
        return { status: 'done', branches: ['branch'], logs: ['log'] };
      },
    },
  });

  await pi.commands.get('work:process').handler('--plan plan-test', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.pipeline, 'simple-loop');
  assert.deepEqual(calls[0].input.items.map((item) => item.id), ['wi-001']);
  assert.match(notifications.at(-1).message, /Work process done/);
});

test('/work:ready delegates readiness to Doc-Vader capability', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  piSandcastle(pi, {
    work: {
      async ready(repo, args) {
        calls.push({ repo, args });
        return 'Ready work candidates\nCandidates: 3';
      },
    },
  });

  await pi.commands.get('work:ready').handler('--limit 3', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.deepEqual(calls, [{ repo: cwd, args: '--limit 3' }]);
  assert.deepEqual(notifications, [{ message: 'Ready work candidates\nCandidates: 3', type: 'info' }]);
});
