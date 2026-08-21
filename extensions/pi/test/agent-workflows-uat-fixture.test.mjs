import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const fixtureRoot = new URL('../extensions/agent-workflows/uat/fixtures/minimal-dv/', import.meta.url);
const fixtureRepo = new URL('repo/', fixtureRoot);
const runner = new URL('../extensions/agent-workflows/uat/run-minimal-dv-uat.mjs', import.meta.url);

function readFixture(path) {
  return readFileSync(new URL(path, fixtureRepo), 'utf8');
}

test('minimal-dv UAT fixture starts incomplete with one ready AFK wave and one HITL item', async () => {
  const files = await readdir(new URL('backlog/', fixtureRepo));
  assert.deepEqual(files.filter((name) => name.endsWith('.md')).sort(), [
    '001_create_test_txt.md',
    '002_append_serial_a.md',
    '003_append_serial_b.md',
    '004_hitl_custom_setting.md',
  ]);

  assert.match(readFixture('.pi/sandcastle/config.yaml'), /^defaultPipeline: parallel-planner-with-review$/m);
  assert.match(readFixture('backlog/001_create_test_txt.md'), /^status: ready$/m);
  assert.match(readFixture('backlog/002_append_serial_a.md'), /depends_on:\n    - wi-001/);
  assert.match(readFixture('backlog/003_append_serial_b.md'), /depends_on:\n    - wi-001/);
  assert.match(readFixture('backlog/004_hitl_custom_setting.md'), /^status: blocked$/m);
  assert.match(readFixture('backlog/004_hitl_custom_setting.md'), /- hitl/);
  assert.ok(!existsSync(new URL('test.txt', fixtureRepo)), 'baseline must not already contain completed output');
});

test('minimal-dv UAT runner can prepare a disposable git worktree from the fixture', () => {
  const result = spawnSync(process.execPath, [runner.pathname, '--prepare-only'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Prepared minimal-dv UAT worktree:/);
});
