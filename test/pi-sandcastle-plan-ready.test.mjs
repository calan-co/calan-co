import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import agentWorkflows, {
  createPlannerSnapshot,
  normalizeWorkPlanArtifact,
  parseSimpleYaml,
  selectPlanWorkRoleName,
  validateWorkPlanArtifact,
} from '../extensions/agent-workflows/index.ts';

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
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-plan-'));
  mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
  return cwd;
}

test('Agent Workflows registers /work planning commands without legacy /backlog aliases', async () => {
  const pi = fakePi();
  agentWorkflows(pi, {});

  for (const name of ['work:help', 'work:ready', 'work:plan', 'work:next', 'work:process']) {
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
  agentWorkflows(pi, {
    work: {
      now: () => 123456,
      async runPlanWorkRole({ cwd: repo, args, role, snapshotCwd }) {
        calls.push({ repo, args, role, snapshotHasMarker: existsSync(join(snapshotCwd, '.agent-workflows-planner-snapshot')) });
        return { summary: 'Planner classified implementation first.', iterations: [{ items: [{ id: 'wi-001' }], classifications: { risk: 'low' }, rationale: 'Ready to execute.' }] };
      },
    },
  });

  await pi.commands.get('work:plan').handler('--iterations=2', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.deepEqual(calls, [{ repo: cwd, args: '--iterations=2', role: 'planner', snapshotHasMarker: true }]);
  assert.match(notifications[0].message, /Planner classified implementation first/);
  assert.match(notifications[0].message, /Cached plan: plan-/);
  const planId = notifications[0].message.match(/Cached plan: (\S+)/)[1];
  const recordPath = join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`);
  assert.equal(existsSync(recordPath), true);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(record.kind, 'work-plan');
  assert.equal(record.plan.summary, 'Planner classified implementation first.');
});

test('selectPlanWorkRoleName uses explicit role kind rather than role name', () => {
  const cfg = parseSimpleYaml(`
roles:
  researcher:
    kind: planWork
    provider: pi
  planner:
    kind: runRole
    provider: pi
`);
  assert.equal(selectPlanWorkRoleName(cfg), 'researcher');
  assert.throws(() => selectPlanWorkRoleName(parseSimpleYaml('roles:\n  planner:\n    provider: pi\n')), /kind: planWork/);
});

test('/work:plan dispatches planner snapshots through the normal sandbox workspace path', async () => {
  const source = readFileSync(new URL('../extensions/agent-workflows/index.ts', import.meta.url), 'utf8');
  assert.match(source, /dispatch\(ctx\.cwd, agent, task, ctx, \{ executionCwd: snapshotCwd, branchPrefix: "agent-workflows\/planner" \}\)/);
  assert.doesNotMatch(source, /readOnly: true/);
  assert.match(source, /imageName: defaultSandcastleImageName\(cwd, cfg\.imageNamePattern\)/);
});

test('createPlannerSnapshot creates a disposable git repo without host-private state', async () => {
  const cwd = makeRepo();
  mkdirSync(join(cwd, '.git'), { recursive: true });
  mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
  await import('node:fs').then(({ writeFileSync }) => {
    writeFileSync(join(cwd, 'README.md'), '# Test repo\n');
    writeFileSync(join(cwd, '.pi', 'secret.txt'), 'do not copy\n');
  });

  const snapshot = createPlannerSnapshot(cwd);
  try {
    assert.equal(existsSync(join(snapshot, 'README.md')), true);
    assert.equal(existsSync(join(snapshot, '.agent-workflows-planner-snapshot')), true);
    assert.equal(existsSync(join(snapshot, '.git')), true);
    assert.equal(existsSync(join(snapshot, '.pi')), false);
    assert.equal(existsSync(join(snapshot, '.sandcastle')), false);
    const head = await import('node:child_process').then(({ execFileSync }) => execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: snapshot, encoding: 'utf8' }).trim());
    assert.match(head, /^[0-9a-f]{40}$/);
  } finally {
    await import('node:fs').then(({ rmSync }) => rmSync(snapshot, { recursive: true, force: true }));
  }
});

test('/work:plan fails closed and caches invalid planner output for inspection', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const notifications = [];
  agentWorkflows(pi, {
    work: {
      now: () => 123456,
      async runPlanWorkRole() {
        return { summary: 'not executable', iterations: [{ items: [{ title: 'Missing id' }] }] };
      },
    },
  });

  await pi.commands.get('work:plan').handler('', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /Planner output is not executable/);
  assert.match(notifications[0].message, /Cached invalid output: invalid-plan-/);
  const invalidPlanId = notifications[0].message.match(/Cached invalid output: (\S+)/)[1];
  const invalidRecordPath = join(cwd, '.pi', 'sandcastle', 'plans', `${invalidPlanId}.json`);
  assert.equal(existsSync(invalidRecordPath), true);
  const record = JSON.parse(readFileSync(invalidRecordPath, 'utf8'));
  assert.equal(record.kind, 'invalid-work-plan');
  assert.equal(record.rawOutput.summary, 'not executable');
  assert.match(record.validationErrors.join('\n'), /item id/);
});

test('/work:plan rejects planner-authored pipeline and branch mechanics', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const notifications = [];
  agentWorkflows(pi, {
    work: {
      now: () => 123456,
      async runPlanWorkRole() {
        return {
          summary: 'tries to decide execution mechanics',
          iterations: [{ pipeline: 'implement', recommendedPipeline: 'review', branchName: 'feature/from-plan', items: [{ id: 'wi-001', branch: 'feature/item' }] }],
        };
      },
    },
  });

  await pi.commands.get('work:plan').handler('', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /must not author execution field 'pipeline'/);
  assert.match(notifications[0].message, /must not author execution field 'recommendedPipeline'/);
  assert.match(notifications[0].message, /must not author execution field 'branchName'/);
  assert.match(notifications[0].message, /must not author execution field 'branch'/);
});

test('Work Plan artifact schema normalizes canonical ids and rejects nested execution mechanics', () => {
  const plan = normalizeWorkPlanArtifact({
    schemaVersion: 1,
    summary: 'Safe plan',
    query: 'ready',
    iterations: [{
      id: 'iter-1',
      title: 'First iteration',
      parallelizable: true,
      classifications: { risk: 'low' },
      items: [{ id: ' wi-001 ', title: 'One', sourcePath: 'backlog/001.md', classifications: { area: 'core' } }],
    }],
  });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.iterations[0].items[0].id, 'wi-001');
  assert.equal(plan.iterations[0].parallelizable, true);
  assert.deepEqual(validateWorkPlanArtifact({ iterations: [{ items: [{ id: 'wi-002', metadata: { branchName: 'feature/from-plan' } }] }] }), [
    "Plan iteration 1 item 1 metadata must not author execution field 'branchName'.",
  ]);
});

test('/work:process --plan refuses cached invalid planner output', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', 'invalid-plan-test.json'), JSON.stringify({
    id: 'invalid-plan-test',
    kind: 'invalid-work-plan',
    validationErrors: ['Plan group 1 item 1 is missing a canonical item id.'],
    rawOutput: { iterations: [{ items: [{ title: 'Missing id' }] }] },
  }, null, 2)));
  agentWorkflows(pi, {
    work: {
      async execute(repo, input) {
        calls.push({ repo, input });
        return { status: 'done' };
      },
    },
  });

  await pi.commands.get('work:process').handler('--plan invalid-plan-test', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 0);
  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /not an executable Work Plan/);
});

test('/work:process --plan fails closed when cached Work Plan payload is missing', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'plan-missing-payload';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
  }, null, 2));
  agentWorkflows(pi, {
    work: {
      async execute(repo, input) {
        calls.push({ repo, input });
        return { status: 'done' };
      },
    },
  });

  await pi.commands.get('work:process').handler(`--plan ${planId}`, {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 0);
  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /Cached Work Plan 'plan-missing-payload' is not executable/);
  assert.match(notifications[0].message, /Planner output must be a JSON object/);
});

test('/work:process --plan refuses cached Work Plans with planner-authored execution mechanics', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'plan-with-execution-mechanics';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: { iterations: [{ recommendedPipeline: 'planner-chosen-pipeline', branchName: 'feature/from-plan', items: [{ id: 'wi-001' }] }] },
  }, null, 2));
  agentWorkflows(pi, {
    work: {
      async execute(repo, input) {
        calls.push({ repo, input });
        return { status: 'done' };
      },
    },
  });

  await pi.commands.get('work:process').handler(`--plan ${planId}`, {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 0);
  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /Cached Work Plan 'plan-with-execution-mechanics' is not executable/);
  assert.match(notifications[0].message, /recommendedPipeline/);
  assert.match(notifications[0].message, /branchName/);
});

test('/work:process ignores planner-recommended pipeline and derives pipeline from config/default', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
    work: {
      now: () => 123456,
      async plan(repo, query) {
        return {
          query,
          iterations: [{ items: [{ id: 'wi-001' }], recommendedPipeline: 'planner-chosen-review', supportsParallel: false, rationale: 'legacy planner fixture' }],
        };
      },
      async execute(repo, input) {
        calls.push({ repo, input });
        return { status: 'done' };
      },
    },
  });

  await pi.commands.get('work:process').handler('ready work', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.pipeline, 'simple-loop');
  assert.match(notifications.at(-1).message, /pipeline simple-loop/);
});

test('/work:process --plan derives pipeline from config and preserves explicit parallelizable classification', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'plan-test';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), 'defaultPipeline: sequential-reviewer\n');
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: { iterations: [{ parallelizable: false, items: [{ id: 'wi-001', title: 'One', sourcePath: 'backlog/001.md' }, { id: 'wi-002', title: 'Two', sourcePath: 'backlog/002.md' }] }] },
  }, null, 2));
  agentWorkflows(pi, {
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
  assert.equal(calls[0].input.pipeline, 'sequential-reviewer');
  assert.equal(calls[0].input.parallel, false);
  assert.deepEqual(calls[0].input.items.map((item) => item.id), ['wi-001', 'wi-002']);
  assert.deepEqual(calls[0].input.executionGroups.map((group) => group.contexts.map((context) => context.itemId)), [['wi-001'], ['wi-002']]);
  assert.ok(calls[0].input.executionContexts.every((context) => context.branch.startsWith('agent-workflows/sequential-reviewer/')));
  const savedRecord = JSON.parse(readFileSync(calls[0].input.recordPath, 'utf8'));
  assert.deepEqual(savedRecord.branches, ['branch']);
  assert.deepEqual(savedRecord.executionContexts.map((context) => context.branch), calls[0].input.executionContexts.map((context) => context.branch));
  assert.match(notifications.at(-1).message, /Work process done/);
});

test('/work:ready delegates readiness to Doc-Vader capability', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
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
