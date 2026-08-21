# Work Plan: `/session move` split + Honcho-consistent migration

## Goal
Enhance the current session-move extension so a session can be moved whole or split from a resolved turn reference, while keeping Pi session storage and Honcho session state consistent.

## Non-negotiable invariants
- Do not ship split transcript support without Honcho rebuild support in the same command path.
- Any operation that mutates Pi session files must have backups and a migration manifest.
- If Honcho rebuild fails after Pi file changes, the command must report a concrete recovery path and preserve backups.
- Preferred `/session move` and `/session turns` overloads must only handle exact extension subcommands; all other `/session ...` input must fall through where technically possible.
- Do not expose literal `split from` in the command surface.
- Do not support `--continue new`; for current-session operations, prompt between source/current and target when omitted.
- First and last user turns are visible but ineligible split targets because they produce empty or non-useful slices.
- Honcho rebuild should be accessed through a generic memory-session split seam.

## Proposed command surface

```text
/session move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target]
/session turns [current|session-id|session-file] [query text...] [--json] [--pick]

# Fallback only if preferred /session overload compatibility fails:
/session:move <current|session-id|session-file> <target-dir> [<turn-ref-or-query>] [--turn <turn-ref>] [--continue source|target]
/session:turns [current|session-id|session-file] [query text...] [--json] [--pick]
```

## Turn references
- Absolute conversational turn id: `15`
- Relative user-turn ref: `-3`
- Stable entry id or prefix: `a1b2c3d4`
- Quoted/fuzzy/natural-language query text: `my turn starting with "What happens when"`

## Phases

### Phase 1 — Command interception and turn resolver
- Determine whether an extension `input` hook can intercept exact `/session move ...` and `/session turns ...` subcommands while allowing exact `/session` and unknown `/session ...` forms to fall through.
- Implement/finalize a parser for the preferred surface; add `/session:*` fallback only if overload compatibility fails.
- Implement `/session turns` list output with stable turn ids, entry ids, eligibility, and first/last-turn deemphasis.
- Implement resolver from absolute, relative, entry-id, and trailing natural-language/fuzzy references to a user-message entry.
- Validation: dry-run examples resolve to the expected eligible entry without mutating files.

### Phase 2 — Pi transcript split/move engine
- Parse Pi JSONL session tree and active path.
- For whole-session move: preserve current behavior with safer manifest/backups.
- For split move: create source and target session JSONL slices with valid headers/cwd.
- Define exact semantics: split entry belongs to target session; source ends before split.
- Preserve entry ids where safe, or document/rewrite parent links if needed.
- Validation: session files load via `pi --session`, no orphaned parent references.

### Phase 3 — Honcho rebuild engine (blocker for split shipping)
- Rebuild source Honcho session from source transcript slice.
- Rebuild target Honcho session from target transcript slice.
- Copy peer configs, metadata/configuration where appropriate.
- Delete/recreate or clear old sessions in a safe order; account for lack of per-message delete.
- Preserve timestamps and metadata when adding messages.
- Validation: source key no longer contains post-split messages; target key contains post-split messages.

### Phase 4 — Active-session support and continuation policy
- Support `current` for split moves and lifecycle-safe whole-session moves.
- Treat `current` as the only valid spelling for the current active session; explicit sessions that are active must fail.
- Ensure current session is idle/quiescent before manipulating files and revalidate source hash/leaf immediately before write.
- After current-session mutation, prefer `ctx.switchSession(movedSessionFile, ...)` / Pi session replacement lifecycle to source/current or target based on `--continue source|target`, or prompt when omitted; if safe replacement is not possible, start a new session or quit with explicit resume instructions rather than leaving the stale original runtime active.
- Validation: active command does not corrupt the running session, replacement context works, and no stale memory/session errors appear in the original context after move.

### Phase 5 — UI affordances
- Add `/session turns` first with eligibility, query resolution, and first/last-turn deemphasis.
- Add `/session turns --pick` as a TUI inspector overlay if feasible: selecting a turn expands/shows full text and metadata, similar in spirit to `/tree`; it must not execute or primarily construct a move command.
- If split-move UX needs interactive turn selection, put that picker on `/session move` (for example `--split`, `--pick-turn`, or prompt when no turn is supplied), and disable first/last ineligible turns as split targets.
- In UI-capable modes, bare or incomplete `/session move` should guide the user with pickers/prompts for missing session and target path; choosing `current` in the guided flow must proceed exactly like `/session move current`, not fail after selections. `/session move --split` should add a turn picker. For MVP, do not build a custom target file picker/directory browser; prefer existing path autocomplete if available or an existing reusable browser component if one already exists. Otherwise use a plain typed target path prompt/help text and do not label it as a picker. In non-UI modes, show help text instead.
- Investigate turn-id gutter feasibility separately using Pi TUI/message rendering APIs; current public APIs do not support a true built-in message gutter, so default to compact command output/inspector/widget.

## Migration manifest
Store under:

```text
~/.pi/agent/session-migrations/<migration-id>.json
```

Include:
- operation: move|split-move
- status: planned|pi_backed_up|pi_written|honcho_rebuilt|complete|failed
- sourceSessionFile, targetSessionFile
- sourceCwd, targetCwd
- sourceHonchoKey, targetHonchoKey
- splitTurnRef, splitEntryId, splitTurnId
- backups
- timestamps
- errors/recovery notes

## Final validation gates
- Load moved/split target session with `pi --session <file> --list-models` or equivalent non-mutating startup check.
- Verify no target-dir path resolution regressions for `~/`, quoted paths, absolute paths, and relative paths.
- Honcho dry-run reports exact source/target keys and message counts.
- Honcho execute mode leaves source/target counts consistent with transcript slices.
