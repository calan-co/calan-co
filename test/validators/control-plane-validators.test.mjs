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
    defaultBranch: 'main',
    defaultSha: '0123456789abcdef0123456789abcdef01234567',
    status: 'eligible-for-import',
    targetPath: 'packages/example',
    exclusions: [],
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

  assert.doesNotMatch(codeowners, /^\/products\/pi-extensions\/\*\*\s+@chris-cald\s*$/m);

  for (const pattern of requiredPatterns) {
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(codeowners, new RegExp(`^${escapedPattern}\\s+@chris-cald\\s*$`, 'm'));
  }
});

test('migration documentation queues history-only imports without active release handling', () => {
  const migrationGuide = readFileSync(join(repositoryRoot, 'migration', 'README.md'), 'utf8');
  const piWorkItem = readFileSync(join(repositoryRoot, 'backlog', 'MIG-001.3-pi-extensions.md'), 'utf8');
  const historyWorkItems = [
    readFileSync(join(repositoryRoot, 'backlog', 'MIG-001.7-templjs-template.md'), 'utf8'),
    readFileSync(join(repositoryRoot, 'backlog', 'MIG-001.8-templjs-temple.md'), 'utf8'),
  ];

  assert.match(migrationGuide, /not evidence that a command was executed or succeeded/);
  assert.match(piWorkItem, /`extensions\/pi`/);
  for (const workItem of historyWorkItems) {
    assert.match(workItem, /Queue the planned read-only history import/);
    assert.match(workItem, /Prohibit active workspace, normal CI, image, and release-artifact handling/);
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

test('artifact baseline validator accepts the checked-in inventory-aligned baseline', () => {
  const result = spawnSync(process.execPath, [
    join(repositoryRoot, 'scripts', 'validate-artifact-baseline.mjs'),
  ], { cwd: repositoryRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /8 source\(s\)/);
});

test('Phase-0 baseline records all authoritative sources without claiming later migration evidence', () => {
  const inventory = JSON.parse(readFileSync(join(repositoryRoot, 'migration', 'inventory.yaml'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(repositoryRoot, 'migration', 'ledger.yaml'), 'utf8'));
  const artifactBaseline = JSON.parse(readFileSync(join(repositoryRoot, 'migration', 'artifact-baseline.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(repositoryRoot, 'release-artifacts.yaml'), 'utf8'));
  const expectedSources = new Map([
    ['doc-vader', { sha: 'a99b753f87b614c39d9ca09b9132c292cb27daf1', targetPath: 'packages/doc-vader' }],
    ['linkity', { sha: '4eacae036f935f987bbe4de18cca36034684c989', targetPath: 'packages/linkity' }],
    ['pi-extensions', { sha: '842f0264043c9b51509d0496c538a5845a0ab8c8', targetPath: 'extensions/pi' }],
    ['babysitter-dv', { sha: '458c9f66f4f3a4472c131244a8932ecd0ca4d31d', targetPath: 'blueprints/babysitter-dv' }],
    ['awx-ee-proxmox', { sha: '579aa7dbc2c721be6542afae531abd2075718ef2', targetPath: 'images/awx-ee-proxmox' }],
    ['templjs', { sha: '64da887f6f26eb18d57d7416e06d3f4a1efbac16', targetPath: 'products/templjs' }],
    ['templjs-template', { sha: '7d14b72c18925e73ab95a495542d07da45e4fe3a', targetPath: 'legacy/template' }],
    ['templjs-temple', { sha: '9fdaed9a03599720473ebae802b2579d5233acac', targetPath: 'legacy/temple' }],
  ]);

  assert.equal(inventory.sources.length, expectedSources.size);
  for (const source of inventory.sources) {
    const expected = expectedSources.get(source.id);
    assert.equal(source.defaultSha, expected.sha, source.id);
    assert.equal(source.targetPath, expected.targetPath, source.id);
    assert.match(source.defaultBranch, /^\S+$/);
    assert.ok(Array.isArray(source.exclusions));
    assert.equal(source.status, ['templjs-template', 'templjs-temple'].includes(source.id)
      ? 'eligible-for-import'
      : source.status);
  }
  for (const migration of ledger.migrations) {
    const expected = expectedSources.get(migration.id);
    assert.equal(migration.targetPath, expected.targetPath, migration.id);
    assert.equal(migration.source, inventory.sources.find(({ id }) => id === migration.id).source, migration.id);
  }
  for (const source of artifactBaseline.sources) {
    assert.ok(Array.isArray(source.sourceDeclaredCommands), source.id);
    assert.ok(!('verifiedSourceCommands' in source), source.id);
  }
  assert.deepEqual(new Set(ledger.migrations.map(({ source }) => source)),
    new Set(inventory.sources.map(({ source }) => source)));
  for (const migration of ledger.migrations) {
    assert.equal(migration.state, 'queued');
    for (const unavailableLaterStateField of [
      'sourceFreezeDate', 'testCommand', 'adapterEvidence', 'parityEvidence',
      'stagingReceipt', 'rollbackTarget', 'archiveEvidence',
    ]) {
      assert.ok(!(unavailableLaterStateField in migration), `${migration.id}.${unavailableLaterStateField}`);
    }
  }
  assert.equal(catalog.artifacts.length, 0);
  assert.deepEqual(new Set(artifactBaseline.sources.map(({ id }) => id)), new Set(expectedSources.keys()));
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
    sources: [{ ...allowedInventory.sources[0], source: 'https://github.com/calan-co' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete GitHub HTTPS repository URL/);
});

test('migration ledger validator rejects inventory records without an authoritative SHA', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [],
  }, {
    ...allowedInventory,
    sources: [{ ...allowedInventory.sources[0], defaultSha: 'not-a-sha' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /defaultSha.*40-character Git commit SHA/);
});

test('migration ledger validator rejects non-normalized inventory target paths', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [],
  }, {
    ...allowedInventory,
    sources: [{ ...allowedInventory.sources[0], targetPath: '../packages/example' }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /targetPath.*normalized repo-relative POSIX path/);
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

test('migration ledger validator binds a record id to its authoritative inventory source', () => {
  const inventory = {
    ...allowedInventory,
    sources: [
      ...allowedInventory.sources,
      {
        ...allowedInventory.sources[0],
        id: 'other-source',
        source: 'https://github.com/calan-co/other-source',
        targetPath: 'packages/other',
      },
    ],
  };
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({ id: 'other-source' })],
  }, inventory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source must match inventory record for id/);
});

test('migration ledger validator binds a record target path to its authoritative inventory record', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({ targetPath: 'packages/not-example' })],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /targetPath must match inventory record for id/);
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

test('migration ledger validator rejects later-state evidence on queued records', () => {
  const result = validateLedger({
    schemaVersion: 1,
    migrations: [importedRecord({ state: 'queued' })],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be recorded while state is queued/);
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
