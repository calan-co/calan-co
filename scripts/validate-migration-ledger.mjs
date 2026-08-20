#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

const ledgerPath = resolve(process.cwd(), process.argv[2] ?? 'migration/ledger.yaml');
const inventoryPath = resolve(process.cwd(), process.argv[3] ?? 'migration/inventory.yaml');
const catalogPath = resolve(process.cwd(), process.argv[4] ?? 'release-artifacts.yaml');
const states = new Set([
  'queued',
  'history-imported',
  'imported',
  'parity-verified',
  'staging-released',
  'cut-over',
  'archived',
  'blocked',
]);
const phaseZeroStates = new Set([
  'imported',
  'parity-verified',
  'staging-released',
  'cut-over',
  'archived',
]);
const inventorySchema = '../schema/migration-inventory.schema.json';
const githubRepositoryUrl = /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+$/;
const gitCommitSha = /^[0-9a-f]{40}$/;
const inventoryStatuses = new Set(['eligible-for-import', 'blocked', 'excluded']);
const catalogRequiredFields = [
  'id',
  'path',
  'owner',
  'versionSource',
  'adapter',
  'target',
  'environment',
  'dryRunCommand',
  'publishCommand',
  'receiptCommand',
  'rollbackCommand',
];

function fail(message) {
  console.error(`migration ledger validation failed: ${message}`);
  process.exit(1);
}

function readJsonCompatibleYaml(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path} as JSON-compatible YAML for ${label}: ${error.message}`);
  }
}

function requireString(record, field, location) {
  if (typeof record[field] !== 'string' || record[field].trim() === '') {
    fail(`${location}.${field} must be a non-empty string`);
  }
}

function isNormalizedRepositoryRelativePosixPath(path) {
  return path !== '.' &&
    !path.includes('\\') &&
    !posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function requireDate(record, field, location) {
  requireString(record, field, location);
  const value = record[field];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    fail(`${location}.${field} must be an ISO 8601 date`);
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail(`${location}.${field} must be an ISO 8601 date`);
  }
}

function rejectUnknownFields(record, allowedFields, location) {
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) {
      fail(`${location}.${field} is not allowed by the schema`);
    }
  }
}

function validateInventory(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    fail('inventory must be an object');
  }
  rejectUnknownFields(inventory, new Set(['$schema', 'schemaVersion', 'sources']), 'inventory');
  if (inventory.$schema !== inventorySchema) {
    fail(`inventory.$schema must be ${inventorySchema}`);
  }
  if (inventory.schemaVersion !== 1) {
    fail('inventory.schemaVersion must be 1');
  }
  if (!Array.isArray(inventory.sources)) {
    fail('inventory.sources must be an array');
  }

  const ids = new Set();
  const sources = new Set();
  const recordsById = new Map();
  for (const [index, source] of inventory.sources.entries()) {
    const location = `inventory.sources[${index}]`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      fail(`${location} must be an object`);
    }
    rejectUnknownFields(source, new Set([
      'id', 'source', 'defaultBranch', 'defaultSha', 'status', 'targetPath', 'exclusions',
    ]), location);
    for (const field of ['id', 'source', 'defaultBranch', 'defaultSha', 'status', 'targetPath']) {
      requireString(source, field, location);
    }
    if (!githubRepositoryUrl.test(source.source)) {
      fail(`${location}.source must be a complete GitHub HTTPS repository URL`);
    }
    if (!gitCommitSha.test(source.defaultSha)) {
      fail(`${location}.defaultSha must be a lowercase 40-character Git commit SHA`);
    }
    if (!inventoryStatuses.has(source.status)) {
      fail(`${location}.status must be one of: ${[...inventoryStatuses].join(', ')}`);
    }
    if (!isNormalizedRepositoryRelativePosixPath(source.targetPath)) {
      fail(`${location}.targetPath must be a normalized repo-relative POSIX path without traversal`);
    }
    if (!Array.isArray(source.exclusions) || source.exclusions.some((exclusion) =>
      typeof exclusion !== 'string' || exclusion.trim() === '')) {
      fail(`${location}.exclusions must be an array of non-empty strings`);
    }
    if (ids.has(source.id)) {
      fail(`duplicate inventory source id: ${source.id}`);
    }
    if (sources.has(source.source)) {
      fail(`duplicate inventory source: ${source.source}`);
    }
    ids.add(source.id);
    sources.add(source.source);
    recordsById.set(source.id, source);
  }
  return { recordsById, sources };
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    fail('artifact catalog must be an object');
  }
  rejectUnknownFields(catalog, new Set(['$schema', 'schemaVersion', 'artifacts']), 'artifact catalog');
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.artifacts)) {
    fail('artifact catalog must have schemaVersion 1 and an artifacts array');
  }

  const ids = new Set();
  for (const [index, artifact] of catalog.artifacts.entries()) {
    const location = `artifact catalog artifacts[${index}]`;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      fail(`${location} must be an object`);
    }
    rejectUnknownFields(artifact, new Set(catalogRequiredFields), location);
    for (const field of catalogRequiredFields) {
      requireString(artifact, field, location);
    }
    if (ids.has(artifact.id)) {
      fail(`duplicate artifact catalog id: ${artifact.id}`);
    }
    ids.add(artifact.id);
  }
  return ids;
}

const { recordsById: inventoryRecordsById, sources: inventorySources } =
  validateInventory(readJsonCompatibleYaml(inventoryPath, 'inventory'));
const catalogArtifactIds = validateCatalog(readJsonCompatibleYaml(catalogPath, 'artifact catalog'));
const ledger = readJsonCompatibleYaml(ledgerPath, 'ledger');

if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
  fail('ledger must be an object');
}
rejectUnknownFields(ledger, new Set(['$schema', 'schemaVersion', 'migrations']), 'ledger');
if (ledger.schemaVersion !== 1) {
  fail('schemaVersion must be 1');
}
if (!Array.isArray(ledger.migrations)) {
  fail('migrations must be an array');
}

const ids = new Set();
const sourceUrls = new Set();
for (const [index, record] of ledger.migrations.entries()) {
  const location = `migrations[${index}]`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail(`${location} must be an object`);
  }
  rejectUnknownFields(record, new Set([
    'id', 'source', 'targetPath', 'owner', 'artifacts', 'state', 'sourceFreezeDate',
    'historyImportEvidence', 'testCommand', 'adapterEvidence', 'parityEvidence', 'stagingReceipt',
    'rollbackTarget', 'archiveEvidence',
  ]), location);
  for (const field of ['id', 'source', 'targetPath', 'owner', 'state']) {
    requireString(record, field, location);
  }
  if (!inventorySources.has(record.source)) {
    fail(`${location}.source must be in the migration inventory allowlist`);
  }
  const inventoryRecord = inventoryRecordsById.get(record.id);
  if (!inventoryRecord) {
    fail(`${location}.id must match an authoritative inventory record`);
  }
  if (record.source !== inventoryRecord.source) {
    fail(`${location}.source must match inventory record for id: ${record.id}`);
  }
  if (record.targetPath !== inventoryRecord.targetPath) {
    fail(`${location}.targetPath must match inventory record for id: ${record.id}`);
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0 ||
      record.artifacts.some((artifact) => typeof artifact !== 'string' || artifact.trim() === '')) {
    fail(`${location}.artifacts must be a non-empty array of strings`);
  }
  if (!states.has(record.state)) {
    fail(`${location}.state must be one of: ${[...states].join(', ')}`);
  }
  if (ids.has(record.id)) {
    fail(`duplicate migration id: ${record.id}`);
  }
  if (sourceUrls.has(record.source)) {
    fail(`duplicate migration source: ${record.source}`);
  }
  ids.add(record.id);
  sourceUrls.add(record.source);

  if (record.state === 'queued') {
    for (const field of [
      'sourceFreezeDate', 'historyImportEvidence', 'testCommand', 'adapterEvidence',
      'parityEvidence', 'stagingReceipt', 'rollbackTarget', 'archiveEvidence',
    ]) {
      if (field in record) {
        fail(`${location}.${field} must not be recorded while state is queued`);
      }
    }
  }

  if (record.state === 'history-imported') {
    if (!record.targetPath.startsWith('legacy/')) {
      fail(`${location}.targetPath must be under legacy for a history-only import`);
    }
    requireDate(record, 'sourceFreezeDate', location);
    requireString(record, 'rollbackTarget', location);
    requireString(record, 'historyImportEvidence', location);
  }

  if (phaseZeroStates.has(record.state)) {
    requireDate(record, 'sourceFreezeDate', location);
    requireString(record, 'rollbackTarget', location);
    requireString(record, 'testCommand', location);
    requireString(record, 'adapterEvidence', location);
    for (const artifact of record.artifacts) {
      if (!catalogArtifactIds.has(artifact)) {
        fail(`${location}.artifacts must reference artifact IDs in the artifact catalog: ${artifact}`);
      }
    }
  }

  const needsParityEvidence = new Set(['parity-verified', 'staging-released', 'cut-over', 'archived']);
  const needsStagingReceipt = new Set(['staging-released', 'cut-over', 'archived']);
  if (needsParityEvidence.has(record.state)) {
    requireString(record, 'parityEvidence', location);
  }
  if (needsStagingReceipt.has(record.state)) {
    requireString(record, 'stagingReceipt', location);
  }
  if (record.state === 'archived') {
    requireString(record, 'archiveEvidence', location);
  }
}

console.log(`migration ledger validation passed (${ledger.migrations.length} migration(s))`);
