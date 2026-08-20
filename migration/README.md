# Migration ledger

`inventory.yaml` records each approved original repository's canonical URL, observed default branch and immutable default SHA, target path, current import disposition, and explicit exclusions. [`artifact-baseline.json`](artifact-baseline.json) holds source-declared commands, version facts, and pending or unattested facts tied to those pins. `sourceDeclaredCommands` is evidence copied from source configuration, not evidence that a command was executed or succeeded. A ledger record's `id`, exact source URL, and target path must match one authoritative inventory record; forks, `calan-co/.github`, and `calan-co/cicd-shared-pipeline` remain excluded by omission.

## State and evidence gates

- `queued`: source, owner, target path, and artifact list are known. It must not claim source freeze, adapter, test, parity, staging, rollback, or archive evidence.
- `imported`: history has been imported on its approved migration branch, with source freeze date, rollback target, source-preserving test command, artifact-catalog linkage, and compatibility-adapter evidence recorded.
- `parity-verified`: `parityEvidence` is recorded.
- `staging-released`: parity evidence and `stagingReceipt` are recorded.
- `cut-over`: parity evidence, staging receipt, source freeze date, and rollback target are recorded.
- `archived`: all cut-over evidence plus `archiveEvidence` are recorded.
- `blocked`: work cannot proceed; retain the record and its reason in the approved work item/evidence system.

The validator rejects incomplete evidence for the states that require it and resolves imported artifact IDs against `release-artifacts.yaml`. It intentionally permits an empty ledger during bootstrap.

Do not treat this ledger as authorization to modify a source repository. Each import must use its own approved migration branch and preserve source history without squashing.
