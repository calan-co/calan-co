#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function read(path) {
  return readFileSync(path, 'utf8');
}

function frontmatter(path) {
  const text = read(path);
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} has frontmatter`);
  const data = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_$-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return { data, text };
}

function assertAllChecked(path, text, section) {
  const re = new RegExp(`## ${section}\\n\\n([\\s\\S]*?)(?:\\n## |$)`);
  const match = text.match(re);
  assert.ok(match, `${path} has ${section}`);
  assert.doesNotMatch(match[1], /- \[ \]/, `${path} has no unchecked ${section}`);
  assert.match(match[1], /- \[x\]/, `${path} has checked ${section}`);
}

function newestWorkProcessRecord() {
  const dir = '.pi/sandcastle/runs';
  assert.ok(existsSync(dir), 'unified run records directory exists');
  const records = readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => join(dir, entry))
    .filter((path) => {
      try { return JSON.parse(read(path)).kind === 'work-process'; }
      catch { return false; }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  assert.ok(records.length > 0, 'at least one authoritative Work Process run record exists');
  return JSON.parse(read(records[0]));
}

assert.ok(existsSync('test.txt'), 'test.txt exists');
const lines = read('test.txt').split(/\r?\n/).filter(Boolean);
assert.equal(lines[0], 'wi-001', 'test.txt starts with the unblocked first wave');
assert.equal(new Set(lines).size, 3, 'test.txt has one line per completed AFK item');
for (const id of ['wi-001', 'wi-002', 'wi-003']) assert.ok(lines.includes(id), `test.txt contains ${id}`);

for (const id of ['001', '002', '003']) {
  const files = readdirSync('backlog').filter((name) => name.startsWith(`${id}_`) && name.endsWith('.md'));
  assert.equal(files.length, 1, `found backlog item ${id}`);
  const path = join('backlog', files[0]);
  const { data, text } = frontmatter(path);
  assert.equal(data.status, 'completed', `${data.id} status is completed`);
  assert.equal(data.status_reason, 'completed', `${data.id} status_reason is completed`);
  assertAllChecked(path, text, 'Tasks');
  assertAllChecked(path, text, 'Acceptance Criteria');
}

const hitl = frontmatter('backlog/004_hitl_custom_setting.md');
assert.equal(hitl.data.status, 'blocked', 'wi-004 remains blocked');
assert.match(hitl.text, /- hitl/, 'wi-004 is tagged hitl');

const record = newestWorkProcessRecord();
assert.equal(record.status, 'done', 'authoritative Work Process run record status is done');
assert.equal(record.kind, 'work-process', 'authoritative run record is a Work Process');
assert.equal(record.pipeline, 'parallel-planner-with-review', 'UAT uses the comprehensive implementation/review/close/merge pipeline');
const recordText = JSON.stringify(record);
for (const id of ['wi-001', 'wi-002', 'wi-003']) assert.match(recordText, new RegExp(id), `run record mentions completed ${id}`);

console.log('UAT PASS: wi-001 through wi-003 completed and merged; wi-004 skipped as HITL.');
