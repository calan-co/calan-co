import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocVaderWorkSourceAdapter, createDocVaderWorkSourceHooks } from '../extensions/agent-workflows/work-source-adapters.mjs';

test('Doc-Vader Work Source adapter defaults to current Doc-Vader work command surface', async () => {
  const calls = [];
  const adapter = createDocVaderWorkSourceAdapter({
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'ok', stderr: '' };
    },
  });

  await adapter.validate({ itemId: 'wi-123', cwd: '/repo', runId: 'run-1' });
  await adapter.close({ itemId: 'wi-123', cwd: '/repo', runId: 'run-1' });

  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ['node', ['.sandcastle/dv4sandcastle.mjs', 'validate', 'wi-123']],
    ['node', ['.sandcastle/dv4sandcastle.mjs', 'close', 'wi-123']],
  ]);
});

test('Doc-Vader Work Source adapter builds validate and close callouts with run metadata', async () => {
  const calls = [];
  const adapter = createDocVaderWorkSourceAdapter({
    validateCommand: 'dv work validate {{ id }} --run {{ runId }}',
    closeCommand: 'dv work close {{ itemId }} --cwd {{ cwd }}',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'ok', stderr: '' };
    },
  });

  await adapter.validate({ itemId: 'wi-123', cwd: '/repo', runId: 'run-1' });
  await adapter.close({ itemId: 'wi-123', cwd: '/repo', runId: 'run-1' });

  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ['dv', ['work', 'validate', 'wi-123', '--run', 'run-1']],
    ['dv', ['work', 'close', 'wi-123', '--cwd', '/repo']],
  ]);
  assert.equal(calls[0].options.cwd, '/repo');
  assert.equal(calls[0].options.itemId, 'wi-123');
  assert.equal(calls[0].options.runId, 'run-1');
});

test('Doc-Vader Work Source adapter surfaces command failures without DV diagnosis', async () => {
  const adapter = createDocVaderWorkSourceAdapter({
    runCommand: async () => ({ status: 7, stdout: '', stderr: 'dv said no' }),
  });

  await assert.rejects(
    adapter.validate({ itemId: 'wi-404', cwd: '/repo', runId: 'run-2' }),
    /validate Work Item wi-404 failed: dv said no/,
  );
});

test('Doc-Vader Work Source hooks are retired in favor of explicit mutation graph nodes', async () => {
  assert.deepEqual(createDocVaderWorkSourceHooks(), []);
});
