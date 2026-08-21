import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('dv4sandcastle view prints the issue and its parent PRD material', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(process.execPath, ['.sandcastle/dv4sandcastle.mjs', 'view', '00006'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.match(output, /backlog\/00006-readonly-backlog-list-and-inspect\.md/);
  assert.match(output, /Read-only Backlog List and Inspect/);
  assert.match(output, /docs\/prd\/sandcastle-backlog-processing\.md/);
  assert.match(output, /PRD: Sandcastle-backed backlog processing commands for Pi/);
  assert.match(output, /backlog\/00001-sandcastle-backlog-processing-command-surface-prd\.md/);
  assert.match(output, /Sandcastle Backlog Processing Command Surface PRD/);
});
