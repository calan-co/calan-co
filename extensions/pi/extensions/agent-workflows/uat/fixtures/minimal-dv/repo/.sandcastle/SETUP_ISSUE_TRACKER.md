# Doc-Vader Sandcastle Issue Tracker

This Sandcastle scaffold is configured by `dv-sandcastle-init` or `dv sandcastle init` to use Doc-Vader work items as the custom issue tracker.

## Commands

- List open AFK-ready work: `node .sandcastle/dv4sandcastle.mjs list`
- View one work item: `node .sandcastle/dv4sandcastle.mjs view <task-id>`
- Validate close readiness: `node .sandcastle/dv4sandcastle.mjs validate <task-id>`
- Render implementation context: `node .sandcastle/dv4sandcastle.mjs prompt <task-id>`
- Claim work before editing: `node .sandcastle/dv4sandcastle.mjs claim <task-id> --holder <holder> --branch <branch> --json`
- Record evidence: `node .sandcastle/dv4sandcastle.mjs record --claim <claim-id> --type <record-type> --payload <json-file|-> --json`
- Recover interrupted work: `node .sandcastle/dv4sandcastle.mjs recover <task-id> --branch <branch> --json`
- Close work: `node .sandcastle/dv4sandcastle.mjs close <task-id>`

## Requirements

- Doc-Vader must be available either from source at `cli/doc-vader.ts` or as `dv` in the workspace.
- Override the command used by the adapter with `DV_COMMAND` when needed, for example `DV_COMMAND="pnpm exec dv"`.
- Closing uses `.sandcastle/close.mjs` by default. Override with `DV_SANDCASTLE_CLOSE_COMMAND` when your repo has a different terminal transition script.

## Update Flow

Run `dv sandcastle init` again after regenerating the Sandcastle scaffold or changing Doc-Vader command policy.
