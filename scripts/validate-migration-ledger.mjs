#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ledgerPath = resolve(process.cwd(), process.argv[2] ?? 'migration/ledger.yaml');
const states = new Set([
  'queued',
  'imported',
  'parity-verified',
  'staging-released',
  'cut-over',
  'archived',
  'blocked',
]);

function fail(message) {
  console.error(`migration ledger validation failed: ${message}`);
  process.exit(1);
}

function requireString(record, field, location) {
  if (typeof record[field] !== 'string' || record[field].trim() === '') {
    fail(`${location}.${field} must be a non-empty string`);
  }
}

function rejectUnknownFields(record, allowedFields, location) {
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) {
      fail(`${location}.${field} is not allowed by the schema`);
    }
  }
}

let ledger;
try {
  ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
} catch (error) {
  fail(`cannot parse ${ledgerPath} as JSON-compatible YAML: ${error.message}`);
}

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
    'parityEvidence', 'stagingReceipt', 'rollbackTarget', 'archiveEvidence',
  ]), location);
  for (const field of ['id', 'source', 'targetPath', 'owner', 'state']) {
    requireString(record, field, location);
  }
  if (!record.source.startsWith('https://github.com/')) {
    fail(`${location}.source must be a GitHub HTTPS URL`);
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

  const needsParityEvidence = new Set(['parity-verified', 'staging-released', 'cut-over', 'archived']);
  const needsStagingReceipt = new Set(['staging-released', 'cut-over', 'archived']);
  const needsCutoverEvidence = new Set(['cut-over', 'archived']);
  if (needsParityEvidence.has(record.state)) {
    requireString(record, 'parityEvidence', location);
  }
  if (needsStagingReceipt.has(record.state)) {
    requireString(record, 'stagingReceipt', location);
  }
  if (needsCutoverEvidence.has(record.state)) {
    requireString(record, 'sourceFreezeDate', location);
    requireString(record, 'rollbackTarget', location);
  }
  if (record.state === 'archived') {
    requireString(record, 'archiveEvidence', location);
  }
}

console.log(`migration ledger validation passed (${ledger.migrations.length} migration(s))`);
