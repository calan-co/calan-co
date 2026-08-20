#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baselinePath = resolve(process.cwd(), process.argv[2] ?? 'migration/artifact-baseline.json');
const inventoryPath = resolve(process.cwd(), process.argv[3] ?? 'migration/inventory.yaml');
const shaPattern = /^[0-9a-f]{40}$/;

function fail(message) {
  console.error(`artifact baseline validation failed: ${message}`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path} as JSON-compatible YAML for ${label}: ${error.message}`);
  }
}

function requireString(value, location) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${location} must be a non-empty string`);
  }
}

function requireStringArray(value, location) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail(`${location} must be an array of non-empty strings`);
  }
}

const inventory = readJson(inventoryPath, 'inventory');
const baseline = readJson(baselinePath, 'artifact baseline');
if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
  fail('artifact baseline must be an object');
}
if (baseline.$schema !== '../schema/migration-artifact-baseline.schema.json') {
  fail('artifact baseline has an unexpected $schema');
}
if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.sources)) {
  fail('artifact baseline must have schemaVersion 1 and a sources array');
}
if (!inventory || !Array.isArray(inventory.sources)) {
  fail('inventory must have a sources array');
}

const inventoryById = new Map(inventory.sources.map((source) => [source.id, source]));
const baselineIds = new Set();
for (const [index, source] of baseline.sources.entries()) {
  const location = `sources[${index}]`;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail(`${location} must be an object`);
  }
  const allowedFields = new Set([
    'id', 'defaultSha', 'verifiedSourceCommands', 'observedVersions', 'pending', 'unattested',
  ]);
  for (const field of Object.keys(source)) {
    if (!allowedFields.has(field)) {
      fail(`${location}.${field} is not allowed`);
    }
  }
  for (const field of ['id', 'defaultSha']) {
    requireString(source[field], `${location}.${field}`);
  }
  if (!shaPattern.test(source.defaultSha)) {
    fail(`${location}.defaultSha must be a lowercase 40-character Git commit SHA`);
  }
  requireStringArray(source.verifiedSourceCommands, `${location}.verifiedSourceCommands`);
  requireStringArray(source.pending, `${location}.pending`);
  requireStringArray(source.unattested, `${location}.unattested`);
  if (!Array.isArray(source.observedVersions)) {
    fail(`${location}.observedVersions must be an array`);
  }
  for (const [versionIndex, version] of source.observedVersions.entries()) {
    if (!version || typeof version !== 'object' || Array.isArray(version)) {
      fail(`${location}.observedVersions[${versionIndex}] must be an object`);
    }
    for (const field of Object.keys(version)) {
      if (!['subject', 'path', 'version'].includes(field)) {
        fail(`${location}.observedVersions[${versionIndex}].${field} is not allowed`);
      }
    }
    for (const field of ['subject', 'path', 'version']) {
      requireString(version[field], `${location}.observedVersions[${versionIndex}].${field}`);
    }
  }
  const inventorySource = inventoryById.get(source.id);
  if (!inventorySource) {
    fail(`${location}.id must exist in the inventory`);
  }
  if (inventorySource.defaultSha !== source.defaultSha) {
    fail(`${location}.defaultSha must match the inventory source`);
  }
  if (baselineIds.has(source.id)) {
    fail(`duplicate artifact baseline source id: ${source.id}`);
  }
  baselineIds.add(source.id);
}
for (const id of inventoryById.keys()) {
  if (!baselineIds.has(id)) {
    fail(`artifact baseline is missing inventory source: ${id}`);
  }
}

console.log(`artifact baseline validation passed (${baseline.sources.length} source(s))`);
