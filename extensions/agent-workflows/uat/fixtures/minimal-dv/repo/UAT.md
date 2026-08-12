# Agent Workflows minimal Doc-Vader UAT fixture

This repository is a minimal, deterministic UAT fixture for `agent-workflows` with the Doc-Vader (`dv`) Work Source.

## Run

```bash
./scripts/run-uat.sh
```

The script:

1. Runs `./reset-workspace.sh` to restore the committed `golden` baseline.
2. Runs `pi -p '/work:process'`.
3. Validates the authoritative `.pi/sandcastle/runs/*/record.json` Work Process record.
4. Validates final repository state.
5. Validates no AFK-ready work remains.

## Fixture shape

- `wi-001`: AFK-ready, creates `test.txt` with `wi-001`.
- `wi-002`: AFK-ready but dependency-blocked by `wi-001`, appends `wi-002`.
- `wi-003`: AFK-ready but dependency-blocked by `wi-001`, appends `wi-003`.
- `wi-004`: HITL, blocked, asks for a custom setting and must be skipped by AFK processing.

The fixture uses `entrypoint: work-process-waves` with `defaultPipeline: parallel-planner-with-review`, so UAT exercises implementation, review, close, and merge behavior. `wi-002` and `wi-003` both become ready after `wi-001`, exercising a parallel dependent AFK wave.

## Success criteria

- `test.txt` exists, starts with `wi-001`, and contains both `wi-002` and `wi-003` exactly once. The relative order of `wi-002` and `wi-003` is not significant because they run in the same parallel dependent wave.

- `wi-001`, `wi-002`, and `wi-003` have `status: completed` and all Tasks / Acceptance Criteria checked.
- `wi-004` remains blocked and tagged `hitl`.
- The newest authoritative `.pi/sandcastle/runs/*.json` has `kind: work-process`, `pipeline: parallel-planner-with-review`, and `status: done`.
- `node .sandcastle/dv4sandcastle.mjs list` returns `[]`.
