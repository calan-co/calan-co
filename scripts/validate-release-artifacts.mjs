#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

const catalogPath = resolve(process.cwd(), process.argv[2] ?? 'release-artifacts.yaml');

function fail(message) {
  console.error(`release-artifacts validation failed: ${message}`);
  process.exit(1);
}

function rejectUnknownFields(record, allowedFields, location) {
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) {
      fail(`${location}.${field} is not allowed by the schema`);
    }
  }
}

function isNormalizedRepositoryRelativePosixPath(path) {
  return path !== '.' &&
    !path.includes('\\') &&
    !posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch (error) {
  fail(`cannot parse ${catalogPath} as JSON-compatible YAML: ${error.message}`);
}

if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
  fail('catalog must be an object');
}
rejectUnknownFields(catalog, new Set(['$schema', 'schemaVersion', 'artifacts']), 'catalog');
if (catalog.schemaVersion !== 1) {
  fail('schemaVersion must be 1');
}
if (!Array.isArray(catalog.artifacts)) {
  fail('artifacts must be an array');
}

const requiredFields = [
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
const ids = new Set();
const paths = new Set();

for (const [index, artifact] of catalog.artifacts.entries()) {
  const location = `artifacts[${index}]`;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    fail(`${location} must be an object`);
  }
  rejectUnknownFields(artifact, new Set(requiredFields), location);
  for (const field of requiredFields) {
    if (typeof artifact[field] !== 'string' || artifact[field].trim() === '') {
      fail(`${location}.${field} must be a non-empty string`);
    }
  }
  if (!isNormalizedRepositoryRelativePosixPath(artifact.path)) {
    fail(`${location}.path must be a normalized repo-relative POSIX path without traversal`);
  }
  if (artifact.path === 'legacy' || artifact.path.startsWith('legacy/')) {
    fail(`${location}.path must not be under legacy/`);
  }
  if (ids.has(artifact.id)) {
    fail(`duplicate artifact id: ${artifact.id}`);
  }
  if (paths.has(artifact.path)) {
    fail(`duplicate artifact path: ${artifact.path}`);
  }
  ids.add(artifact.id);
  paths.add(artifact.path);
}

console.log(`release-artifacts validation passed (${catalog.artifacts.length} artifact(s))`);
