# Session move split engine design notes

Phase: 2 research/design only. This document intentionally does **not** define Honcho mutation. Split transcript execution must remain gated behind Phase 3 Honcho rebuild support.

## Pi JSONL format facts used

Pi session files are JSONL:

1. Line 1 is a `session` header, not part of the tree.
2. Every following entry has `id`, `parentId`, and `timestamp`.
3. Entries form a tree. `parentId: null` denotes a root entry.
4. Pi's `SessionManager` reconstructs the active leaf as the **last non-header entry in file order** when opening a file. It does not persist a separate leaf pointer.
5. LLM context is built by walking `parentId` links from that leaf to root, then extracting message/custom-message/summary entries along that path.
6. File order also affects latest `session_info` and label state because Pi scans entries in file order for latest session title and label changes.
7. Parent references are local to one session file; duplicate entry ids across different session files are acceptable as long as each file is internally unique.
8. `compaction.firstKeptEntryId`, `label.targetId`, and `branch_summary.fromId` are secondary references that must be validated separately from `parentId`.

## Definitions

- **Source file**: inactive Pi JSONL session being split/moved.
- **Target dir**: new cwd scope for the moved/split target session.
- **Active leaf**: the last non-header entry in source file order.
- **Active path**: entries obtained by walking from active leaf to root.
- **Split entry**: resolved user-message entry. It must be on the active path for v1 split.
- **Split parent**: `splitEntry.parentId`, or `null` when splitting at the root.
- **Target subtree**: split entry plus all descendants in the source tree, not just the active-path suffix.
- **Source remainder**: all source entries not in the target subtree.

## Exact split semantics

For `/session move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>]`:

1. A split move is selected when a split turn resolves from `--turn`, a positional turn reference, or trailing natural-language query text. Literal `split from` is not part of the command surface.
2. The split entry belongs to the **target** session.
3. The source session ends immediately before the split entry for active-context purposes.
4. The source keeps all pre-split history and any alternate branches that are not descendants of the split entry.
5. The target gets the split entry and every descendant of that entry, preserving internal branches under the split point.
6. The target does **not** receive ancestors before the split entry. The split entry becomes a root by rewriting only its `parentId` to `null`.
7. All other retained entry ids are preserved. Descendant `parentId` values remain unchanged.
8. v1 rejects split references that are not user-message entries on the active path. This prevents surprising movement of an abandoned branch while leaving the active transcript intact.
9. v1 rejects first and last user turns as split targets because they produce empty or non-useful source/target slices.
10. v1 rejects ambiguous or unsafe secondary references rather than attempting semantic repair:
   - target entry with `compaction.firstKeptEntryId` outside the target set: reject;
   - source entry with `compaction.firstKeptEntryId` inside removed target set: reject;
   - duplicate ids within either output: reject;
   - broken `parentId` after slicing: reject.
11. Label entries are tree entries. A retained label entry whose `targetId` is outside the same output file should be dropped and recorded in the manifest, because it cannot resolve in that output. Do not drop silently.
12. `branch_summary.fromId` is metadata. If it points outside the output, keep the branch summary but record an external reference warning in the manifest. The summary text is already self-contained for context building.

## Active path preservation

Because Pi uses the last non-header JSONL entry as the leaf on open:

- Target active leaf should normally remain the original source active leaf, because split is required to be on the active path and the original leaf is a descendant of the split entry.
- Source active context should end at the split parent. If the split parent is `null`, source has no active conversation entries.
- Do **not** reorder the file just to force the leaf unless unavoidable; file order controls session title and label state.
- If source remainder's last entry is not the desired source leaf, append a `custom` marker entry as the final line:

```json
{
  "type": "custom",
  "id": "<fresh-id>",
  "parentId": "<split-parent-id-or-null>",
  "timestamp": "<migration-time>",
  "customType": "session-move",
  "data": {
    "kind": "split-leaf-marker",
    "migrationId": "...",
    "splitEntryId": "..."
  }
}
```

A custom entry does not participate in LLM context, but it safely makes Pi reopen the file with the intended active context. If split parent is `null`, the marker becomes a root; context remains empty because custom entries are ignored by context building.

Target normally needs no marker. Add one only if validation shows its final retained line is not the original active leaf.

## Header and cwd handling

### Whole-session move

- Preserve header `id`, `timestamp`, `version`, and non-cwd metadata.
- Rewrite only `cwd` to the resolved target directory.
- Move the file under `~/.pi/agent/sessions/--<target-cwd>--/` using the existing filename unless collision occurs.
- If collision occurs, fail before mutation. Do not invent a new filename for whole move unless a future explicit `--rename` option exists.
- Treat `parentSession` as an incoming provenance pointer only. If the moved session itself has `parentSession`, leave it unchanged unless that parent file is also explicitly migrated in a future bulk operation.
- Before moving, scan all Pi session headers under `~/.pi/agent/sessions` for `parentSession` values that resolve to the source session file. These are backlink children of the moved file. Back up and rewrite those child headers to point at the destination session file, or fail the move unless the user explicitly chooses a `--skip-parent-session-backlinks` recovery mode.

### Split move

Source header:

- Preserve the original source header `id`, `timestamp`, `cwd`, and other metadata.
- Rewrite source file in place with source remainder entries.
- Do not add or change `parentSession`.

Target header:

- Create a new session header with a new session id.
- Set `version` to current v3.
- Set `timestamp` to migration creation time.
- Set `cwd` to the resolved target directory.
- Set `parentSession` to the original source file path for provenance. For split move this path remains valid because the source file stays in place. If a future operation later moves the source file, the whole-session backlink repair above must update this target session too.
- Write target file under the target workspace directory with `<migration timestamp>_<new-session-id>.jsonl`.

Target entries:

- Preserve retained entry ids and timestamps.
- Rewrite only `splitEntry.parentId` to `null`.
- Preserve descendant parent links.

## Parent session backlink integrity

`parentSession` is stored as a file path in the child session header when Pi forks/clones/branches a session. Pi currently treats it mostly as provenance, but stale paths break lineage and any feature that later follows the parent pointer.

Integrity rules:

1. Moving a session file changes the canonical path of that session; therefore every other session whose header `parentSession` points to the old path must be considered part of the Pi-side migration set.
2. Matching should compare normalized absolute paths and, when possible, `realpath()` values. If the old parent path no longer exists, fall back to exact normalized string comparison only.
3. Child session headers should be rewritten from old source path to new destination path after each child file is backed up.
4. A split move does not relocate the source file, so no existing backlink updates are needed. The new target session's `parentSession` points to the still-existing source file.
5. If backlink children are found but cannot be backed up or rewritten, abort before moving the parent session file.
6. Manifest and recovery data must include all rewritten child headers so stale backlinks can be audited or restored.

## Backup and write protocol

Every mutation creates a manifest first under:

```text
~/.pi/agent/session-migrations/<migration-id>.json
```

Recommended `migration-id`: UTC timestamp safe for filenames plus short hash of source path and split id, e.g. `2026-07-10T20-00-00-000Z_ab12cd34`.

Protocol:

1. Resolve and validate source session file, target dir, target workspace, split entry, backlink child sessions, and all graph invariants.
2. Write manifest with `status: "planned"`.
3. Copy source file and all backlink child session files to the migration backup directory; record SHA-256, bytes, and paths.
4. Update manifest to `status: "pi_backed_up"`.
5. Prepare source, target, and backlink-child JSONL/header text in memory.
6. Validate generated JSONL by reparsing and checking graph/reference invariants.
7. For split: write target file with exclusive create (`wx`) or temp file + atomic rename, never clobber.
8. For split: rewrite source via temp file in same directory + atomic rename. For whole move: rewrite source header cwd, move source to destination, then rewrite backlink child headers from old path to destination path.
9. Update manifest to `status: "pi_written"`.
10. Stop here until Phase 3 exists. Command path must report that Honcho rebuild is not implemented and therefore split execution is blocked unless running in a future integrated mode.

Failure policy:

- Before `pi_written`: leave source untouched or restore from backup if a partial temp write escaped.
- After `pi_written` but before Honcho rebuild in future phases: keep backups and manifest; print exact restore commands.
- Never delete backups automatically.

## Manifest shape

```ts
type SessionMoveManifest = {
  schemaVersion: 1;
  migrationId: string;
  operation: "move" | "split-move";
  status:
    | "planned"
    | "pi_backed_up"
    | "pi_written"
    | "honcho_rebuilt"
    | "complete"
    | "failed";
  createdAt: string;
  updatedAt: string;

  sourceSessionFile: string;
  targetSessionFile?: string;
  sourceCwd: string;
  targetCwd: string;
  sourceSessionId: string;
  targetSessionId?: string;

  sourceHonchoKey?: string;
  targetHonchoKey?: string;

  split?: {
    requestedTurnRef: string;
    splitEntryId: string;
    splitTurnId: number;
    splitParentId: string | null;
    sourceActiveLeafBefore: string | null;
    sourceActiveLeafAfter: string | null;
    targetActiveLeafAfter: string | null;
    splitEntryBelongsTo: "target";
    targetRootEntryId: string;
  };

  counts: {
    originalEntries: number;
    sourceEntries?: number;
    targetEntries?: number;
    sourceMessages?: number;
    targetMessages?: number;
  };

  backups: Array<{
    role: "source-original" | "target-preexisting" | "parent-session-child-original";
    path: string;
    sha256: string;
    bytes: number;
  }>;

  parentSessionBacklinks?: Array<{
    childSessionFile: string;
    childSessionId?: string;
    oldParentSession: string;
    newParentSession: string;
    status: "planned" | "rewritten" | "skipped";
  }>;

  droppedEntries?: Array<{
    id: string;
    type: string;
    reason: string;
  }>;

  warnings?: string[];
  errors?: Array<{
    at: string;
    message: string;
    stack?: string;
  }>;

  recovery?: {
    restoreSourceCommand?: string;
    removeTargetCommand?: string;
    notes: string[];
  };
};
```

## Safe helper code added

`session-tree-helpers.ts` contains pure, side-effect-free graph helpers for Phase 2 planning:

- `activeLeafId()` models Pi's reopen behavior by treating the last non-header entry as the active leaf.
- `pathIdsToRoot()` walks and validates active paths.
- `descendantIds()` selects the target subtree rooted at the split entry.
- `validateParentLinks()` catches orphaned `parentId` references.
- `buildSplitTreePlan()` applies the semantics above in memory only: split entry to target, target root parent rewrite, external-label drops recorded, compaction reference rejection, branch-summary warnings, and leaf-marker needs reported.

The helper does not read files, write files, create manifests, invoke Pi, or mutate Honcho. It is not wired into command execution yet.

Smoke validation performed against existing local sessions using `/Users/macos/dev/pi-extensions/node_modules/.bin/tsx`:

- Linear session split at first user turn: source 3 entries, target 101 entries, no marker needed, no drops/warnings.
- Branched session split near active tail: original 206 entries, source 174 entries, target 32 entries, active leaf preserved, no drops/warnings.

## Validation strategy

Static validations before writing:

- Header type is `session` and has `id` and `cwd`.
- Every non-header entry has unique `id` and valid `parentId` shape.
- Original file has no orphaned `parentId` unless an explicit future repair mode exists.
- Active leaf is computed as last non-header entry.
- Split entry exists, is `type: "message"`, `message.role: "user"`, lies on active path, and is not the first or last user turn.
- Source and target output each have internally unique ids.
- Every retained non-root `parentId` exists in the same output.
- Target split entry has `parentId: null`.
- No retained compaction references an entry outside its output.
- Label entries with external targets are dropped and recorded, then validation verifies remaining labels resolve.

Runtime validations after writing:

- Reparse generated source and target files from disk.
- Open each file with Pi's `SessionManager.open` in a small Node/tsx validation script if package exports allow it; otherwise JSONL graph validation is mandatory.
- Non-mutating Pi startup check: `pi --session <target-file> --list-models` or equivalent command that loads the session and exits without appending.
- Verify `SessionManager.open(target).getLeafId()` equals target active leaf and source leaf equals source marker id or split parent as designed.
- Verify target header cwd equals target dir and source header cwd remains original cwd.
- Verify target file path is under target workspace directory.
- Verify Honcho is not mutated in Phase 2. Future integrated validation must compare Honcho message counts to transcript slices before marking `complete`.

## Pseudocode sketch

```ts
function planSplit(session, splitEntryId, targetDir) {
  const activeLeaf = lastEntryId(session.entries);
  const activePath = pathToRoot(activeLeaf);
  assert(activePath.has(splitEntryId));
  assert(isUserMessage(session.byId.get(splitEntryId)));

  const targetIds = descendantsOf(splitEntryId);
  const sourceEntries = session.entries.filter(e => !targetIds.has(e.id));
  const targetEntries = session.entries
    .filter(e => targetIds.has(e.id))
    .map(e => e.id === splitEntryId ? { ...e, parentId: null } : e);

  dropExternalLabels(sourceEntries);
  dropExternalLabels(targetEntries);
  rejectBrokenCompactions(sourceEntries);
  rejectBrokenCompactions(targetEntries);

  const sourceLeaf = session.byId.get(splitEntryId)?.parentId ?? null;
  const targetLeaf = activeLeaf;

  if (lastEntryId(sourceEntries) !== sourceLeaf) {
    sourceEntries.push(makeLeafMarker(sourceLeaf));
  }
  if (lastEntryId(targetEntries) !== targetLeaf) {
    targetEntries.push(makeLeafMarker(targetLeaf));
  }

  validateGraph(sourceEntries);
  validateGraph(targetEntries);

  return { sourceEntries, targetEntries, sourceLeaf, targetLeaf };
}
```
