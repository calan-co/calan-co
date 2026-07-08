import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildBacklogPlan,
  formatBacklogPlan,
  parsePlanArgs,
} from '../extensions/pi-sandcastle/backlog-planner.mjs';

async function makeBacklogRepo(items) {
  const root = await mkdtemp(join(tmpdir(), 'pi-backlog-plan-'));
  const backlogDir = join(root, 'backlog');
  await mkdir(backlogDir, { recursive: true });

  for (const item of items) {
    await writeFile(join(backlogDir, item.fileName), item.content);
  }

  return root;
}

function cleanupRepo(t, repo) {
  t.after(() => rm(repo, { recursive: true, force: true }));
}

function backlogItem({ id, title, summary, status = 'ready', priority = 'medium', estimated = 1, tags = [], dependsOn = [], body = '' }) {
  const dependsOnYaml = dependsOn.length === 0
    ? '[]'
    : `\n    - ${dependsOn.join('\n    - ')}`;

  return `---
id: wi-${id}
title: ${title}
summary: ${summary}
status: ${status}
priority: ${priority}
estimated: ${estimated}
tags: [${tags.join(', ')}]
links:
  depends_on:${dependsOnYaml}
---

${body || `Goal for ${title}.`}
`;
}

test('parsePlanArgs keeps query text separate from documented iteration flags', () => {
  const parsed = parsePlanArgs('auth bugs --iterations 3 --dry-run');

  assert.equal(parsed.query, 'auth bugs --dry-run');
  assert.equal(parsed.iterations, 3);
});

test('buildBacklogPlan groups by dependency depth and preserves read-only behavior', async (t) => {
  const repo = await makeBacklogRepo([
    {
      fileName: '00001-root.md',
      content: backlogItem({
        id: '00001',
        title: 'Root item',
        summary: 'Documentation and analysis work',
        tags: ['docs'],
        body: 'This item should fit the analysis pipeline.',
      }),
    },
    {
      fileName: '00002-child.md',
      content: backlogItem({
        id: '00002',
        title: 'Child item',
        summary: 'Implementation work that depends on root',
        tags: ['implementation'],
        dependsOn: ['[[00001-root]]'],
        body: 'This item should remain blocked until root is handled.',
      }),
    },
    {
      fileName: '00003-grandchild.md',
      content: backlogItem({
        id: '00003',
        title: 'Grandchild item',
        summary: 'Follow-on implementation',
        tags: ['implementation'],
        dependsOn: ['[[00002-child]]'],
        body: 'This item is the second blocked step.',
      }),
    },
  ]);
  cleanupRepo(t, repo);

  const before = await readdir(join(repo, 'backlog'));
  const plan = await buildBacklogPlan(repo, '--iterations 2');
  const after = await readdir(join(repo, 'backlog'));
  const rendered = formatBacklogPlan(plan);
  const nextPlan = await buildBacklogPlan(repo, '--iterations 1', { iterations: 1 });
  const directPlan = await buildBacklogPlan(repo, '', { iterations: 1 });

  assert.deepEqual(after, before);
  assert.equal(plan.requestedIterations, 2);
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.groups[0].items[0].numericId, '00001');
  assert.match(rendered, /Iteration 1/);
  assert.match(rendered, /Dependency notes:/);
  assert.match(rendered, /Overall recommended pipelines:/);
  assert.deepEqual(nextPlan, directPlan);
});

test('buildBacklogPlan keeps dependency layers intact across iterations', async (t) => {
  const repo = await makeBacklogRepo([
    {
      fileName: '00001-root-a.md',
      content: backlogItem({
        id: '00001',
        title: 'Root A',
        summary: 'First ready item',
        tags: ['docs'],
      }),
    },
    {
      fileName: '00002-root-b.md',
      content: backlogItem({
        id: '00002',
        title: 'Root B',
        summary: 'Second ready item',
        tags: ['docs'],
      }),
    },
    {
      fileName: '00003-root-c.md',
      content: backlogItem({
        id: '00003',
        title: 'Root C',
        summary: 'Third ready item',
        tags: ['docs'],
      }),
    },
    {
      fileName: '00004-child.md',
      content: backlogItem({
        id: '00004',
        title: 'Blocked child',
        summary: 'Depends on the ready layer',
        tags: ['implementation'],
        dependsOn: ['[[00001-root-a]]'],
      }),
    },
  ]);
  cleanupRepo(t, repo);

  const plan = await buildBacklogPlan(repo, '--iterations 2');

  assert.equal(plan.groups.length, 2);
  assert.deepEqual(
    plan.groups[0].items.map((item) => item.numericId),
    ['00001', '00002', '00003'],
  );
  assert.deepEqual(
    plan.groups[1].items.map((item) => item.numericId),
    ['00004'],
  );
});

test('buildBacklogPlan respects query filtering without mutating the tree', async (t) => {
  const repo = await makeBacklogRepo([
    {
      fileName: '00010-alpha.md',
      content: backlogItem({
        id: '00010',
        title: 'Alpha backlog task',
        summary: 'Match alpha',
        tags: ['alpha'],
      }),
    },
    {
      fileName: '00011-beta.md',
      content: backlogItem({
        id: '00011',
        title: 'Beta backlog task',
        summary: 'Match beta',
        tags: ['beta'],
      }),
    },
  ]);
  cleanupRepo(t, repo);

  const plan = await buildBacklogPlan(repo, 'alpha');
  const files = await readdir(join(repo, 'backlog'));

  assert.equal(plan.matchedCount, 1);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].items[0].numericId, '00010');
  assert.deepEqual(files.sort(), ['00010-alpha.md', '00011-beta.md']);
});
