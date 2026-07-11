const assert = require('node:assert/strict');
const Module = require('node:module');
process.env.NODE_PATH = [
  '/opt/homebrew/Cellar/pi-coding-agent/0.80.3/libexec/lib/node_modules',
  '/opt/homebrew/Cellar/pi-coding-agent/0.80.3/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules',
  process.env.NODE_PATH ?? '',
].filter(Boolean).join(':');
Module._initPaths();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === '@earendil-works/pi-coding-agent') {
    return '/opt/homebrew/Cellar/pi-coding-agent/0.80.3/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
  }
  if (request === '@earendil-works/pi-tui') {
    return '/opt/homebrew/Cellar/pi-coding-agent/0.80.3/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js';
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const { mkdtemp, writeFile, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const createJiti = require('/opt/homebrew/Cellar/pi-coding-agent/0.80.3/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti');
const jiti = createJiti(__filename, { interopDefault: true });

const mod = jiti('/Users/macos/.pi/agent/extensions/session-move/index.ts');

class MockPeer {
  constructor(id) { this.id = id; }
  message(content, options = {}) { return { peerId: this.id, content, metadata: options.metadata ?? {}, createdAt: options.createdAt }; }
}

class MockSession {
  constructor(honcho, id) { this.honcho = honcho; this.id = id; }
  async getMetadata() { return this.honcho.sessionsMap.get(this.id)?.metadata ?? {}; }
  async getConfiguration() { return this.honcho.sessionsMap.get(this.id)?.configuration ?? {}; }
  async messages() { return { toArray: async () => [...(this.honcho.sessionsMap.get(this.id)?.messages ?? [])] }; }
  async addMessages(messages) { this.honcho.sessionsMap.get(this.id).messages.push(...messages); }
  async delete() { this.honcho.sessionsMap.delete(this.id); this.honcho.deleted.push(this.id); }
}

class MockHoncho {
  constructor(initial = {}) { this.sessionsMap = new Map(Object.entries(initial)); this.deleted = []; }
  async sessions() { return { toArray: async () => [...this.sessionsMap.keys()].map((id) => ({ id })) }; }
  async session(id, init = undefined) {
    if (!this.sessionsMap.has(id)) this.sessionsMap.set(id, { metadata: init?.metadata ?? {}, configuration: init?.configuration ?? {}, messages: [], peers: init?.peers ?? [] });
    return new MockSession(this, id);
  }
  async peer(id) { return new MockPeer(id); }
}

async function testKeyDerivation() {
  const cfg = { hosts: { pi: { sessionStrategy: 'per-directory' } }, sessions: {} };
  assert.equal(await mod.deriveHonchoSessionKey('/Users/macos', cfg), 'dir_macos_109d9ad1');
  const target = await mod.deriveHonchoSessionKey('/Users/macos/dev/pi-extensions', { hosts: { pi: { sessionStrategy: 'per-repo' } }, sessions: {} });
  assert.equal(target, 'https___github_com_calan-co_pi-extensions');
}

function sampleMessages() {
  const header = { id: 'sess1', cwd: '/Users/macos', type: 'session' };
  const entries = [
    { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'hello' } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'toolCall', text: 'skip' }] } },
    { type: 'message', id: 't1', parentId: 'a1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'toolResult', content: 'skip' } },
  ];
  return mod.buildWholeSessionRebuildMessages({ header, entries, sessionFile: '/tmp/s.jsonl', migrationId: 'm1', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } } });
}

async function testTranscriptPayload() {
  const msgs = sampleMessages();
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map((m) => [m.peerId, m.content]), [['macos', 'hello'], ['pi', 'hi']]);
  assert.equal(msgs[0].metadata.piEntryId, 'u1');
}

async function testSuccessfulRebuildValidatesContentAndDeletesSource() {
  const msgs = sampleMessages();
  const sourceMessages = msgs.map((m) => ({ peerId: m.peerId, content: m.content, createdAt: m.createdAt }));
  const honcho = new MockHoncho({ source: { metadata: { a: 1 }, configuration: {}, messages: sourceMessages } });
  const written = await mod.writeHonchoTargetFromTranscript({ honcho, key: 'target', sourceKey: 'source', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } }, messages: msgs, migrationId: 'm1', sourceCwd: '/a', targetCwd: '/b' });
  assert.equal(written.count, 2);
  assert.equal(written.validation.expectedHash, written.validation.actualTargetHash);
  await mod.deleteHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', expectedTargetCount: 2, expectedMessages: msgs });
  assert.equal(honcho.sessionsMap.has('source'), false);
  assert.equal(honcho.sessionsMap.get('target').messages.length, 2);
}

async function testTargetExistsRefuses() {
  const honcho = new MockHoncho({ source: { metadata: {}, configuration: {}, messages: [] }, target: { metadata: {}, configuration: {}, messages: [{ peerId: 'x', content: 'existing' }] } });
  await assert.rejects(() => mod.writeHonchoTargetFromTranscript({ honcho, key: 'target', sourceKey: 'source', config: {}, messages: sampleMessages(), migrationId: 'm1', sourceCwd: '/a', targetCwd: '/b' }), /already exists/);
  assert.equal(honcho.sessionsMap.has('source'), true);
}

async function testTargetCountMatchesButContentDiffersSourceRemains() {
  const msgs = sampleMessages();
  const honcho = new MockHoncho({
    source: { metadata: {}, configuration: {}, messages: msgs.map((m) => ({ peerId: m.peerId, content: m.content, createdAt: m.createdAt })) },
    target: { metadata: {}, configuration: {}, messages: [
      { peerId: msgs[0].peerId, content: 'tampered', createdAt: msgs[0].createdAt },
      { peerId: msgs[1].peerId, content: msgs[1].content, createdAt: msgs[1].createdAt },
    ] },
  });
  await assert.rejects(() => mod.deleteHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', expectedTargetCount: 2, expectedMessages: msgs }), /content hash mismatch/);
  assert.equal(honcho.sessionsMap.has('source'), true);
}

async function testDuplicateTargetFingerprintSourceRemains() {
  const msgs = sampleMessages();
  const dup = { peerId: msgs[0].peerId, content: msgs[0].content, createdAt: msgs[0].createdAt };
  const honcho = new MockHoncho({
    source: { metadata: {}, configuration: {}, messages: msgs.map((m) => ({ peerId: m.peerId, content: m.content, createdAt: m.createdAt })) },
    target: { metadata: {}, configuration: {}, messages: [dup, dup] },
  });
  await assert.rejects(() => mod.deleteHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', expectedTargetCount: 2, expectedMessages: msgs }), /duplicate stable fingerprint/);
  assert.equal(honcho.sessionsMap.has('source'), true);
}

async function testPostMigrationSourceMessageMissingFromTargetSourceRemains() {
  const msgs = sampleMessages();
  const sourceMessages = msgs.map((m) => ({ peerId: m.peerId, content: m.content, createdAt: m.createdAt }));
  sourceMessages.push({ peerId: 'macos', content: 'new message after rebuild', createdAt: '2026-01-01T00:00:03.000Z' });
  const honcho = new MockHoncho({
    source: { metadata: {}, configuration: {}, messages: sourceMessages },
    target: { metadata: {}, configuration: {}, messages: msgs.map((m) => ({ peerId: m.peerId, content: m.content, createdAt: m.createdAt })) },
  });
  await assert.rejects(() => mod.deleteHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', expectedTargetCount: 2, expectedMessages: msgs }), /post-migration|missing from target/);
  assert.equal(honcho.sessionsMap.has('source'), true);
}

async function testManifestTransitions() {
  const dir = await mkdtemp(join(tmpdir(), 'session-move-test-'));
  const source = join(dir, 'source.jsonl');
  const dest = join(dir, 'dest.jsonl');
  await writeFile(source, '{"type":"session","id":"s","cwd":"/a"}\n');
  const m = await mod.createMoveManifest({ sessionFile: source, destFile: dest, sourceCwd: '/a', targetDir: '/b', operation: 'move', dryRun: false, sourceHonchoKey: 'source', targetHonchoKey: 'target' });
  assert.equal(m.manifest.status, 'pi_backed_up');
  await mod.writeManifest(m.manifestFile, m.manifest, { status: 'honcho_target_written' });
  await mod.writeManifest(m.manifestFile, m.manifest, { status: 'honcho_source_deleted' });
  await mod.writeManifest(m.manifestFile, m.manifest, { status: 'pi_written' });
  await mod.writeManifest(m.manifestFile, m.manifest, { status: 'complete' });
  const final = JSON.parse(await readFile(m.manifestFile, 'utf8'));
  assert.equal(final.status, 'complete');

  const m2 = await mod.createMoveManifest({ sessionFile: source, destFile: dest, sourceCwd: '/a', targetDir: '/b', operation: 'move', dryRun: false, sourceHonchoKey: 'source', targetHonchoKey: 'target' });
  await mod.writeManifest(m2.manifestFile, m2.manifest, { status: 'honcho_predelete_validated', honchoValidation: { expectedCount: 2, expectedHash: 'a', actualTargetCount: 2, actualTargetHash: 'b', duplicateCount: 0, sourceTotalCount: 3, sourceOwnedPresentCount: 2, sourceMissingCount: 1, postMigrationSourceMessageCount: 1, abortReasons: ['target content hash mismatch'] } });
  await mod.writeManifest(m2.manifestFile, m2.manifest, { status: 'failed', honchoAbortReasons: ['target content hash mismatch'], recovery: { notes: ['restore from backup', `resume ${dest}`] } });
  const failed = JSON.parse(await readFile(m2.manifestFile, 'utf8'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.honchoValidation.expectedCount, 2);
  assert.deepEqual(failed.honchoAbortReasons, ['target content hash mismatch']);
  assert.match(failed.recovery.notes.join('\n'), /restore from backup/);
}

async function main() {
  await testKeyDerivation();
  await testTranscriptPayload();
  await testSuccessfulRebuildValidatesContentAndDeletesSource();
  await testTargetCountMatchesButContentDiffersSourceRemains();
  await testDuplicateTargetFingerprintSourceRemains();
  await testPostMigrationSourceMessageMissingFromTargetSourceRemains();
  await testTargetExistsRefuses();
  await testManifestTransitions();
  console.log('session-move tests ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
