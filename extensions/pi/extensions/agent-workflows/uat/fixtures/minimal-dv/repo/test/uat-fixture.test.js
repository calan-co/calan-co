import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const knownIds = ['wi-001', 'wi-002', 'wi-003'];

function testLines() {
  if (!existsSync('test.txt')) return [];
  return readFileSync('test.txt', 'utf8').split(/\r?\n/).filter(Boolean);
}

function workItemStatus(id) {
  const padded = id.replace('wi-', '');
  const file = readdirSync('backlog').find((name) => name.startsWith(`${padded}_`) && name.endsWith('.md'));
  if (!file) return undefined;
  const text = readFileSync(`backlog/${file}`, 'utf8');
  return text.match(/^status:\s*(\S+)/m)?.[1];
}

test('UAT fixture file reflects every completed AFK work item', () => {
  const lines = testLines();
  for (const line of lines) assert.match(line, /^wi-00[123]$/);
  assert.deepEqual([...new Set(lines)], lines, 'test.txt should not contain duplicate work item lines');
  if (lines.length > 0) assert.equal(lines[0], 'wi-001', 'the unblocked first wave should be first');

  const completedIds = knownIds.filter((id) => workItemStatus(id) === 'completed');
  for (const id of completedIds) assert.ok(lines.includes(id), `test.txt should contain completed ${id}`);
});
