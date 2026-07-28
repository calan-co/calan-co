import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import os from 'node:os';
import test from 'node:test';

import agentWorkflows from '../extensions/agent-workflows/index.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const extensionPath = fileURLToPath(new URL('../extensions/agent-workflows/index.ts', import.meta.url));
const backlogProcessItem = {
  id: '00008',
  title: 'Backlog Process with Deterministic Pipeline Parsing',
  summary: 'Process backlog work',
  tags: ['afk', 'backlog'],
  sourcePath: 'backlog/00008-backlog-process-deterministic-pipeline-parsing.md',
};
const backlogRunManagementItem = {
  id: '00009',
  title: 'Backlog Run Management Commands',
  summary: 'Run management',
  tags: ['afk', 'backlog'],
  sourcePath: 'backlog/00009-backlog-run-management-commands.md',
};
const backlogPlanIterations = {
  default: {
    items: [backlogProcessItem],
    recommendedPipeline: 'implement',
    supportsParallel: false,
    rationale: 'planned',
  },
  review: {
    items: [backlogProcessItem, backlogRunManagementItem],
    recommendedPipeline: 'review',
    supportsParallel: true,
    rationale: 'planned',
  },
};
const backlogProcessInputs = [
  {
    key: 'review',
    raw: 'review',
  },
  {
    key: 'explicit',
    raw: 'auth bugs --pipeline implement',
  },
  {
    key: 'shortFlag',
    raw: 'label:small -p review',
  },
];

function assertBacklogRunRecord(record, expected) {
  assert.ok(record);
  assert.equal(record.kind, 'work-process');
  assert.equal(record.pipeline, expected.pipeline);
  assert.equal(record.status, 'done');
  assert.equal(record.resolvedItems.length, expected.resolvedItems);
  assert.deepEqual(record.branches, expected.branches);
  assert.deepEqual(record.logs, expected.logs);
  assert.ok(Array.isArray(record.executionContexts));
  assert.equal(record.executionContexts.length, expected.branchItemIds.length);
  for (const itemId of expected.branchItemIds) {
    assert.ok(record.executionContexts.some((context) => context.branch.startsWith(`agent-workflows/${expected.pipeline}/`) && context.branch.endsWith(`/${itemId}`)), `missing orchestrator context branch for ${itemId}`);
  }
  assert.ok(Number.isFinite(record.startedAt));
  assert.ok(Number.isFinite(record.endedAt));
  assert.ok(record.endedAt >= record.startedAt);
}

function runBacklogProcessFixture() {
  const cwd = mkdtempSync(join(os.tmpdir(), 'pi-backlog-process-'));
  const script = `
import fs from 'node:fs';
import { join } from 'node:path';
import agentWorkflows, { parseBacklogProcessArgs } from ${JSON.stringify(extensionPath)};

const cwd = ${JSON.stringify(cwd)};
const planIterations = ${JSON.stringify(backlogPlanIterations, null, 2)};
const processInputs = ${JSON.stringify(backlogProcessInputs, null, 2)};
const notifications = [];
const commands = new Map();
const calls = [];
const api = {
  registerCommand(name, spec) {
    commands.set(name, spec);
  },
  on() {},
  registerTool() {},
};

agentWorkflows(api, {
  work: {
    now: () => 1710000000000 + calls.length,
    plan: async (_cwd, query) => {
      const iteration = query === 'review' ? planIterations.review : planIterations.default;
      return { query, iterations: [iteration] };
    },
    execute: async (_cwd, input) => {
      calls.push({
        runId: input.runId,
        query: input.query,
        pipeline: input.pipeline,
        parallel: input.parallel,
        items: input.items.map((item) => item.id),
        recordPath: input.recordPath,
      });
      return {
        branches: input.items.map((item) => 'branch-' + item.id),
        logs: input.items.map((item) => 'log-' + item.id + '.txt'),
        status: 'done',
      };
    },
  },
});

const handler = commands.get('work:process').handler;
const parsed = Object.fromEntries(
  processInputs.map(({ key, raw }) => [key, parseBacklogProcessArgs(raw)]),
);

for (const { raw } of processInputs) {
  await handler(raw, {
    cwd,
    ui: { notify(message, type) { notifications.push({ message, type }); } },
  });
}

const recordDir = join(cwd, '.pi/sandcastle/runs');
const records = fs
  .readdirSync(recordDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(fs.readFileSync(join(recordDir, name), 'utf8')))
  .filter((record) => record.kind === 'work-process');

console.log(JSON.stringify({ parsed, calls, records, notifications }, null, 2));
`;

  try {
    return JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('parseBacklogProcessArgs keeps query text separate from pipeline selection', () => {
  const { parsed } = runBacklogProcessFixture();

  assert.deepEqual(parsed.review, { query: 'review' });
  assert.deepEqual(parsed.explicit, { query: 'auth bugs', pipeline: 'implement' });
  assert.deepEqual(parsed.shortFlag, { query: 'label:small', pipeline: 'review' });
});

test('work:process passes canonical Work Items with preserved source to execution', async () => {
  const cwd = mkdtempSync(join(os.tmpdir(), 'pi-work-process-source-'));
  try {
    mkdirSync(join(cwd, 'backlog'), { recursive: true });
    writeFileSync(join(cwd, 'backlog', '00042-preserve-source.md'), `---
id: wi-00042
title: Preserve Work Source
summary: Keep source payloads for role briefs.
estimated: 3
links:
  depends_on:
    - 'wi-00041'
tags:
  - afk
  - work
---

## Goal

Preserve this exact markdown body.

## Acceptance Criteria

- [ ] Source body is available to Work Brief rendering.
`);

    const commands = new Map();
    let capturedItems = [];
    agentWorkflows({
      registerCommand(name, spec) {
        commands.set(name, spec);
      },
      on() {},
      registerTool() {},
    }, {
      work: {
        now: () => 1710000000000,
        execute: async (_cwd, input) => {
          capturedItems = input.items;
          return { branches: [], logs: [], status: 'done' };
        },
      },
    });

    await commands.get('work:process').handler('preserve', {
      cwd,
      ui: { notify() {} },
    });

    assert.equal(capturedItems.length, 1);
    const [item] = capturedItems;
    assert.equal(item.id, 'wi-00042');
    assert.equal(item.source.path, 'backlog/00042-preserve-source.md');
    assert.equal(item.source.absolutePath, join(cwd, 'backlog', '00042-preserve-source.md'));
    assert.match(item.source.body, /## Goal\n\nPreserve this exact markdown body\./);
    assert.equal(item.source.payload.frontmatter.title, 'Preserve Work Source');
    assert.deepEqual(item.dependencies, ['wi-00041']);
    assert.deepEqual(item.dependsOn, item.dependencies);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('work:process reports one worker row per graph agent in the completion summary', async () => {
  const cwd = mkdtempSync(join(os.tmpdir(), 'pi-work-process-worker-status-'));
  try {
    mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
    mkdirSync(join(cwd, 'backlog'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
      'defaultPipeline: implement',
      'defaultSandbox: no-sandbox',
      'defaultModel: test-model',
      'roles:',
      '  researcher:',
      '    provider: claude-code',
      '    model: test-model',
      '    sandbox: no-sandbox',
      '  builder:',
      '    provider: claude-code',
      '    model: test-model',
      '    sandbox: no-sandbox',
      'pipelines:',
      '  implement:',
      '    sandbox: no-sandbox',
      '    kind: composite',
      '    nodes:',
      '      workspace:',
      '        kind: git.worktree',
      '        nodes:',
      '          research:',
      '            kind: agent.pi',
      '            role: researcher',
      '            prompt: $INPUT',
      '          build:',
      '            kind: agent.pi',
      '            needs: [research]',
      '            role: builder',
      '            prompt: $INPUT',
    ].join('\n'));
    writeFileSync(join(cwd, 'backlog', '00008-work.md'), `---\nid: wi-00008\ntitle: Worker Status\ntags:\n  - afk\n---\n\n## Goal\n\nReport workers.`);

    const commands = new Map();
    const events = new Map();
    const widgets = [];
    const notifications = [];
    agentWorkflows({
      registerCommand(name, spec) { commands.set(name, spec); },
      on(name, handler) { events.set(name, handler); },
      registerTool() {},
    }, {
      pipeline: {
        now: () => 1700000004000,
        createWorktree: async () => ({
          branch: 'sandcastle/implement',
          worktreePath: join(cwd, '.pi/sandcastle/worktrees/implement'),
          close: async () => ({}),
          run: async (options) => {
            options.logging.onAgentStreamEvent?.({ type: 'raw', line: '{"type":"message_update","assistantMessageEvent":{"type":"thinking_start","contentIndex":0,"partial":{"role":"assistant"}}}', iteration: 1, timestamp: new Date() });
            options.logging.onAgentStreamEvent?.({ type: 'raw', line: JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '**Reviewing plan**', thinkingSignature: '{"id":"raw-secret","encrypted_content":"hidden"}' }, { type: 'text', text: 'Implemented focused change', textSignature: '{"id":"text-secret"}' }] } }), iteration: 1, timestamp: new Date() });
            options.logging.onAgentStreamEvent?.({ type: 'text', message: { type: 'thinking', thinking: options.logging.path.includes('researcher') ? '**Reading plan**' : '**Editing file**', thinkingSignature: '{"id":"secret"}' }, iteration: 1, timestamp: new Date() });
            options.logging.onAgentStreamEvent?.({ type: 'text', message: { type: 'thinking', thinking: '', thinkingSignature: '{"id":"empty"}' }, iteration: 1, timestamp: new Date() });
            options.logging.onAgentStreamEvent?.({ type: 'text', message: { text: options.logging.path.includes('researcher') ? 'Reading plan' : 'Editing file' }, iteration: 1, timestamp: new Date() });
            options.logging.onAgentStreamEvent?.({ type: 'toolCall', name: options.logging.path.includes('researcher') ? 'Search' : 'Bash', formattedArgs: '{}', iteration: 1, timestamp: new Date() });
            return {
              iterations: [],
              commits: [{ sha: options.prompt.includes('Research') ? 'research-sha' : 'build-sha' }],
              branch: 'sandcastle/implement',
              stdout: '',
              logFilePath: options.logging.path,
            };
          },
        }),
        loadSandboxProvider: async (kind) => ({ kind }),
      },
    });

    const ctx = {
      cwd,
      ui: {
        notify(message, type) { notifications.push({ message, type }); },
        setWidget(id, lines) { widgets.push({ id, lines }); },
      },
    };
    await events.get('session_start')?.({}, ctx);
    await commands.get('work:process').handler('status', ctx);

    const message = notifications.at(-1).message;
    assert.match(message, /^Work process backlog-/);
    assert.match(message, /Status: ✓ done/);
    assert.match(message, /Pipeline: implement/);
    assert.match(message, /Workers:/);
    assert.match(message, /✓ Worker \d+: researcher completed/);
    assert.match(message, /✓ Worker \d+: builder completed/);
    assert.match(message, /node root\.nodes\.workspace\.nodes\.research/);
    assert.match(message, /Approved changes merged:/);
    assert.match(message, /Artifacts:\n  Record:/);
    assert.ok(widgets.some((entry) => entry.lines.some((line) => /running\s+researcher.*tool: Search/.test(line))));
    assert.ok(widgets.some((entry) => entry.lines.some((line) => /running\s+builder.*tool: Bash/.test(line))));
    assert.equal(widgets.some((entry) => entry.lines.some((line) => /running\s+researcher\s+\d+s · running$/.test(line))), false);
    assert.ok(widgets.some((entry) => entry.lines.some((line) => /running\s+researcher.*\*\*Reading plan\*\*/.test(line))));
    assert.ok(widgets.some((entry) => entry.lines.some((line) => /running\s+researcher.*Implemented focused change/.test(line))));
    assert.equal(widgets.some((entry) => entry.lines.some((line) => /\{"type":"message_update"/.test(line))), false);
    assert.equal(widgets.some((entry) => entry.lines.some((line) => /\{"type":"thinking"/.test(line))), false);
    assert.equal(widgets.some((entry) => entry.lines.some((line) => /message_end|thinkingSignature|textSignature|secret|hidden|empty/.test(line))), false);
    assert.equal(widgets.some((entry) => entry.lines.some((line) => /\[object Object\]/.test(line))), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('work:process does not mark later pipeline workers running before their step starts', async () => {
  const cwd = mkdtempSync(join(os.tmpdir(), 'pi-work-process-worker-sequential-status-'));
  try {
    mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
    mkdirSync(join(cwd, 'backlog'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
      'defaultPipeline: implement',
      'defaultSandbox: no-sandbox',
      'defaultModel: test-model',
      'roles:',
      '  researcher:',
      '    provider: claude-code',
      '    model: test-model',
      '    sandbox: no-sandbox',
      '  builder:',
      '    provider: claude-code',
      '    model: test-model',
      '    sandbox: no-sandbox',
      'pipelines:',
      '  implement:',
      '    sandbox: no-sandbox',
      '    kind: composite',
      '    nodes:',
      '      workspace:',
      '        kind: git.worktree',
      '        nodes:',
      '          research:',
      '            kind: agent.pi',
      '            role: researcher',
      '            prompt: $INPUT',
      '          build:',
      '            kind: agent.pi',
      '            needs: [research]',
      '            role: builder',
      '            prompt: $INPUT',
    ].join('\n'));
    writeFileSync(join(cwd, 'backlog', '00008-work.md'), `---\nid: wi-00008\ntitle: Worker Status\ntags:\n  - afk\n---\n\n## Goal\n\nReport workers.`);

    const commands = new Map();
    const events = new Map();
    const widgets = [];
    let firstRunStartedWidget;
    agentWorkflows({
      registerCommand(name, spec) { commands.set(name, spec); },
      on(name, handler) { events.set(name, handler); },
      registerTool() {},
    }, {
      pipeline: {
        now: () => 1700000005000,
        createWorktree: async () => ({
          branch: 'sandcastle/implement',
          worktreePath: join(cwd, '.pi/sandcastle/worktrees/implement'),
          close: async () => ({}),
          run: async (options) => {
            if (!firstRunStartedWidget) firstRunStartedWidget = widgets.at(-1)?.lines || [];
            return { iterations: [], commits: [{ sha: 'status-sha' }], branch: 'sandcastle/implement', stdout: '', logFilePath: options.logging.path };
          },
        }),
        loadSandboxProvider: async (kind) => ({ kind }),
      },
    });

    const ctx = {
      cwd,
      ui: {
        notify() {},
        setWidget(id, lines) { widgets.push({ id, lines }); },
      },
    };
    await events.get('session_start')?.({}, ctx);
    await commands.get('work:process').handler('status', ctx);

    assert.ok(firstRunStartedWidget.some((line) => /running\s+researcher/.test(line)), 'first worker should be running when the first Sandcastle run starts');
    assert.equal(firstRunStartedWidget.some((line) => /queued\s+builder/.test(line)), false, 'graph workers should appear only when their node actually starts');
    assert.equal(firstRunStartedWidget.some((line) => /running\s+builder/.test(line)), false, 'later workers must not appear running before their step starts');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('work:process prunes completed worker rows before starting another process', async () => {
  const cwd = mkdtempSync(join(os.tmpdir(), 'pi-work-process-prune-workers-'));
  try {
    mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
      'defaultPipeline: implement',
      'defaultSandbox: no-sandbox',
      'roles:',
      '  planner:',
      '    provider: claude-code',
      '    sandbox: no-sandbox',
      'pipelines:',
      '  implement:',
      '    sandbox: no-sandbox',
      '    kind: composite',
      '    nodes:',
      '      workspace:',
      '        kind: git.worktree',
      '        nodes:',
      '          plan:',
      '            kind: agent.pi',
      '            role: planner',
      '            prompt: $INPUT',
    ].join('\n'));

    const commands = new Map();
    const events = new Map();
    const widgets = [];
    agentWorkflows({
      registerCommand(name, spec) { commands.set(name, spec); },
      on(name, handler) { events.set(name, handler); },
      registerTool() {},
    }, {
      work: {
        plan: async (_cwd, query) => ({ query, iterations: [{ items: [{ id: query || 'wi', title: query || 'Work', tags: [], sourcePath: `backlog/${query || 'wi'}.md` }] }] }),
      },
      pipeline: {
        now: () => 1700000007000,
        createWorktree: async () => ({
          branch: 'sandcastle/implement',
          worktreePath: join(cwd, '.pi/sandcastle/worktrees/implement'),
          close: async () => ({}),
          run: async () => ({ iterations: [], commits: [{ sha: 'planner-sha' }], branch: 'sandcastle/implement', stdout: '', logFilePath: join(cwd, 'log.txt') }),
        }),
        loadSandboxProvider: async (kind) => ({ kind }),
      },
    });

    const ctx = { cwd, ui: { notify() {}, setWidget(id, lines) { widgets.push({ id, lines }); } } };
    const originalNow = Date.now;
    let now = 1700000007000;
    Date.now = () => now;
    try {
      await events.get('session_start')?.({}, ctx);
      await commands.get('work:process').handler('first', ctx);
      const doneLine = widgets.at(-1).lines.find((line) => /done\s+planner/.test(line));
      now += 60000;
      await events.get('session_start')?.({}, ctx);
      const refreshedDoneLine = widgets.at(-1).lines.find((line) => /done\s+planner/.test(line));
      assert.equal(refreshedDoneLine, doneLine, 'terminal worker row age should not keep ticking');
      await commands.get('work:process').handler('second', ctx);
    } finally {
      Date.now = originalNow;
    }

    const lastLines = widgets.at(-1).lines;
    assert.match(lastLines[0], /^Execution workers: 1/);
    assert.equal(lastLines.filter((line) => /planner/.test(line)).length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('work:process shows actual graph implementer lanes instead of preallocating max rows', async () => {
  const cwd = mkdtempSync(join(os.tmpdir(), 'pi-work-process-parallel-implementers-'));
  try {
    mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
      'defaultPipeline: implement',
      'defaultSandbox: no-sandbox',
      'maxWorkers: 4',
      'maxIterations: 100',
      'roles:',
      '  implementer:',
      '    provider: claude-code',
      '    sandbox: no-sandbox',
      'pipelines:',
      '  implement:',
      '    sandbox: no-sandbox',
      '    kind: composite',
      '    nodes:',
      '      work:',
      '        kind: loop',
      '        mode: parallel',
      '        max: 4',
      '        each: $.executionContexts',
      '        node:',
      '          kind: git.worktree',
      '          nodes:',
      '            implement:',
      '              kind: agent.pi',
      '              role: implementer',
      '              prompt: $INPUT',
    ].join('\n'));

    const commands = new Map();
    const events = new Map();
    const widgets = [];
    let firstRunStartedWidget;
    agentWorkflows({
      registerCommand(name, spec) { commands.set(name, spec); },
      on(name, handler) { events.set(name, handler); },
      registerTool() {},
    }, {
      work: {
        plan: async () => ({ query: 'parallel', iterations: [{ supportsParallel: true, items: [
          { id: 'wi-1', title: 'First', tags: [], sourcePath: 'backlog/wi-1.md' },
          { id: 'wi-2', title: 'Second', tags: [], sourcePath: 'backlog/wi-2.md' },
        ] }] }),
      },
      pipeline: {
        now: () => 1700000006000,
        createWorktree: async () => ({
          branch: 'sandcastle/implement',
          worktreePath: join(cwd, '.pi/sandcastle/worktrees/implement'),
          close: async () => ({}),
          run: async () => {
            if (!firstRunStartedWidget) firstRunStartedWidget = widgets.at(-1)?.lines || [];
            return { iterations: [], commits: [{ sha: 'impl-sha' }], branch: 'sandcastle/implement', stdout: '', logFilePath: join(cwd, 'log.txt') };
          },
        }),
        loadSandboxProvider: async (kind) => ({ kind }),
      },
    });

    const ctx = { cwd, ui: { notify() {}, setWidget(id, lines) { widgets.push({ id, lines }); } } };
    await events.get('session_start')?.({}, ctx);
    await commands.get('work:process').handler('parallel', ctx);

    assert.match(firstRunStartedWidget[0], /^Execution workers: 2/);
    const implementerRows = firstRunStartedWidget.filter((line) => /running\s+implementer/.test(line));
    assert.equal(implementerRows.length, 2);
    assert.ok(firstRunStartedWidget.some((line) => /wi-1|started step/.test(line)));
    assert.ok(firstRunStartedWidget.some((line) => /wi-2|started step/.test(line)));
    assert.equal(firstRunStartedWidget.some((line) => /iter 0\/100: started step/.test(line)), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('work:process selects pipeline deterministically and writes durable run records', () => {
  const { calls, records, notifications } = runBacklogProcessFixture();
  const byQuery = new Map(records.map((record) => [record.query, record]));

  const expectedCalls = [
    { query: 'review', pipeline: 'simple-loop', items: ['00008', '00009'], parallel: true },
    { query: 'auth bugs', pipeline: 'implement', items: ['00008'], parallel: false },
    { query: 'label:small', pipeline: 'review', items: ['00008'], parallel: false },
  ];
  assert.equal(calls.length, expectedCalls.length);

  for (const [index, expectedCall] of expectedCalls.entries()) {
    assert.deepEqual(calls[index].query, expectedCall.query);
    assert.equal(calls[index].pipeline, expectedCall.pipeline);
    assert.deepEqual(calls[index].items, expectedCall.items);
    assert.equal(calls[index].parallel, expectedCall.parallel);
  }

  assert.equal(records.length, expectedCalls.length);
  assertBacklogRunRecord(byQuery.get('auth bugs'), {
    pipeline: 'implement',
    resolvedItems: 1,
    branchItemIds: ['00008'],
    branches: ['branch-00008'],
    logs: ['log-00008.txt'],
  });
  assertBacklogRunRecord(byQuery.get('label:small'), {
    pipeline: 'review',
    resolvedItems: 1,
    branchItemIds: ['00008'],
    branches: ['branch-00008'],
    logs: ['log-00008.txt'],
  });
  assertBacklogRunRecord(byQuery.get('review'), {
    pipeline: 'simple-loop',
    resolvedItems: 2,
    branchItemIds: ['00008', '00009'],
    branches: ['branch-00008', 'branch-00009'],
    logs: ['log-00008.txt', 'log-00009.txt'],
  });

  assert.ok(notifications.some((entry) => entry.type === 'success'));
});
