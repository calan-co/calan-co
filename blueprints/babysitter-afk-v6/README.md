# Babysitter AFK Doc-Vader blueprint (v6)

This package targets the installed Babysitter v6 CLI (`babysitter --version` reports 6.0.3 in the validated environment). Install its declared SDK dependency and run it with the concrete v6 commands:

```sh
cd blueprints/babysitter-afk-v6
npm install
babysitter run:create --process-id babysitter-afk-doc-vader --entry "$PWD/process.mjs#process" --inputs ./inputs.json --non-interactive --json
```

Then advance the durable run using `babysitter run:iterate <run-directory> --json`; inspect append-only effects with `babysitter run:events <run-directory> --json`. The package intentionally declares only standard package metadata; it does not invent undocumented `blueprint.json` fields.

## Run contract

The process accepts only JSON-safe inputs. Provide an importable local `configModule` which exports `createPorts(runInput)` (or a default export) and returns the injected stack-neutral ports, plus `runInput` for the delivery request. Functions are resolved from that module inside the process and never encoded in JSON:

```json
{
  "configModule": "/absolute/path/to/babysitter-ports.mjs",
  "runInput": { "itemId": "wi-005", "cwd": "/repo", "runDirectory": "/repo/.babysitter/runs/wi-005" }
}
```

The composition root writes and verifies the versioned `babysitter-evidence/v1` manifest in the run directory before each guarded delivery transition. Its eight required artifact categories are input, command, DV, review, diff, commit, integration, and hash. A missing/unimportable module or malformed ports fails closed before a worktree side effect.

A repository may opt into the repository override `.babysitter/repository-override.json`. It is parsed by the existing Doc-Vader contract parser and must be compatible with `doc-vader-contract/v1`. It changes only Doc-Vader command argv; it cannot alter readiness, policy, acceptance, or evidence controls.

## Adapter seam and Node-first limits

The composition root has injected worktree, review/delivery, state, and command ports. The Node acceptance discovery adapter is the first adapter, not generic policy. It requires exactly one supported Node lockfile and fails closed for ambiguous or absent lockfile configuration; use a different injected adapter for non-Node repositories.
