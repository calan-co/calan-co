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
  assert.equal(record.branches.length, expected.branchItemIds.length);
  for (const itemId of expected.branchItemIds) {
    assert.ok(record.branches.some((branch) => branch.startsWith(`agent-workflows/${expected.pipeline}/`) && branch.endsWith(`/${itemId}`)), `missing orchestrator branch for ${itemId}`);
  }
  assert.deepEqual(record.logs, expected.logs);
  assert.ok(Array.isArray(record.executionContexts));
  assert.equal(record.executionContexts.length, expected.branchItemIds.length);
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
    logs: ['log-00008.txt'],
  });
  assertBacklogRunRecord(byQuery.get('label:small'), {
    pipeline: 'review',
    resolvedItems: 1,
    branchItemIds: ['00008'],
    logs: ['log-00008.txt'],
  });
  assertBacklogRunRecord(byQuery.get('review'), {
    pipeline: 'simple-loop',
    resolvedItems: 2,
    branchItemIds: ['00008', '00009'],
    logs: ['log-00008.txt', 'log-00009.txt'],
  });

  assert.ok(notifications.some((entry) => entry.type === 'success'));
});
