#!/usr/bin/env node
/* Deterministic Honcho recovery planner/executor for Pi session 019f4e16-b70b-7b08-b159-8702244b4a52. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { Honcho } = require('/Users/macos/.pi/agent/npm/node_modules/@honcho-ai/sdk/dist/index.js');

const SESSION_ID = '019f4e16-b70b-7b08-b159-8702244b4a52';
const WORKSPACE = 'pi';
const BASE_URL = 'http://localhost:8000';
const SOURCE_KEY = 'dir_macos_109d9ad1';
const TARGET_KEY = 'https___github_com_calan-co_pi-extensions';
const RECOVERED_KEY = 'https___github_com_calan-co_pi-extensions__recovered_019f4e16_b70b';
const MIGRATION_DIR = '/Users/macos/.pi/agent/session-migrations/2026-07-11T03-14-41-134Z_578b30f8';
const MANIFEST_PATH = path.join(MIGRATION_DIR, 'manifest.json');
const ORIGINAL_PI = path.join(MIGRATION_DIR, '2026-07-10T22-12-19-339Z_019f4e16-b70b-7b08-b159-8702244b4a52.jsonl');
const CURRENT_PI = '/Users/macos/.pi/agent/sessions/--Users-macos-dev-pi-extensions--/2026-07-10T22-12-19-339Z_019f4e16-b70b-7b08-b159-8702244b4a52.jsonl';
const MIGRATION_TS = '2026-07-11T03:14:41.134Z';
const DEFAULT_MAX_MESSAGE_LENGTH = 25000;
const AMBIGUOUS_DUPLICATE_THRESHOLD = 5;

const REDACT_PLACEHOLDER = '<REDACTED>';
const CONTINUED_PREFIX = '[continued] ';
const CONTEXTUAL_PATTERNS = [
  { re: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?key|auth[_-]?token|bearer|password|passphrase|private[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?([^\s'\"`,;}{]{8,})['\"]?/gi, label: 'CREDENTIAL' },
  { re: /(?:export\s+)?(?:API_KEY|SECRET_KEY|ACCESS_KEY|AUTH_TOKEN|PASSWORD|PASSPHRASE|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|OPENAI_API_KEY|ANTHROPIC_API_KEY|EXA_API_KEY|HONCHO_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|GITLAB_TOKEN|NPM_TOKEN)\s*=\s*['\"]?([^\s'\"`,;}{]{8,})['\"]?/gi, label: 'ENV_SECRET' },
];
const STANDALONE_PATTERNS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS_KEY' },
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g, label: 'BEARER_TOKEN' },
  { re: /\bgh[ps]_[A-Za-z0-9]{36,}\b/g, label: 'GITHUB_TOKEN' },
  { re: /\bglpat-[A-Za-z0-9\-]{20,}\b/g, label: 'GITLAB_TOKEN' },
  { re: /\bhch-v\d+-[A-Za-z0-9]{20,}\b/g, label: 'HONCHO_KEY' },
  { re: /\bnpm_[A-Za-z0-9]{36,}\b/g, label: 'NPM_TOKEN' },
  { re: /\bxox[bpors]-[A-Za-z0-9\-]{10,}\b/g, label: 'SLACK_TOKEN' },
  { re: /\bsk-[A-Za-z0-9\-]{20,}\b/g, label: 'OPENAI_KEY' },
  { re: /\b[0-9a-f]{64,}\b/gi, label: 'HEX_SECRET' },
];

function parseArgs(argv) {
  const args = { execute: false, dryRun: true, deleteSource: false, verbose: false, replaceRecovered: false, replaceTarget: false };
  for (const a of argv) {
    if (a === '--execute') { args.execute = true; args.dryRun = false; }
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--delete-source') args.deleteSource = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--replace-recovered') args.replaceRecovered = true;
    else if (a === '--replace-target') args.replaceTarget = true;
    else if (a === '--help') { usage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.deleteSource && !args.execute) throw new Error('--delete-source requires --execute');
  return args;
}
function usage() { console.log(`Usage: node ${path.basename(__filename)} [--dry-run] [--verbose] [--execute] [--delete-source]\nDry-run is the default. --execute writes a recovered key by default. --delete-source is destructive and separately gated.`); }
function isoStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizeContent(text) { return String(text ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
function contentHash(items) { return sha(items.map((m) => `${m.peerId}\0${normalizeContent(m.content)}`).join('\n---\n')); }
function bucket(iso) { const d = new Date(iso); if (Number.isNaN(d.getTime())) return 'unknown'; d.setSeconds(0, 0); return d.toISOString(); }
function fingerprint(peerId, content, ts) { return `${peerId}|${sha(normalizeContent(content)).slice(0,16)}|${bucket(ts)}`; }
function sanitizeCredentials(text) { let result = text; for (const {re,label} of CONTEXTUAL_PATTERNS) { re.lastIndex = 0; result = result.replace(re, (m, v) => m.replace(v, `${REDACT_PLACEHOLDER}:${label}`)); } for (const {re,label} of STANDALONE_PATTERNS) { re.lastIndex = 0; result = result.replace(re, `${REDACT_PLACEHOLDER}:${label}`); } return result; }
function stripToolOutput(text) { return text.replace(/```[\w]*\n([\s\S]{500,}?)```/g, (match) => /(?:password|secret|key|token|apikey)\s*[:=]/i.test(match) ? '```\n[tool output redacted — contained potential credentials]\n```' : match); }
function extractText(content) { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; return content.flatMap((e) => { if (typeof e === 'string') return [e]; if (e && typeof e === 'object' && e.type === 'text' && typeof e.text === 'string') return [e.text]; return []; }).join('\n').trim(); }
function findChunkBoundary(search, maxLen) { const p = search.lastIndexOf('\n\n'); if (p > 0) return p + 2; const s = search.lastIndexOf('. '); if (s > 0) return s + 2; const w = search.lastIndexOf(' '); if (w > 0) return w + 1; return maxLen; }
function chunkTextSmart(text, maxLen) { if (text.length <= maxLen) return [text]; const chunks = []; let remaining = text; while (remaining.length > 0) { if (remaining.length <= maxLen) { chunks.push(remaining); break; } const cut = findChunkBoundary(remaining.slice(0, maxLen), maxLen); chunks.push(remaining.slice(0, cut)); remaining = remaining.slice(cut); } return chunks.map((c, i) => i === 0 ? c : `${CONTINUED_PREFIX}${c}`); }
function sanitizeMessageText(message) { return sanitizeCredentials(stripToolOutput(extractText(message.content))); }
async function readJsonl(file) { const raw = await fs.readFile(file, 'utf8'); return raw.split(/\n/).filter(Boolean).map((line, i) => { try { return JSON.parse(line); } catch (e) { throw new Error(`${file}:${i+1}: ${e.message}`); } }); }
function transcriptPayload(events, config) {
  const payload = []; let conversationMessageCount = 0; let producibleMessageCount = 0; let latestTimestamp = null;
  for (const event of events) {
    if (event.type !== 'message') continue;
    const msg = event.message;
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
    conversationMessageCount++;
    if (event.timestamp && (!latestTimestamp || new Date(event.timestamp) > new Date(latestTimestamp))) latestTimestamp = event.timestamp;
    const text = sanitizeMessageText(msg);
    if (!text) continue;
    producibleMessageCount++;
    const peerId = msg.role === 'user' ? config.peerName : config.aiPeer;
    for (const chunk of chunkTextSmart(text, config.maxMessageLength)) payload.push({ role: msg.role, peerId, content: chunk, piTimestamp: event.timestamp, piMessageId: event.id });
  }
  return { payload, conversationMessageCount, producibleMessageCount, latestTimestamp };
}
async function readConfig() {
  let file = {}; try { file = JSON.parse(await fs.readFile(path.join(os.homedir(), '.honcho', 'config.json'), 'utf8')); } catch {}
  const host = (file.hosts && file.hosts.pi) || {};
  return { apiKey: process.env.HONCHO_API_KEY || file.apiKey, baseURL: BASE_URL, workspace: WORKSPACE, peerName: process.env.HONCHO_PEER_NAME || file.peerName || os.userInfo().username || 'user', aiPeer: process.env.HONCHO_AI_PEER || host.aiPeer || 'pi', maxMessageLength: Number(process.env.HONCHO_MAX_MESSAGE_LENGTH || host.maxMessageLength || DEFAULT_MAX_MESSAGE_LENGTH), observeMe: host.observeMe ?? true, observeOthers: host.observeOthers ?? true, aiObserveMe: host.aiObserveMe ?? true, aiObserveOthers: host.aiObserveOthers ?? true };
}
async function exportSession(honcho, key, outFile) {
  const session = await honcho.session(key);
  const messages = await (await session.messages({ size: 100 })).toArray();
  let metadata = null, configuration = null, peers = [], peerConfigs = {};
  try { metadata = await session.getMetadata(); } catch (e) { metadata = { exportError: e.message }; }
  try { configuration = await session.getConfiguration(); } catch (e) { configuration = { exportError: e.message }; }
  try { peers = await session.peers(); } catch (e) { peers = []; }
  for (const peer of peers) { try { peerConfigs[peer.id] = await session.getPeerConfiguration(peer); } catch (e) { peerConfigs[peer.id] = { exportError: e.message }; } }
  const data = { exportedAt: new Date().toISOString(), workspace: WORKSPACE, baseURL: BASE_URL, key, metadata, configuration, peers: peers.map((p) => ({ id: p.id, metadata: p.metadata, configuration: p.configuration, createdAt: p.createdAt })), peerConfigs, messages: messages.map((m) => ({ id: m.id, peerId: m.peerId, sessionId: m.sessionId, workspaceId: m.workspaceId, content: m.content, metadata: m.metadata, createdAt: m.createdAt, tokenCount: m.tokenCount })) };
  await fs.writeFile(outFile, JSON.stringify(data, null, 2) + '\n');
  return data;
}
function classifyMessages(messages, expectedPayload, originalPayload, latestPiTs) {
  const expectedByNorm = new Map();
  expectedPayload.forEach((e, idx) => { const k = `${e.peerId}|${normalizeContent(e.content)}`; if (!expectedByNorm.has(k)) expectedByNorm.set(k, []); expectedByNorm.get(k).push({ ...e, idx }); });
  const originalByNorm = new Map();
  originalPayload.forEach((e, idx) => { const k = `${e.peerId}|${normalizeContent(e.content)}`; if (!originalByNorm.has(k)) originalByNorm.set(k, []); originalByNorm.get(k).push({ ...e, idx }); });
  const classified = []; const matchCountByExpected = new Map(); let ambiguous = 0; let newerUnclassified = 0; let newerUnrelatedPreserved = 0;
  for (const m of messages) {
    const k = `${m.peerId}|${normalizeContent(m.content)}`;
    const exp = expectedByNorm.get(k) || [];
    const orig = originalByNorm.get(k) || [];
    const isExpected = exp.length > 0;
    const isOriginal = orig.length > 0;
    let classification = isExpected ? 'session-owned' : 'unrelated-target-existing';
    if (isExpected) {
      if (exp.length > 1) ambiguous++;
      for (const e of exp) matchCountByExpected.set(e.idx, (matchCountByExpected.get(e.idx) || 0) + 1);
    } else if (latestPiTs && new Date(m.createdAt) > new Date(latestPiTs)) newerUnrelatedPreserved++;
    classified.push({ id: m.id, peerId: m.peerId, createdAt: m.createdAt, fingerprint: fingerprint(m.peerId, m.content, isExpected ? exp[0].piTimestamp : m.createdAt), classification, sourceOwned: isOriginal || isExpected });
  }
  const duplicateExpectedIndices = [...matchCountByExpected.values()].filter((n) => n > 1).length;
  const duplicateMessageCount = [...matchCountByExpected.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  return { classified, counts: { sessionOwned: classified.filter((c) => c.classification === 'session-owned').length, unrelated: classified.filter((c) => c.classification === 'unrelated-target-existing').length, duplicateExpectedIndices, duplicateMessageCount, ambiguous, newerUnclassified, newerUnrelatedPreserved } };
}
function classifySource(messages, expectedPayload, originalPayload) {
  const keys = new Set([...expectedPayload, ...originalPayload].map((e) => `${e.peerId}|${normalizeContent(e.content)}`));
  let owned = 0, post = 0;
  for (const m of messages) { if (keys.has(`${m.peerId}|${normalizeContent(m.content)}`)) owned++; if (new Date(m.createdAt) > new Date(MIGRATION_TS)) post++; }
  return { owned, post };
}
async function addPayloadToSession(honcho, key, payload, config) {
  const userPeer = await honcho.peer(config.peerName); const aiPeer = await honcho.peer(config.aiPeer);
  const session = await honcho.session(key);
  await session.addPeers([[userPeer, { observeMe: config.observeMe, observeOthers: config.observeOthers }], [aiPeer, { observeMe: config.aiObserveMe, observeOthers: config.aiObserveOthers }]]);
  const inputs = payload.map((p) => (p.role === 'user' ? userPeer : aiPeer).message(p.content, { createdAt: p.piTimestamp, metadata: { recovery: true, piSessionId: SESSION_ID, piMessageId: p.piMessageId } }));
  for (let i = 0; i < inputs.length; i += 100) await session.addMessages(inputs.slice(i, i + 100));
  return session;
}
async function updateManifest(recoveryPatch) {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  manifest.updatedAt = new Date().toISOString();
  manifest.recovery = { ...(manifest.recovery || {}), ...recoveryPatch };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recoveryDir = path.join(MIGRATION_DIR, `recovery-${isoStamp()}`);
  await fs.mkdir(recoveryDir, { recursive: true });
  const config = await readConfig();
  const honcho = new Honcho({ apiKey: config.apiKey, baseURL: config.baseURL, workspaceId: config.workspace });
  const [origEvents, currEvents] = await Promise.all([readJsonl(ORIGINAL_PI), readJsonl(CURRENT_PI)]);
  const original = transcriptPayload(origEvents, config);
  const current = transcriptPayload(currEvents, config);
  const sourceExportPath = path.join(recoveryDir, `${SOURCE_KEY}.export.json`);
  const targetExportPath = path.join(recoveryDir, `${TARGET_KEY}.export.json`);
  let sourceExport, targetExport;
  const abortReasons = []; const riskFlags = [];
  try { sourceExport = await exportSession(honcho, SOURCE_KEY, sourceExportPath); } catch (e) { abortReasons.push(`source export failed: ${e.message}`); }
  try { targetExport = await exportSession(honcho, TARGET_KEY, targetExportPath); } catch (e) { abortReasons.push(`target export failed: ${e.message}`); }
  let targetClass = { counts: { sessionOwned: 0, unrelated: 0, duplicateMessageCount: 0, duplicateExpectedIndices: 0, ambiguous: 0, newerUnclassified: 0 }, classified: [] };
  let sourceClass = { owned: 0, post: 0 };
  if (targetExport) targetClass = classifyMessages(targetExport.messages, current.payload, original.payload, current.latestTimestamp);
  if (sourceExport) sourceClass = classifySource(sourceExport.messages, current.payload, original.payload);
  if (current.payload.length < current.producibleMessageCount) abortReasons.push('expected payload has fewer chunks than current transcript producible text messages');
  if (targetClass.counts.ambiguous > AMBIGUOUS_DUPLICATE_THRESHOLD) abortReasons.push(`ambiguous target duplicate classification above threshold: ${targetClass.counts.ambiguous}`);
  if (targetClass.counts.newerUnclassified > 0) abortReasons.push(`target contains ${targetClass.counts.newerUnclassified} messages newer than moved Pi transcript that cannot be classified`);
  if (targetClass.counts.newerUnrelatedPreserved > 0) riskFlags.push(`target contains ${targetClass.counts.newerUnrelatedPreserved} newer unrelated messages; preserved by recovered-key plan`);
  if (targetClass.counts.unrelated > 0) riskFlags.push('target-has-unrelated-messages; preserve target untouched and use recovered key');
  if (sourceClass.post > 0) riskFlags.push('source-has-post-migration-messages; do not delete source without manual review');
  const repairMode = targetClass.counts.unrelated > 0 || !args.replaceTarget ? 'recovered-key' : 'replace-target-in-place';
  const operations = repairMode === 'recovered-key'
    ? [`create recovered key ${RECOVERED_KEY}`, 'write expected moved-session payload to recovered key', 'validate recovered key count/hash/no duplicates', 'leave original target key untouched/contaminated', args.deleteSource ? 'delete source key after validation' : 'do not delete source key']
    : [`delete and replace target key ${TARGET_KEY}`, 'write expected moved-session payload to target key', 'validate target key count/hash/no duplicates', args.deleteSource ? 'delete source key after validation' : 'do not delete source key'];
  const plan = { generatedAt: new Date().toISOString(), dryRun: !args.execute, sourceKey: SOURCE_KEY, targetKey: TARGET_KEY, recoveredKey: repairMode === 'recovered-key' ? RECOVERED_KEY : null, workspace: WORKSPACE, baseURL: BASE_URL, sourceExportPath, targetExportPath, originalTranscriptMessageCount: original.conversationMessageCount, currentTranscriptMessageCount: current.conversationMessageCount, expectedRebuiltMovedSessionPayloadCount: current.payload.length, expectedPayloadHash: contentHash(current.payload), targetExistingTotalCount: targetExport ? targetExport.messages.length : 0, targetSessionOwnedCount: targetClass.counts.sessionOwned, targetDuplicateCount: targetClass.counts.duplicateMessageCount, targetDuplicateExpectedIndices: targetClass.counts.duplicateExpectedIndices, targetUnrelatedPreservedCount: targetClass.counts.unrelated, targetNewerUnrelatedPreservedCount: targetClass.counts.newerUnrelatedPreserved, sourceTotalCount: sourceExport ? sourceExport.messages.length : 0, sourceOwnedCount: sourceClass.owned, sourcePostMigrationCount: sourceClass.post, exactOperationsProposed: operations, repairMode, riskFlags, abortReasons, safety: { mutationAllowed: abortReasons.length === 0, destructiveSourceDeletionRequested: args.deleteSource, ambiguousDuplicateThreshold: AMBIGUOUS_DUPLICATE_THRESHOLD }, classificationPaths: { target: path.join(recoveryDir, 'target-classification.json') } };
  await fs.writeFile(plan.classificationPaths.target, JSON.stringify(targetClass.classified, null, 2) + '\n');
  const planPath = path.join(recoveryDir, 'plan.json');
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2) + '\n');
  if (args.verbose) console.log(JSON.stringify(plan, null, 2));
  if (!args.execute) { console.log(`DRY RUN complete. Plan: ${planPath}`); console.log(`Exports: ${sourceExportPath} ${targetExportPath}`); return; }
  if (abortReasons.length) throw new Error(`Refusing execute: ${abortReasons.join('; ')}`);
  const writeKey = repairMode === 'recovered-key' ? RECOVERED_KEY : TARGET_KEY;
  const existing = await (await (await honcho.session(writeKey)).messages({ size: 1 })).toArray();
  if (existing.length > 0) {
    if (repairMode === 'recovered-key' && !args.replaceRecovered) throw new Error(`Recovered key ${writeKey} already has messages; refusing without --replace-recovered`);
    await (await honcho.session(writeKey)).delete();
  }
  await addPayloadToSession(honcho, writeKey, current.payload, config);
  const validationMessages = await (await (await honcho.session(writeKey)).messages({ size: 100 })).toArray();
  const validation = { key: writeKey, count: validationMessages.length, expectedCount: current.payload.length, contentHash: contentHash(validationMessages), expectedPayloadHash: contentHash(current.payload), duplicateFingerprints: 0, ok: false };
  const fps = new Map(); for (const m of validationMessages) { const fp = fingerprint(m.peerId, m.content, m.createdAt); fps.set(fp, (fps.get(fp) || 0) + 1); }
  validation.duplicateFingerprints = [...fps.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  validation.ok = validation.count === validation.expectedCount && validation.contentHash === validation.expectedPayloadHash && validation.duplicateFingerprints === 0;
  if (!validation.ok) throw new Error(`Validation failed for ${writeKey}: ${JSON.stringify(validation)}`);
  if (args.deleteSource) {
    if (sourceClass.post > 0) throw new Error('Refusing source delete: source has post-migration messages');
    await (await honcho.session(SOURCE_KEY)).delete();
  }
  await updateManifest({ status: 'executed', planPath, exports: { source: sourceExportPath, target: targetExportPath }, recoveredKey: repairMode === 'recovered-key' ? writeKey : null, validation, remainingManualCleanup: repairMode === 'recovered-key' ? 'Main target key remains contaminated; source retained unless --delete-source was used. Future per-message cleanup/export-partitioning required.' : (args.deleteSource ? 'none' : 'source retained; delete only after manual confirmation') });
  console.log(`EXECUTE complete. Plan: ${planPath}`);
}
main().catch((e) => { console.error(`ERROR: ${e.stack || e.message}`); process.exit(1); });
