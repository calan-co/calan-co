import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function validate(scriptName, document, dependencies = []) {
  const directory = mkdtempSync(join(tmpdir(), 'calan-co-validator-'));
  const fixturePath = join(directory, 'fixture.yaml');
  writeFileSync(fixturePath, JSON.stringify(document));
  const dependencyPaths = dependencies.map(({ name, document: dependency }) => {
    const dependencyPath = join(directory, name);
    writeFileSync(dependencyPath, JSON.stringify(dependency));
    return dependencyPath;
  });

  try {
    return spawnSync(process.execPath, [
      join(repositoryRoot, 'scripts', scriptName),
      fixturePath,
      ...dependencyPaths,
    ], { encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const releaseArtifact = {
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

const allowedInventory = {
  $schema: '../schema/migration-inventory.schema.json',
  schemaVersion: 1,
  sources: [{
    id: 'example-source',
    source: 'https://github.com/calan-co/example-source',
  }],
};

const catalogWithExampleArtifact = {
  schemaVersion: 1,
  artifacts: [releaseArtifact],
};

function validateLedger(document, inventory = allowedInventory, catalog = catalogWithExampleArtifact) {
  return validate('validate-migration-ledger.mjs', document, [
    { name: 'inventory.yaml', document: inventory },
    { name: 'catalog.yaml', document: catalog },
  ]);
}

function importedRecord(overrides = {}) {
  return {
    id: 'example-source',
    source: 'https://github.com/calan-co/example-source',
    targetPath: 'packages/example',
    owner: 'migration-owner',
    artifacts: ['example-package'],
    state: 'imported',
    sourceFreezeDate: '2026-08-20',
    rollbackTarget: 'example-package@1.0.0',
    testCommand: 'pnpm --dir packages/example test',
    adapterEvidence: 'backlog/MIG-001-migration-control-plane.md#adapter-evidence',
    ...overrides,
  };
}

test('control-plane workspace discovery excludes legacy paths', () => {
  const workspace = readFileSync(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8');

  assert.match(workspace, /^\s*-\s*["']!legacy\/\*\*["']\s*$/m);
  assert.doesNotMatch(workspace, /^\s*-\s*["']legacy(?:\/\*\*)?["']\s*$/m);
});

test('CODEOWNERS assigns the temporary owner to every required migration domain', () => {
  const codeowners = readFileSync(join(repositoryRoot, '.github', 'CODEOWNERS'), 'utf8');
  const requiredPatterns = [
    '/packages/doc-vader/**',
    '/packages/linkity/**',
    '/products/templjs/**',
    '/extensions/pi/**',
    '/blueprints/babysitter-dv/**',
    '/images/awx-ee-proxmox/**',
    '/legacy/**',
  ];

  for (const pattern of requiredPatterns) {
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(codeowners, new RegExp(`^${escapedPattern}\\s+@chris-cald\\s*$`, 'm'));
  }
});

test('release artifact validator accepts the empty bootstrap catalog', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [],
  });

  assert.equal(result.status, 0, result.stderr);
});

test('release artifact validator rejects duplicate artifact paths', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [releaseArtifact, { ...releaseArtifact, id: 'duplicate-path' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate artifact path/i);
});

test('release artifact validator rejects absolute paths', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [{ ...releaseArtifact, path: '/packages/example-package' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repo-relative POSIX path/i);
});

test('release artifact validator rejects traversal into legacy', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [{ ...releaseArtifact, path: 'packages/example-package/../../legacy/template' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repo-relative POSIX path/i);
});

test('release artifact validator rejects non-POSIX paths', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [{ ...releaseArtifact, path: 'packages\\example-package' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repo-relative POSIX path/i);
});

test('release artifact validator rejects legacy paths', () => {
  const result = validate('validate-release-artifacts.mjs', {
    schemaVersion: 1,
    artifacts: [{ ...releaseArtifact, path: 'legacy' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be under legacy/i);
});

test('migration ledger validator accepts the empty bootstrap ledger', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [],
  });

  assert.equal(result.status, 0, result.stderr);
});

test('migration ledger validator rejects an inventory without the authoritative schema URI', () => {
  const { $schema, ...inventoryWithoutSchema } = allowedInventory;
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [],
  }, inventoryWithoutSchema);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inventory\.\$schema/);
});

test('migration ledger validator rejects incomplete inventory repository URLs', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [],
  }, {
    ...allowedInventory,
    sources: [{ id: 'example-source', source: 'https://github.com/calan-co' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete GitHub HTTPS repository URL/);
});

test('migration ledger validator rejects incomplete artifact catalog records', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [],
  }, allowedInventory, {
    schemaVersion: 1,
    artifacts: [{ id: 'example-package' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact catalog artifacts\[0\]\.path/);
});

test('migration ledger validator requires Phase-0 evidence before imported', () => {
  for (const field of ['sourceFreezeDate', 'rollbackTarget', 'testCommand', 'adapterEvidence']) {
    const record = importedRecord();
    delete record[field];
    const result = validateLedger({ schemaVersion: 1, migrations: [record] });

    assert.notEqual(result.status, 0, field);
    assert.match(result.stderr, new RegExp(field));
  }
});

test('migration ledger validator rejects forks outside the inventory allowlist', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({ source: 'https://github.com/calan-co/sandcastle' })],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inventory allowlist/i);
});

test('migration ledger validator rejects excluded special repositories', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({ source: 'https://github.com/calan-co/cicd-shared-pipeline' })],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inventory allowlist/i);
});

test('migration ledger validator rejects artifacts missing from the catalog', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({ artifacts: ['unknown-artifact'] })],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact catalog/i);
});

test('migration ledger validator requires staging evidence before cut-over', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({
      state: 'cut-over',
      parityEvidence: 'https://example.invalid/parity',
    })],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stagingReceipt/);
});
