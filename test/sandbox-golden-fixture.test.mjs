import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const backlogPath = process.env.AGENT_WORKFLOWS_GOLDEN_BACKLOG || path.resolve('extensions/agent-workflows/uat/fixtures/minimal-dv/repo/backlog');

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'markdown work item should have frontmatter');
  const yaml = match[1];
  const id = yaml.match(/^id:\s*(\S+)/m)?.[1];
  const tagsBlock = yaml.match(/^tags:\n((?:\s+-\s+.*\n?)*)/m)?.[1] || '';
  const tags = [...tagsBlock.matchAll(/^\s+-\s+(.+)$/gm)].map((entry) => entry[1].replace(/^['"]|['"]$/g, ''));
  const depsBlock = yaml.match(/^\s+depends_on:\n((?:\s+-\s+.*\n?)*)/m)?.[1] || '';
  const dependsOn = [...depsBlock.matchAll(/^\s+-\s+['"]?(?:\[\[)?(.+?)(?:\]\])?['"]?\s*$/gm)].map((entry) => entry[1]);
  return { id, tags, dependsOn };
}

function dependencyTargetToId(value, byStem) {
  return byStem.get(value)?.id || value;
}

test('sandbox backlog golden fixture manifest matches markdown work items', async (t) => {
  try {
    await fs.access(backlogPath);
  } catch {
    t.skip(`golden backlog path is absent: ${backlogPath}`);
    return;
  }

  const manifest = {
    expectedIds: ['wi-001', 'wi-002', 'wi-003', 'wi-004'],
    hitlIds: ['wi-004'],
    dependencyChain: [
      { itemId: 'wi-002', dependsOn: 'wi-001' },
      { itemId: 'wi-003', dependsOn: 'wi-001' },
    ],
  };
  const entries = await fs.readdir(backlogPath);
  const markdownFiles = entries.filter((name) => name.endsWith('.md')).sort();
  const byId = new Map();
  const byStem = new Map();
  for (const file of markdownFiles) {
    const meta = frontmatter(await fs.readFile(path.join(backlogPath, file), 'utf8'));
    byId.set(meta.id, { ...meta, file });
    byStem.set(file.replace(/\.md$/, ''), { ...meta, file });
  }

  assert.deepEqual([...byId.keys()].sort(), [...manifest.expectedIds].sort());
  assert.deepEqual(manifest.hitlIds.sort(), ['wi-004']);
  for (const id of manifest.hitlIds) assert.ok(byId.get(id).tags.includes('hitl'), `${id} should carry hitl tag`);

  const actualChain = [];
  for (const entry of manifest.dependencyChain) {
    const item = byId.get(entry.itemId);
    assert.ok(item, `missing ${entry.itemId}`);
    const dependencyIds = item.dependsOn.map((dependency) => dependencyTargetToId(dependency, byStem));
    assert.ok(dependencyIds.includes(entry.dependsOn), `${entry.itemId} should depend on ${entry.dependsOn}`);
    actualChain.push(`${entry.itemId}->${entry.dependsOn}`);
  }
  assert.deepEqual(actualChain, ['wi-002->wi-001', 'wi-003->wi-001']);
});
