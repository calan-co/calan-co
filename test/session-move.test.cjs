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

const mod = jiti(join(__dirname, '..', 'extensions', 'session-move', 'index.ts'));

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

async function testCommandParsingDefaultsAndSplitUx() {
  assert.deepEqual(mod.parseSessionSubcommand('turns'), { kind: 'turns', sessionToken: undefined, query: undefined, json: false, pick: false });
  assert.deepEqual(mod.parseSessionSubcommand('turns 019f4e16 --json'), { kind: 'turns', sessionToken: '019f4e16', query: undefined, json: true, pick: false });
  assert.deepEqual(mod.parseSessionSubcommand('move ~/dev/pi-extensions --dry-run'), { kind: 'move', sessionToken: undefined, targetDir: '~/dev/pi-extensions', splitRequested: false, continuePolicy: undefined, dryRun: true, createTarget: false, mergeTarget: false });
  assert.deepEqual(mod.parseSessionSubcommand('move 019f4e16 ~/dev/pi-extensions --create'), { kind: 'move', sessionToken: '019f4e16', targetDir: '~/dev/pi-extensions', splitRequested: false, continuePolicy: undefined, dryRun: false, createTarget: true, mergeTarget: false });
  assert.deepEqual(mod.parseSessionSubcommand('split --turn 12'), { kind: 'split', sessionToken: undefined, turnRef: '12', continuePart: undefined, dryRun: false });
  assert.deepEqual(mod.parseSessionSubcommand('split 019f4e16 --turn 12 --continue tail --dry-run'), { kind: 'split', sessionToken: '019f4e16', turnRef: '12', continuePart: 'tail', dryRun: true });
  assert.throws(() => mod.parseSessionSubcommand('move current ~/x --turn 12'), /Split is now a separate command/);
  assert.throws(() => mod.parseSessionSubcommand('split --turn 12 --continue target'), /head, tail/);
}

async function testMutationSafetyGateRequiresIdleForAllMutations() {
  await assert.rejects(() => mod.runSessionMutationSafetyGate({ ctx: {}, sessionFile: '/tmp/s.jsonl', isCurrent: false, operation: 'move' }), /idle\/quiescence/);
  let waited = false;
  const result = await mod.runSessionMutationSafetyGate({ ctx: { waitForIdle: async () => { waited = true; }, hasPendingMessages: () => false }, sessionFile: '/tmp/s.jsonl', isCurrent: false, operation: 'split' });
  assert.equal(waited, true);
  assert.equal(result.skipped, false);
  await assert.rejects(() => mod.runSessionMutationSafetyGate({ ctx: { waitForIdle: async () => {}, hasPendingMessages: () => true }, sessionFile: '/tmp/s.jsonl', isCurrent: false, operation: 'move' }), /pending messages/);
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

async function testDryRunReportIncludesHonchoComparisonData() {
  const transcript = sampleMessages();
  const report = mod.buildHonchoDryRunReport({
    expectedMessages: transcript,
    sourceExists: true,
    targetExists: true,
    mergeTarget: true,
    sourceMessages: [{ peerId: transcript[0].peerId, content: transcript[0].content, createdAt: transcript[0].createdAt }],
    targetMessages: [{ peerId: 'pi', content: 'existing target', createdAt: '2026-01-01T00:00:00.000Z' }],
  });
  const text = report.lines.join('\n');
  assert.match(text, /Source Honcho exists: yes/);
  assert.match(text, /Target Honcho exists: yes/);
  assert.match(text, /Pi transcript migratable messages: 2/);
  assert.match(text, /Transcript messages matched in source Honcho: 1/);
  assert.match(text, /Transcript messages missing from source Honcho: 1/);
  assert.match(text, /Execution approval needed: none \(--merge supplied\)/);
}

async function testSourceMissingTranscriptMessageUsesPiPayloadAndDoesNotBlock() {
  const transcript = sampleMessages();
  const sourceMessages = [{ peerId: transcript[0].peerId, content: transcript[0].content, createdAt: '2026-01-01T00:10:00.000Z' }];
  const aligned = mod.alignMigratedPayloadToSource(transcript, sourceMessages);
  assert.equal(aligned.missingCount, 1);
  assert.equal(aligned.messages[0].createdAt, '2026-01-01T00:10:00.000Z');
  assert.equal(aligned.messages[1].createdAt, transcript[1].createdAt);
  const honcho = new MockHoncho({ source: { metadata: {}, configuration: {}, messages: sourceMessages } });
  const written = await mod.writeHonchoTargetFromTranscript({ honcho, key: 'target', sourceKey: 'source', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } }, messages: aligned.messages, migrationId: 'm1', sourceCwd: '/a', targetCwd: '/b' });
  const finalized = await mod.finalizeHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } }, expectedTargetCount: 2, expectedMessages: aligned.messages, expectedTargetMessages: written.expectedTargetMessages, migrationStartedAt: '2026-01-01T01:00:00.000Z' });
  assert.equal(finalized.sourceMissingCount, 1);
  assert.equal(honcho.sessionsMap.has('source'), false);
}

async function testMergeSkipsAlreadyPresentTargetPayload() {
  const transcript = sampleMessages();
  const sourceMessages = transcript.map((m) => ({ peerId: m.peerId, content: m.content, createdAt: m.createdAt }));
  const honcho = new MockHoncho({
    source: { metadata: {}, configuration: {}, messages: sourceMessages },
    target: { metadata: {}, configuration: {}, messages: [{ peerId: transcript[0].peerId, content: transcript[0].content, createdAt: transcript[0].createdAt }] },
  });
  const written = await mod.writeHonchoTargetFromTranscript({ honcho, key: 'target', sourceKey: 'source', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } }, messages: transcript, migrationId: 'm1', sourceCwd: '/a', targetCwd: '/b', mergeTarget: true });
  assert.equal(written.validation.targetAlreadyPresentMigratedCount, 1);
  assert.equal(written.validation.targetMigratedAddedCount, 1);
  assert.deepEqual(honcho.sessionsMap.get('target').messages.map((m) => m.content), ['hello', 'hi']);
}

async function testMergeExistingTargetPreservesTargetAndPartitionsSource() {
  const transcript = sampleMessages();
  const sourceMessages = [
    { peerId: 'macos', content: 'unrelated source memory', createdAt: '2026-01-01T00:00:00.500Z' },
    { peerId: transcript[0].peerId, content: transcript[0].content, createdAt: '2026-01-01T00:10:00.000Z' },
    { peerId: transcript[1].peerId, content: transcript[1].content, createdAt: '2026-01-01T00:10:01.000Z' },
  ];
  const aligned = mod.alignMigratedPayloadToSource(transcript, sourceMessages).messages;
  assert.equal(aligned[0].createdAt, '2026-01-01T00:10:00.000Z');
  const honcho = new MockHoncho({
    source: { metadata: {}, configuration: {}, messages: sourceMessages },
    target: { metadata: {}, configuration: {}, messages: [{ peerId: 'pi', content: 'existing target memory', createdAt: '2026-01-01T00:05:00.000Z' }] },
  });
  const written = await mod.writeHonchoTargetFromTranscript({ honcho, key: 'target', sourceKey: 'source', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } }, messages: aligned, migrationId: 'm1', sourceCwd: '/a', targetCwd: '/b', mergeTarget: true });
  assert.equal(written.count, 3);
  const finalized = await mod.finalizeHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', config: { peerName: 'macos', hosts: { pi: { aiPeer: 'pi' } } }, expectedTargetCount: 3, expectedMessages: aligned, expectedTargetMessages: written.expectedTargetMessages, migrationStartedAt: '2026-01-01T01:00:00.000Z' });
  assert.equal(finalized.sourceResidualCount, 1);
  assert.equal(honcho.sessionsMap.has('source'), true);
  assert.deepEqual(honcho.sessionsMap.get('source').messages.map((m) => m.content), ['unrelated source memory']);
  assert.deepEqual(honcho.sessionsMap.get('target').messages.map((m) => m.content), ['existing target memory', 'hello', 'hi']);
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
  await assert.rejects(() => mod.finalizeHonchoSourceAfterTargetValidated({ honcho, sourceKey: 'source', targetKey: 'target', config: {}, expectedTargetCount: 2, expectedMessages: msgs, migrationStartedAt: '2026-01-01T00:00:02.500Z' }), /post-migration|missing from target/);
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
  await testCommandParsingDefaultsAndSplitUx();
  await testMutationSafetyGateRequiresIdleForAllMutations();
  await testTranscriptPayload();
  await testSuccessfulRebuildValidatesContentAndDeletesSource();
  await testTargetCountMatchesButContentDiffersSourceRemains();
  await testDuplicateTargetFingerprintSourceRemains();
  await testPostMigrationSourceMessageMissingFromTargetSourceRemains();
  await testTargetExistsRefuses();
  await testDryRunReportIncludesHonchoComparisonData();
  await testSourceMissingTranscriptMessageUsesPiPayloadAndDoesNotBlock();
  await testMergeSkipsAlreadyPresentTargetPayload();
  await testMergeExistingTargetPreservesTargetAndPartitionsSource();
  await testManifestTransitions();
  console.log('session-move tests ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
