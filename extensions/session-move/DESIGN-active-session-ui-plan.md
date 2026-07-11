# Phase 4-5 design: active-session support and UI plan

Date: 2026-07-10
Scope: research/design only; no runtime command behavior changed.

## Design updates from review

- `/session move` must support both `current` and an explicit session id/file.
- `current` is the only valid way to operate on the currently running active session.
- If an explicit session resolves to an active session, the move must fail rather than silently treating it as inactive.
- `split from` is not part of the command surface. A split point is supplied positionally, with a Pi-consistent flag, or by trailing natural-language query text.
- `/session move` and `/session turns` should reason over query text following positional arguments and attempt to resolve it to a turn id.
- Extension `/session` overloading should only handle exact extension subcommands (`move`, `turns`). Any other `/session ...` form must fall through to built-in behavior or other extensions where technically possible.
- Fallback command surface, if needed, should be `/session:*` (for example `/session:move`, `/session:turns`), not hyphenated commands.
- Do not add fallback commands if compatibility tests prove `/session move` and `/session turns` overloading works with correct fallthrough behavior.
- First and last turns should be deemphasized in UI and disallowed as split targets because the net result would be a zero-length or non-useful session slice.
- Do not support `--continue new`.
- For current-session operations, prompt between continuing in the source/current session or target session when no continuation flag is supplied.
- Honcho-specific rebuild should sit behind a generic memory-session split seam.

## Recommended command surface

Preferred commands:

```text
/session move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target]
/session turns [current|session-id|session-file] [query text...] [--json] [--pick]
```

Examples:

```text
/session move current ~/ 12
/session move current ~/ --turn 12
/session move current ~/ my turn starting with "What happens when"
/session turns current What happens when
/session turns current --pick
```

Fallback commands only if overload/fallthrough compatibility fails:

```text
/session:move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target]
/session:turns [current|session-id|session-file] [query text...] [--json] [--pick]
```

Do not expose literal `split from`. A move becomes a split move when a split turn resolves from:

1. `--turn <turn-ref>`;
2. a positional turn reference after target dir;
3. trailing natural-language query text that resolves to one turn.

If no split turn is supplied/resolved, the command is a whole-session move.

## `/session` overload strategy

The ideal behavior is:

- `/session` exact: built-in session info.
- `/session move ...`: session-move extension.
- `/session turns ...`: session-move extension.
- `/session anything-else ...`: fall through to built-in/future handlers/other extensions where possible.

Current Pi docs/source show two relevant mechanisms:

- `registerCommand("session")` handles a matched slash command before `input` hooks and cannot naturally fall through after it matches.
- The `input` event can inspect raw text and return `{ action: "handled" }` only when the extension owns the input, or `{ action: "continue" }` otherwise.

Therefore, the recommended implementation path is to use the `input` hook for preferred `/session move ...` and `/session turns ...` overloads, not `registerCommand("session")`, unless future Pi adds command-handler fallthrough. The input hook should match only the exact subcommand token after `/session`:

```text
^/session\s+(move|turns)(\s|$)
```

For non-matching `/session ...`, return continue and do not mutate editor/session state.

Compatibility test before adding fallback commands:

1. Load a minimal extension with only the input hook.
2. Verify exact `/session` still opens built-in info.
3. Verify `/session move ...` is intercepted and handled.
4. Verify `/session turns ...` is intercepted and handled.
5. Verify unknown `/session xyz` is not handled by this extension.
6. Only if any preferred command cannot be reliably handled, register `/session:move` and `/session:turns` fallbacks.

## Turn resolver UX

`/session turns` should serve as both listing and resolver.

Default output should show the active branch/path only, with split eligibility:

```text
Turn  Rel   Entry     Eligible  Time                  Preview
1     -12   a1b2c3d4  no        2026-07-10 15:22     "Initial prompt..."     # would create empty source
2     -11   e5f6a1b2  yes       2026-07-10 15:35     "What happens when..."
...
12    -1    c0ffee12  no        2026-07-10 20:01     "Latest request..."     # would create empty target
```

Display rules:

- First and last user turns are dim/deemphasized.
- Ineligible turns remain visible so users understand numbering and why a ref cannot be used.
- Eligible turns are normal/high-confidence rows.
- Query matches should highlight or rank matching rows.
- Ambiguous query matches should return a short ranked list and ask for a more specific ref.

Accepted turn references:

- absolute user turn id: `12`
- relative user turn id: `-3`
- entry id prefix/full id: `c0ffee12`
- quoted or unquoted natural-language query text: `my turn starting with "What happens when"`

Resolver precedence:

1. `--turn <ref>` if present;
2. first positional token after target dir if it is syntactically a turn ref;
3. remaining trailing text as semantic/fuzzy query;
4. no split if nothing resolves.

A resolved first/last turn must fail validation even if it matches exactly.

## What “active branch” means

Pi sessions are stored as a tree of entries. The active branch, more precisely the active path, is the chain of entries from the current leaf back to the root. It is the transcript Pi uses to build the current LLM context.

Implications of limiting v1 split resolution to the active path:

- The listed turn ids match the conversation the user is currently continuing.
- Split output is less surprising because it affects the visible/current context rather than an abandoned branch.
- Query text cannot silently select a matching turn from an inactive alternate branch.
- If a query matches only inactive branches, report that the match is outside the active path and suggest using `/tree` first.

Future `--all` or tree-aware mode can expose inactive branches, but it needs explicit UX for branch identity and split semantics. It should not be part of the initial active-session support.

## Active-session move policy

### Current split move

Allowed:

```text
/session move current <target-dir> <turn-ref-or-query>
```

Required safety flow:

1. Resolve `current` from `ctx.sessionManager.getSessionFile()`.
2. Resolve target dir and split turn.
3. `await ctx.waitForIdle()`.
4. Refuse if `ctx.hasPendingMessages()` remains true.
5. If `ctx.ui.getEditorText()` is non-empty, ask the user to keep/cancel/clear before proceeding.
6. Validate split turn is on the active path and is not first/last eligible boundary.
7. Build full dry-run plan: Pi slices, memory-session split plan, backups, manifest.
8. Ask confirmation with source/target file paths, cwd changes, split turn preview, and memory-session actions.
9. Execute Pi + memory-session migration under manifest/backups.
10. Continue according to `--continue source|target`, or prompt if omitted.

Prompt when `--continue` is omitted:

```text
Continue in:
- source/current session
- target split session
```

No `new` option.

### Current whole-session move

There is no fundamental reason current whole-session move cannot use the same lifecycle-safe approach. It should be allowed if implemented with replacement semantics, not by mutating the active file and continuing with stale in-memory state.

Allowed:

```text
/session move current <target-dir>
```

Required flow is the same as split move, except no turn resolution/slice validation. After rewriting header/moving the file and moving/rekeying the memory session, call `ctx.switchSession(destFile, { withSession })` so the running Pi process is bound to the moved file and cwd.

### Explicit session move

Allowed only when the resolved session is not active.

```text
/session move <session-id|session-file> <target-dir> [<turn-ref-or-query>]
```

Rules:

- If the explicit session resolves to the current process's active session, fail with guidance to use `current`.
- If Pi exposes or creates reliable session locks, check them and fail if another process owns the file.
- If no reliable cross-process active-session detection exists, document the limitation and prefer a conservative lock file in the migration protocol for sessions touched by this extension.
- No continuation prompt is needed for inactive explicit moves unless a future `--switch` option is added.

## Memory-session split seam

Pi transcript splitting should depend on a generic memory-session seam rather than direct Honcho operations:

```ts
interface MemorySessionSplitProvider {
  name: string;
  planMove(input: MemoryMovePlanInput): Promise<MemoryMovePlan>;
  planSplit(input: MemorySplitPlanInput): Promise<MemorySplitPlan>;
  execute(plan: MemoryMovePlan | MemorySplitPlan): Promise<MemoryExecutionResult>;
  validate(plan: MemoryMovePlan | MemorySplitPlan): Promise<MemoryValidationResult>;
  recoveryNotes(plan: MemoryMovePlan | MemorySplitPlan, error: unknown): string[];
}
```

Honcho becomes one provider behind this seam. Benefits:

- command UX stays independent of Honcho naming;
- dry-run can report memory actions generically;
- future memory extensions can participate without changing split/move syntax;
- Pi file mutation can remain gated on memory-session plan validation.

## UI affordances

### Primary: `/session turns`

Prioritize a compact, copyable table. It is deterministic, works in TUI/RPC/print modes, and avoids decorating historical chat rows.

### Interactive inspector: `/session turns --pick`

Use `ctx.ui.custom()` with `SelectList` in TUI mode. This command is an inspection/navigation aid, not a move shortcut. It must not execute, prefill, or print a `/session move` command as its primary behavior.

The picker should:

- show only active-path user turns by default;
- visually dim first/last ineligible turns and mark them as ineligible;
- allow ineligible turns to be inspected, but never allow them to be selected as split targets from a move flow;
- support fuzzy search over previews;
- on Enter, open an expanded detail view for the highlighted turn, similar in spirit to `/tree` inspection:
  - turn id and relative ref;
  - entry id and parent id;
  - timestamp;
  - eligibility and reason if ineligible;
  - full untruncated user text;
- provide explicit secondary actions from the detail view, such as copying `--turn <entry-id>` or closing with Escape.

Do not treat the current debug-style output (`Turn ... selected`, entry metadata, preview) as final UX. Selection should inspect/expand the turn text, not simply print metadata.

If the goal is to simplify split-move UX, put the picker on `/session move`, for example:

```text
/session move current <target-dir> --pick-turn
/session move --split
```

or prompt with the same picker from `/session move` when a split move needs a turn and no turn ref/query was supplied. In that move-specific picker, first/last ineligible turns must be disabled as split targets.

### Guided `/session move` flow

In UI-capable modes, bare or incomplete `/session move` should become a guided flow instead of only showing usage text:

- missing session: present a session picker, with `current` as the default/top option when a current session file exists;
- selecting `current` in this guided flow must be semantically identical to typing `/session move current ...`; it must not collect later selections and then fail with an error telling the user to use `/session move current`;
- missing target path: prompt for a target directory/path;
- target path UX for MVP should prefer existing Pi path autocomplete if available, or an existing reusable file/directory browser component if one already exists;
- do not build a custom navigable filesystem picker/directory browser for MVP;
- if no autocomplete/browser is available, a plain text prompt is acceptable and should be described as a target path prompt, not a file picker;
- `--split` with no turn ref/query: present the move-specific turn picker;
- incomplete `--continue`: prompt between `source` and `target` when operating on `current`;
- ineligible first/last turns in the move-specific picker: visually dim and disable as split targets.

In non-UI modes, or if `ctx.hasUI` is false, incomplete commands must not block on interactive prompts. They should print/present the current help text and examples instead.

Users may accidentally type `session move` without a leading slash. If the extension sees this through an input hook, it may offer a concise correction (`Use /session move ...`) but must not enter a partially-bound context that later fails with stale command/session state.

### Active current-session completion behavior

After a successful current-session move, the original session runtime must not continue as if its old session/memory context were valid. The command should end the original context cleanly by using Pi's session replacement lifecycle:

- preferred: `ctx.switchSession(destFile, { withSession })` for whole-current moves or target/source continuation after split;
- acceptable fallback if safe replacement is not possible: `ctx.newSession(...)` or `ctx.shutdown()` with a clear recovery/resume instruction.

If `ctx.switchSession(destFile, ...)` is available, prefer it over `/new` or `/quit` because it preserves continuity while rebinding Pi to the moved session file. Do not leave the old runtime active after moving/rekeying its backing Pi or memory session. Errors such as `Document ... not found or does not belong to workspace pi` in the original session indicate stale memory/session context was allowed to keep running after migration.

### Widget/status

A small `ctx.ui.setWidget()` or `setStatus()` can show current leaf / latest user turn id, but should be optional. It is not a substitute for `/session turns`.

### Turn-id gutter/widget feasibility

A true left-gutter for historical built-in messages is not feasible with current public extension APIs:

- `registerMessageRenderer()` applies only to custom messages, not built-in user/assistant rows.
- Built-in chat components for user/assistant rendering are internal.
- `setWidget()` renders above/below the editor, not beside historical transcript rows.
- `ctx.ui.custom()` can show overlays/dialogs, not annotate existing chat rows.
- A custom editor only affects input rendering.

Recommendation: do not attempt a gutter in this extension. Use `/session turns`, `--pick`, and optional status/widget hints.

## Lifecycle hazards

- Active session file mutation without `switchSession()` leaves Pi running with stale `SessionManager` state.
- `registerCommand("session")` may block fallthrough; prefer `input` hook for overloaded `/session` subcommands.
- Queued steer/follow-up messages can append after planning; always wait for idle and recheck pending messages immediately before mutation.
- Editor text may be unsent user intent; confirm before switching/mutating.
- Compaction, tree navigation, or branch summaries can alter entries; validate leaf and source file hash immediately before write.
- First/last split targets produce empty or effectively empty sessions; reject even if resolver matches.
- Honcho/global memory strategies may produce source/target key collision; memory seam must block before Pi writes.
- `pi-session` memory-key strategies based on `Date.now()` are not rediscoverable from cwd alone; require explicit metadata/manifest support or block.
- Cross-process active-session detection may be unavailable; conservative locking or clear limitation text is required.

## Validation strategy

### Command compatibility

- Minimal input-hook extension proves `/session move` and `/session turns` intercept only exact subcommands.
- Exact `/session` still invokes built-in session info.
- Unknown `/session xyz` is not handled by session-move.
- Fallback `/session:move` and `/session:turns` are omitted if preferred overload passes.

### Parser/resolver

- Parse current vs explicit session.
- Parse whole move vs split move without literal `split from`.
- Resolve `--turn 12`, positional `12`, relative `-3`, entry id, and trailing query text.
- Reject ambiguous query matches with ranked candidates.
- Reject first/last turn as split target.

### Active-session lifecycle

- Current split dry-run does not mutate files.
- Current whole move dry-run does not mutate files.
- Current split execute switches to source or target according to selection.
- Current whole move execute switches to moved destination file.
- Non-empty editor and pending messages block or prompt.

### Explicit-session safety

- Explicit session equal to current active file fails with guidance to use `current`.
- Explicit inactive whole move and split move still work.
- If lock detection exists, locked sessions fail.

### UI

- `/session turns` table is readable in narrow and normal terminals.
- Ineligible first/last turns are dimmed and unselectable in picker.
- `/session turns <query>` returns resolved turn or ranked ambiguity list.
- `--json` output is stable for tests and agent consumption.
