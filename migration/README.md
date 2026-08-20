# Migration ledger

`ledger.yaml` begins empty because this bootstrap does not inspect, import, or alter a source repository. Add a record only after the Phase-0 source inventory and artifact baseline are captured from authoritative evidence. A record's exact source URL must appear in the authoritative [`inventory.yaml`](inventory.yaml) allowlist; forks, `calan-co/.github`, and `calan-co/cicd-shared-pipeline` are excluded by omission.

## State and evidence gates

- `queued`: source, owner, target path, and artifact list are known.
- `imported`: history has been imported on its approved migration branch, with source freeze date, rollback target, source-preserving test command, artifact-catalog linkage, and compatibility-adapter evidence recorded.
- `parity-verified`: `parityEvidence` is recorded.
- `staging-released`: parity evidence and `stagingReceipt` are recorded.
- `cut-over`: parity evidence, staging receipt, source freeze date, and rollback target are recorded.
- `archived`: all cut-over evidence plus `archiveEvidence` are recorded.
- `blocked`: work cannot proceed; retain the record and its reason in the approved work item/evidence system.

The validator rejects incomplete evidence for the states that require it and resolves imported artifact IDs against `release-artifacts.yaml`. It intentionally permits an empty ledger during bootstrap.

Do not treat this ledger as authorization to modify a source repository. Each import must use its own approved migration branch and preserve source history without squashing.
