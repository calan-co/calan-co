# Phase 3 design: Honcho rebuild engine for `/session move` split

Date: 2026-07-10
Scope: research/design only; no runtime command behavior changed.

## Problem

A split move rewrites the Pi transcript into two JSONL session slices. Honcho, however, currently stores messages in one computed session key for the original cwd. If Pi files are split without rebuilding Honcho, the source Pi context and Honcho memory diverge: the source key may still contain post-split messages, and the target key may not contain them.

The rebuild engine must make Honcho state match the source/target transcript slices before split support can ship.

## Installed SDK/API constraints

Inspected installed SDK: `/Users/macos/.pi/agent/npm/node_modules/@honcho-ai/sdk`, version `2.2.0`.

Available relevant APIs:

- `new Honcho({ apiKey, baseURL, workspaceId, environment })`
- `honcho.session(id, { metadata?, configuration?, peers? })` get-or-create
- `honcho.sessions({ page, size, filters?, reverse? })`
- `session.delete()` deletes whole session and all messages; irreversible.
- `session.addMessages(peer.message(content, { metadata, configuration, createdAt }))`
- `session.messages({ page, size, reverse, filters })` list only.
- `session.updateMessage(messageOrId, metadata)` metadata-only update.
- `session.clone(messageId?)` exists, but creates a server-chosen new session id and only slices by Honcho message id, not Pi entry id.
- `session.getMetadata()/setMetadata()` and `getConfiguration()/setConfiguration()`.
- `session.peers()`, `session.addPeers()`, `session.setPeers()`, `getPeerConfiguration()`, `setPeerConfiguration()`.
- `peer.getMetadata()/setMetadata()`, `peer.getConfiguration()/setConfiguration()`, but global peer config should generally not be overwritten during a session move.
- Conclusions:
  - `peer.conclusionsOf(target).list({ session, page, size, filters, reverse })`
  - `create([{ content, sessionId }])`
  - `delete(conclusionId)`.
  - Created conclusions do not accept `createdAt` or `level`; only `content` and `sessionId`.

Important limitations:

- No per-message delete endpoint in SDK. The only safe way to remove post-split messages from a Honcho session is delete/recreate the whole session.
- Message create accepts `createdAt`, metadata, and message-level configuration, but cannot preserve original Honcho message ids.
- Conclusions can be moved/copied by content and session id only; their ids, levels, and timestamps cannot be preserved through public SDK create.
- Session `createdAt` cannot be set.
- `session.clone(messageId)` is insufficient for deterministic rebuild because it creates a new session id and depends on matching Pi entries to existing Honcho message ids.
- The package extension `pi-memory-honcho` writes only user/assistant messages from `agent_end`; it sanitizes credentials, strips some tool output, chunks long messages, and does not currently attach Pi entry ids to Honcho metadata.

## Honcho extension behavior to mirror

Inspected installed package: `/Users/macos/.pi/agent/npm/node_modules/pi-memory-honcho` version `0.3.3`.

Session-key derivation lives in `extensions/session.ts`:

1. Explicit `config.sessions[cwd]` wins.
2. Strategies: `global`, `pi-session`, `per-directory`, `per-repo`, `git-branch`.
3. `sessionPeerPrefix` prefixes with `peerName`.

Bootstrap adds exactly two standard peers with session peer configs:

- User peer: `config.peerName` with `{ observeMe, observeOthers }`
- AI peer: `config.aiPeer` with `{ observeMe: aiObserveMe, observeOthers: aiObserveOthers }`

Upload behavior in `extensions/upload.ts`:

- Saves only conversation messages with role `user` or `assistant`.
- Extracts only text blocks from content arrays.
- Sanitizes common credentials.
- Chunks text over `config.maxMessageLength`; continuation chunks get `[continued] ` prefix.
- Does not save tool results or thinking/toolCall blocks.
- In current code, `createdAt` is not explicitly set, so live Honcho timestamps are write-time, not Pi timestamp.

For rebuild consistency, the migration code should reuse/copy these pure helper functions or import them if package exports become stable. Re-implementing differently risks rebuilt Honcho messages differing from live-uploaded messages.

## Design decision: deterministic delete/recreate rebuild

Because per-message delete is unavailable, split move must use whole-session rebuild for any Honcho session whose membership changes.

Recommended algorithm:

1. Build a complete dry-run plan from Pi slices before mutating Honcho.
2. Snapshot source Honcho session data needed for reconstruction:
   - existence
   - session metadata/configuration
   - peers and per-session peer configs
   - existing messages, mainly for validation/diagnostics
   - session-scoped conclusions for all peer pairs in the session, if preserving manually-created/migrated conclusions is desired
3. Construct desired source and target Honcho message arrays from the source/target Pi transcript slices.
4. Create or replace target first using a staging session id, not the final id.
5. Create or replace source using a staging session id.
6. Only after both staged sessions validate, delete final target/source keys as needed and recreate final keys from staged snapshots.
7. Validate final counts and sample hashes.
8. Delete staging sessions.

However, because the SDK cannot rename sessions, staged promotion still requires final-key deletion and recreation. Therefore staging is useful for preflight and recovery, but final cutover remains non-atomic.

Practical v1 ordering:

- For whole-session move: leave source Pi untouched until target Honcho is successfully created/rebuilt. Then move Pi file, then delete source Honcho. This avoids losing source Honcho if Pi move fails.
- For split move: after Pi backups exist but before writing Pi slices, rebuild target Honcho first. Then rebuild source Honcho. Then write Pi slices. If source Honcho rebuild fails, target Honcho may exist but Pi remains unsplit; report target cleanup command and leave manifest.
- If Pi file changes must happen before Honcho rebuild, the command must block completion and print recovery: restore Pi backups or rerun Honcho rebuild with manifest.

Because the workplan requires Honcho support in the same command path and backup/manifest for Pi mutations, the safest user-facing default is:

- `--dry-run`: compute exact keys, message counts, peer configs, and destructive actions; no writes.
- `--execute`: require confirmation of destructive Honcho session delete/recreate.
- Disable split if source or target key strategy is `global` or if computed keys collide.
- Disable split for `pi-session` strategy unless the source key is recorded in manifest or session metadata; current `deriveSessionKey` uses `Date.now()` and cannot rediscover an existing key from cwd alone.

## Source/target transcript slice mapping

Input to rebuild engine should be independent of file-writing:

```ts
interface TranscriptSlice {
  sessionFile: string;
  header: SessionHeader;
  cwd: string;
  entries: PiEntry[]; // excludes header; includes session_info/model/etc.
  messageEntries: PiMessageEntry[]; // role user|assistant after filtering
}
```

Conversion to Honcho messages:

```ts
interface RebuildMessage {
  peerId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}
```

Rules:

- Use only Pi entries where `type === 'message'` and `message.role` is `user` or `assistant`.
- Extract text exactly like `pi-memory-honcho` live upload; ignore thinking/toolCall/toolResult content unless future live upload changes.
- Apply the same credential sanitizer and chunking as live upload.
- Use `entry.timestamp` as `createdAt` when adding rebuilt messages. This improves reconstruction over live upload and is supported by SDK. Note that this will differ from existing Honcho timestamps, but after rebuild they will match Pi transcript chronology.
- Add metadata for traceability:
  - `piSessionId`: header id
  - `piEntryId`: entry id
  - `piParentId`: entry parentId
  - `piCwd`: slice cwd
  - `piRole`: role
  - `piSourceSessionFile`: source path
  - `piMigrationId`: manifest id
  - `piChunkIndex` / `piChunkCount`
  - `rebuiltBy`: `session-move`
- Do not include raw tool outputs or hidden reasoning in metadata.

## Peer/config handling

Canonical peer configs should come from the Honcho extension config, not only from existing source session, because target sessions may be new and the extension will expect these configs on next startup.

Plan:

1. Resolve Honcho config using the same semantics as package `resolveConfig()`:
   - env overrides
   - `~/.honcho/config.json`
   - defaults for `peerName`, `aiPeer`, observation mode, strategy, workspace, environment.
2. Determine standard peers:
   - user peer id = `config.peerName`
   - ai peer id = `config.aiPeer`
3. Desired peer configs:
   - user: `{ observeMe: config.observeMe, observeOthers: config.observeOthers }`
   - ai: `{ observeMe: config.aiObserveMe, observeOthers: config.aiObserveOthers }`
4. Also copy any extra peers found on existing source session with their per-session configs, unless `--strict-peers` is added later.
5. Do not rewrite global peer metadata/configuration by default. Rebuild is session-scoped.
6. Copy session metadata/configuration from existing source to source and target, with migration annotations merged into metadata:
   - `movedFromSessionKey`
   - `splitFromPiEntryId`
   - `sourceCwd`/`targetCwd`
   - `migrationId`

## Conclusions handling

There are three categories:

1. Automatically derived conclusions from messages. Best answer: let Honcho regenerate from rebuilt messages. Do not copy old derived conclusions by default, or they may preserve facts from post-split messages in source.
2. Manual/migrated conclusions scoped to the old session. Existing extension migrates `MEMORY.md`, `USER.md`, `SOUL.md` into `aiPeer.conclusionsOf(userPeer)` with only content and `sessionId`; these may not correspond to individual messages.
3. Global conclusions with `sessionId: null`: do not touch.

Recommended v1:

- Delete/recreate sessions and messages only.
- Do not copy session-scoped conclusions by default.
- Optionally provide `--preserve-conclusions=all|explicit|none` later, default `none` for split safety.
- If preserving, copy only conclusions whose `sessionId === fromKey` to the most conservative destination:
  - whole move: target only, then delete old conclusion.
  - split: source only by default unless user chooses target/all, because content is not attributable to a split turn.
- Manifest must record skipped conclusion counts by observer/observed pair.

## Delete/recreate ordering and recovery

### Preflight

- Resolve source/target Honcho keys.
- Refuse key collision.
- Refuse `global` for split unless user explicitly accepts that split cannot isolate memories.
- Refuse `pi-session` if old source key cannot be recovered.
- List source/target session existence and counts.
- If target exists, default to refuse unless `--replace-target` is provided. Appending would cause inconsistency.
- Wait for Honcho queue status for source key to be idle, or warn/block with `--force`.

### Dry-run output

Include:

- source key, target key, workspace, endpoint/environment
- source slice message count and content hash
- target slice message count and content hash
- source existing Honcho message count
- target existing Honcho message count or absence
- peer ids and configs
- session metadata/config copy plan
- destructive actions: `delete session <key>`
- recovery manifest path

### Execute v1 sequence for split

```text
1. Write manifest status=planned.
2. Backup Pi session file(s); manifest status=pi_backed_up.
3. Build desired source/target Honcho payloads from Pi slices.
4. Rebuild target Honcho final key:
   a. if target exists and replace confirmed, snapshot metadata/config/counts, then delete target.
   b. create target with metadata/config/peers.
   c. add target messages in batches.
   d. validate target count/hash.
5. Rebuild source Honcho final key:
   a. snapshot source metadata/config/peers/counts.
   b. delete source.
   c. create source with metadata/config/peers.
   d. add source messages in batches.
   e. validate source count/hash.
6. Write Pi source and target slices; manifest status=pi_written.
7. Final Honcho validation; manifest status=honcho_rebuilt.
8. Mark complete.
```

Risk: after step 4, target exists while source still contains old messages. This is recoverable by deleting target from manifest if source rebuild fails. After step 5a, if source recreation fails, source Honcho is gone. Mitigation: before deletion, export a JSON backup of source Honcho session into the manifest directory (`source-honcho-backup.json`) containing metadata/config/peer configs/messages/conclusion summaries. Recovery command can recreate old source from that backup.

### Recovery modes

Add a future internal command or helper:

```text
/session move recover <migration-id> --restore-source-honcho
/session move recover <migration-id> --delete-target-honcho
/session move recover <migration-id> --restore-pi-backups
/session move recover <migration-id> --resume

# Or fallback, only if /session overload compatibility fails:
/session:move recover <migration-id> --restore-source-honcho
/session:move recover <migration-id> --delete-target-honcho
/session:move recover <migration-id> --restore-pi-backups
/session:move recover <migration-id> --resume
```

Recovery data must include enough to restore pre-migration source Honcho:

```ts
interface HonchoSessionBackup {
  key: string;
  metadata: Record<string, unknown>;
  configuration: SessionConfig;
  peers: Array<{ id: string; config: SessionPeerConfig }>;
  messages: Array<{ peerId: string; content: string; metadata: Record<string, unknown>; createdAt: string }>;
  conclusions?: Array<{ observerId: string; observedId: string; content: string; sessionId: string | null; level: string; createdAt: string }>;
}
```

## Pseudocode/helper sketch

```ts
async function collectAll<T>(pagePromise: Promise<Page<T>>): Promise<T[]> {
  return await (await pagePromise).toArray();
}

async function sessionExists(honcho: Honcho, key: string): Promise<boolean> {
  return (await collectAll(honcho.sessions({ size: 100 }))).some((s) => s.id === key);
}

async function backupHonchoSession(honcho: Honcho, key: string): Promise<HonchoSessionBackup | null> {
  if (!(await sessionExists(honcho, key))) return null;
  const session = await honcho.session(key);
  const [metadata, configuration, peers, messages] = await Promise.all([
    session.getMetadata(),
    session.getConfiguration(),
    session.peers(),
    collectAll(session.messages({ size: 100 })),
  ]);
  return {
    key,
    metadata,
    configuration,
    peers: await Promise.all(peers.map(async (p) => ({ id: p.id, config: await session.getPeerConfiguration(p) }))),
    messages: messages.map((m) => ({ peerId: m.peerId, content: m.content, metadata: m.metadata, createdAt: m.createdAt })),
  };
}

async function replaceSessionFromPayload(input: {
  honcho: Honcho;
  key: string;
  metadata: Record<string, unknown>;
  configuration: SessionConfig;
  peers: Array<{ id: string; config: SessionPeerConfig }>;
  messages: RebuildMessage[];
  dryRun: boolean;
}): Promise<{ added: number; hash: string }> {
  if (input.dryRun) return { added: input.messages.length, hash: hashMessages(input.messages) };

  if (await sessionExists(input.honcho, input.key)) {
    await (await input.honcho.session(input.key)).delete();
  }

  const peerAddition = input.peers.map((p) => [p.id, p.config] as const);
  const session = await input.honcho.session(input.key, {
    metadata: input.metadata,
    configuration: input.configuration,
    peers: peerAddition,
  });

  const peerCache = new Map<string, Peer>();
  const getPeer = async (id: string) => {
    let p = peerCache.get(id);
    if (!p) {
      p = await input.honcho.peer(id);
      peerCache.set(id, p);
    }
    return p;
  };

  for (let i = 0; i < input.messages.length; i += 50) {
    const batch = await Promise.all(input.messages.slice(i, i + 50).map(async (m) =>
      (await getPeer(m.peerId)).message(m.content, {
        metadata: m.metadata,
        createdAt: m.createdAt,
      })
    ));
    await session.addMessages(batch);
  }

  const rebuilt = await collectAll(session.messages({ size: 100 }));
  assertCountsAndHashes(input.messages, rebuilt);
  return { added: rebuilt.length, hash: hashHonchoMessages(rebuilt) };
}
```

## Validation strategy

Unit-level:

- Feed sample Pi JSONL entries into `buildRebuildMessages()` and assert:
  - only user/assistant text is included
  - toolResult/thinking/toolCall content is excluded
  - chunking matches `pi-memory-honcho` behavior
  - metadata contains Pi ids and chunk indices
  - timestamps come from Pi entry timestamps
- Test key derivation against `pi-memory-honcho/extensions/session.ts` for all strategies except `pi-session`, which should be flagged nondeterministic.

Integration dry-run:

- Run `/session move <session> <target-dir> --turn <ref> --dry-run` (or `/session:move ...` fallback only if needed) and verify no Honcho writes by comparing source/target message counts before/after.
- Dry-run must report exact message counts and hashes for source/target slices.

Integration execute against disposable workspace:

1. Create disposable Honcho workspace id.
2. Create source session with known peers/config/metadata/messages.
3. Build fake Pi transcript with known split point.
4. Execute rebuild only.
5. Assert:
   - source key contains exactly pre-split messages
   - target key contains exactly split-and-after messages
   - both have expected peer configs
   - metadata/configuration copied with migration annotations
   - target/source message `createdAt` values match Pi timestamps
   - no extra target messages when target existed and was replaced

Recovery validation:

- Force failure after source delete using a test hook.
- Verify manifest contains `source-honcho-backup.json` and recovery can recreate original source session.
- Force failure after target rebuild and before source rebuild; verify recovery can delete target and restore Pi backup/no-op.

Operational validation:

- Check Honcho `queueStatus({ session })` before and after rebuild. If queue processing is pending, command should wait boundedly or block with a clear message.
- After command, restart Pi in source and target dirs and confirm the Honcho extension resolves to the same keys that were rebuilt.

## Recommended implementation increments

1. Add pure transcript-to-Honcho-message conversion helpers with tests; no network writes.
2. Add Honcho dry-run planner that prints keys/counts/hashes/destructive actions.
3. Add Honcho backup/export helper.
4. Add replace-session helper behind explicit `execute` flag and disposable-workspace tests.
5. Wire into split command only after Pi split engine and manifest are stable.

