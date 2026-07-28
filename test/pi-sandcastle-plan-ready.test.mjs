import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import agentWorkflows, {
  normalizeWorkPlanArtifact,
  parseSimpleYaml,
  validateSandcastleWorkspaceSource,
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

test('Agent Workflows registers /work planning commands without /backlog aliases', async () => {
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
      async runPlanWorkRole({ cwd: repo, args, role, task }) {
        calls.push({ repo, args, role, task });
        return { summary: 'Planner classified implementation first.', iterations: [{ items: [{ id: 'wi-001' }], classifications: { risk: 'low' }, rationale: 'Ready to execute.' }] };
      },
    },
  });

  await pi.commands.get('work:plan').handler('--iterations=2', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual({ repo: calls[0].repo, args: calls[0].args, role: calls[0].role }, { repo: cwd, args: '--iterations=2', role: 'planner' });
  assert.match(calls[0].task, /isolated planner workspace/);
  assert.match(calls[0].task, /Max workers available for a single parallel iteration: 5/);
  assert.match(calls[0].task, /unblocked-ready-AFK work/);
  assert.match(calls[0].task, /items array of objects/);
  assert.match(calls[0].task, /rationale must be a string/);
  assert.doesNotMatch(calls[0].task, /disposable planner snapshot/);
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

test('/work:plan dispatches planWork through the normal sandbox workspace path', async () => {
  const source = readFileSync(new URL('../extensions/agent-workflows/index.ts', import.meta.url), 'utf8');
  assert.match(source, /dispatch\(ctx\.cwd, agent, task, ctx, \{ branchPrefix: "agent-workflows\/planner" \}\)/);
  assert.doesNotMatch(source, /readOnly: true/);
  assert.doesNotMatch(source, /createPlannerSnapshot/);
  assert.doesNotMatch(source, /executionCwd: snapshotCwd/);
  assert.match(source, /imageName: defaultSandcastleImageName\(cwd, cfg\.imageNamePattern\)/);
});

test('Sandcastle workspace source validation rejects unborn git repositories clearly', async () => {
  const cwd = makeRepo();
  await import('node:child_process').then(({ execFileSync }) => execFileSync('git', ['init', '--quiet'], { cwd }));

  assert.deepEqual(validateSandcastleWorkspaceSource(cwd), [
    'Repository has no HEAD commit. Sandcastle workspaces require at least one commit before any role can run; create an initial commit, then retry.',
  ]);
});

test('pi provider uses writable temp agent dir with readonly host auth and trust mounts', async () => {
  const source = readFileSync(new URL('../extensions/agent-workflows/index.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(provider === "pi" && \(!model \|\| model === "Agent Default"\)\) return "Agent Default"/);
  assert.match(source, /hostPiConfig: runtime\.provider === "pi"/);
  assert.doesNotMatch(source, /sandboxPath: "\/home\/agent\/.pi\/agent"/);
  assert.doesNotMatch(source, /copyFileSync\(source, join\(tmp, file\)\)/);
  assert.match(source, /hostPiFileMounts/);
  assert.match(source, /HOST_PI_SANDBOX_DIR = "\/home\/agent\/.pi-host-agent"/);
  assert.match(source, /sandboxPath: `\$\{HOST_PI_SANDBOX_DIR\}\/auth\.json`, readonly: true/);
  assert.match(source, /sandboxPath: `\$\{HOST_PI_SANDBOX_DIR\}\/trust\.json`, readonly: true/);
  assert.match(source, /sandboxPath: HOST_PI_SANDBOX_DIR, readonly: false/);
  assert.match(source, /function readHostPiDefaults\(\)/);
  assert.match(source, /process\.env\.PI_CODING_AGENT_DIR \|\| process\.env\.PI_HOST_AGENT_DIR/);
  assert.match(source, /captureSessions: false/);
  assert.match(source, /sessionStorage: undefined/);
  assert.match(source, /function summarizePiJsonLine\(line\)/);
  assert.match(source, /message_start/);
  assert.match(source, /message_update/);
  assert.match(source, /return undefined/);
  assert.match(source, /function extractPlanObject\(assistantTexts, stdout\)/);
  assert.match(source, /outputKind: agent\.kind === "planWork" \? "work-plan" : undefined/);
  assert.match(source, /if \(job\.outputKind === "work-plan"\)/);
  assert.match(source, /writeFileSync\(resultPath, JSON\.stringify\(plan, null, 2\)\)/);
  assert.match(source, /assistantTexts\.push\(\.\.\.assistantTextsFromPiJsonLine\(text\)\)/);
  assert.match(source, /summarizePiJsonLine\(text\)/);
  assert.doesNotMatch(source, /emit\(\{ type: "raw"/);
  assert.match(source, /"assistant: " \+ summary/);
  assert.match(source, /--no-session/);
  assert.match(source, /--provider/);
  assert.match(source, /return piWithHostDefault\(model, pi\)/);
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

test('Work Plan artifact schema normalizes canonical ids, scope, and rejects nested execution mechanics', () => {
  const plan = normalizeWorkPlanArtifact({
    kind: 'workPlan',
    scope: 'forecast',
    schemaVersion: 1,
    summary: 'Safe plan',
    query: 'ready',
    actionable: {
      scope: 'actionable',
      iterations: [{ items: [' wi-001 '] }],
    },
    iterations: [{
      id: 'iter-1',
      title: 'First iteration',
      rationale: { dependency: 'none', classification: 'afk-ready', risk: 'low' },
      parallelizable: true,
      classifications: { risk: 'low' },
      items: [' wi-001 ', { id: ' wi-002 ', title: 'Two', sourcePath: 'backlog/002.md', classifications: { area: 'core' } }],
    }],
  });

  assert.equal(plan.kind, 'workPlan');
  assert.equal(plan.scope, 'forecast');
  assert.equal(plan.actionable.scope, 'actionable');
  assert.equal(plan.actionable.iterations[0].items[0].id, 'wi-001');
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.iterations[0].items[0].id, 'wi-001');
  assert.equal(plan.iterations[0].items[1].id, 'wi-002');
  assert.equal(plan.iterations[0].rationale, 'dependency: none; classification: afk-ready; risk: low');
  assert.equal(plan.iterations[0].parallelizable, true);
  assert.equal(normalizeWorkPlanArtifact({ iterations: [{ items: [{ id: 'wi-003' }] }] }).scope, 'actionable');
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

test('/work:process refuses invalid graph config before planning or execution', async () => {
  const cwd = makeRepo();
  mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
    'runtimeVersion: 1',
    'defaultPipeline: old',
    'roles:',
    '  worker:',
    '    description: Worker',
    'pipelines:',
    '  old:',
    '    steps:',
    '      - kind: runRole',
    '        role: worker',
    '        prompt: simple-loop',
  ].join('\n'));
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
    work: {
      async plan() {
        calls.push('plan');
        return { iterations: [{ items: [{ id: 'wi-001' }] }] };
      },
      async execute() {
        calls.push('execute');
        return { status: 'done' };
      },
    },
  });

  await pi.commands.get('work:process').handler('ready work', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.deepEqual(calls, []);
  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /Invalid Agent Workflows configuration/);
  assert.match(notifications[0].message, /config\.pipelines\.old\.kind is required/);
  assert.match(notifications[0].message, /config\.pipelines\.old\.steps is not supported/);
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
          iterations: [{ items: [{ id: 'wi-001' }], recommendedPipeline: 'planner-chosen-review', supportsParallel: false, rationale: 'planner fixture' }],
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
  assert.match(notifications.at(-1).message, /Pipeline: simple-loop/);
});

test('/work:process --plan consumes actionable section of cached forecast plans only', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'forecast-plan-test';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: {
      kind: 'workPlan',
      scope: 'forecast',
      actionable: { scope: 'actionable', iterations: [{ parallelizable: false, items: [{ id: 'wi-ready' }] }] },
      iterations: [
        { items: [{ id: 'wi-ready' }], rationale: 'currently ready' },
        { items: [{ id: 'wi-future' }], rationale: 'forecast after dependencies clear' },
      ],
    },
  }, null, 2));
  agentWorkflows(pi, {
    work: {
      now: () => 123456,
      async plan(repo, query) {
        return { query, iterations: [{ items: [{ id: 'wi-ready', title: 'Ready now' }] }] };
      },
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

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input.items.map((item) => item.id), ['wi-ready']);
  assert.equal(calls[0].input.parallel, false);
  assert.notDeepEqual(calls[0].input.items.map((item) => item.id), ['wi-ready', 'wi-future']);
  assert.match(notifications.at(-1).message, /forecast/);
  assert.match(notifications.at(-1).message, /actionable section/);
});

test('/work:process --plan refuses cached actionable items that are no longer ready', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'stale-actionable-plan';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: { scope: 'actionable', iterations: [{ items: [{ id: 'wi-stale' }] }] },
  }, null, 2));
  agentWorkflows(pi, {
    work: {
      async plan(repo, query) {
        return { query, iterations: [{ items: [{ id: 'wi-other' }] }] };
      },
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
  assert.match(notifications[0].message, /no currently ready planned Work Items/);
  assert.match(notifications[0].message, /wi-stale/);
});

test('/work:process --plan executes only currently ready planned items and reports stale omissions', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'mixed-actionable-plan';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: { scope: 'actionable', iterations: [{ items: [{ id: 'wi-ready' }, { id: 'wi-stale' }] }] },
  }, null, 2));
  agentWorkflows(pi, {
    work: {
      now: () => 123456,
      async plan(repo, query) {
        return { query, iterations: [{ items: [{ id: 'wi-ready', title: 'Current ready item' }] }] };
      },
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

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input.items.map((item) => item.id), ['wi-ready']);
  assert.equal(calls[0].input.items[0].title, 'Current ready item');
  assert.match(notifications.at(-1).message, /omitted no-longer-ready Work Items: wi-stale/);
});

test('/work:process --plan refuses forecast plans without actionable content', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  mkdirSync(join(cwd, '.pi', 'sandcastle', 'plans'), { recursive: true });
  const planId = 'forecast-without-actionable';
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'plans', `${planId}.json`), JSON.stringify({
    id: planId,
    kind: 'work-plan',
    plan: { scope: 'forecast', iterations: [{ items: [{ id: 'wi-future' }] }] },
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
  assert.match(notifications[0].message, /forecast/);
  assert.match(notifications[0].message, /does not contain an actionable Work Plan/);
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
      async plan(repo, query) {
        return { query, iterations: [{ items: [{ id: 'wi-001', title: 'Current One' }, { id: 'wi-002', title: 'Current Two' }] }] };
      },
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
  assert.match(notifications.at(-1).message, /Status: ✓ done/);
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
