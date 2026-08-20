import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function validate(scriptName, document) {
  const directory = mkdtempSync(join(tmpdir(), 'calan-co-validator-'));
  const fixturePath = join(directory, 'fixture.yaml');
  writeFileSync(fixturePath, JSON.stringify(document));

  try {
    return spawnSync(process.execPath, [join(repositoryRoot, 'scripts', scriptName), fixturePath], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('release artifact validator accepts the empty bootstrap catalog', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [],
  });

  assert.equal(result.status, 0, result.stderr);
});

test('release artifact validator rejects duplicate artifact paths', () => {
  const artifact = {
    id: 'example-package',
    path: 'packages/example-package',
    owner: 'release-owner',
    versionSource: 'package.json',
    adapter: 'npm',
    target: 'registry-decision-required',
    environment: 'environment-decision-required',
    dryRunCommand: 'pnpm pack --dry-run',
    publishCommand: 'pnpm publish',
    receiptCommand: 'record-receipt',
    rollbackCommand: 'promote-prior-version',
  };
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [artifact, { ...artifact, id: 'duplicate-path' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate artifact path/i);
});

test('migration ledger validator accepts the empty bootstrap ledger', () => {
  const result = validate('validate-migration-ledger.mjs', {
    schemaVersion: 1,
    migrations: [],
  });

  assert.equal(result.status, 0, result.stderr);
});

test('migration ledger validator requires staging evidence before cut-over', () => {
  const result = validate('validate-migration-ledger.mjs', {
    schemaVersion: 1,
    migrations: [{
      id: 'example-source',
      source: 'https://github.com/example/source',
      targetPath: 'packages/example',
      owner: 'migration-owner',
      artifacts: ['example-package'],
      state: 'cut-over',
      sourceFreezeDate: '2026-08-20',
      rollbackTarget: 'example-package@1.0.0',
      parityEvidence: 'https://example.invalid/parity',
    }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stagingReceipt/);
});
