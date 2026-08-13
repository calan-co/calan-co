# Babysitter AFK Doc-Vader blueprint (v6)

Install this directory through the Babysitter **blueprints:** installation command supported by your installed v6 runtime, then invoke its exported `process(inputs, ctx)` entry point. The package intentionally declares only standard package metadata; it does not invent undocumented `blueprint.json` fields.

## Run contract

The process accepts an injected stack-neutral runner (`inputs.run`) and its run input. The runner writes and verifies the versioned `babysitter-evidence/v1` manifest in the run directory before each guarded delivery transition. Its eight required artifact categories are input, command, DV, review, diff, commit, integration, and hash.

A repository may opt into the repository override `.babysitter/repository-override.json`. It is parsed by the existing Doc-Vader contract parser and must be compatible with `doc-vader-contract/v1`. It changes only Doc-Vader command argv; it cannot alter readiness, policy, acceptance, or evidence controls.

## Adapter seam and Node-first limits

The composition root has injected worktree, review/delivery, state, and command ports. The Node acceptance discovery adapter is the first adapter, not generic policy. It requires exactly one supported Node lockfile and fails closed for ambiguous or absent lockfile configuration; use a different injected adapter for non-Node repositories.
