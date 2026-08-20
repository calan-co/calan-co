# Migration backlog system of record

This directory is the root system of record for migration epics and work items.
Each migration work item must be linked from its epic and kept current through its
lifecycle. The migration ledger is the execution gate; it does not replace the
backlog's decision and evidence record.

Doc-Vader CLI integration is not available in this bootstrap. Do not represent a
Doc-Vader command, ticket sync, or automated backlog update as available until it
is separately approved and implemented.

## Required work-item format

Every migration work item records:

- **Lifecycle:** `queued`, `blocked`, `approved-for-import`, `imported`,
  `parity-verified`, `staging-released`, `cut-over`, or `archived`.
- **Owner:** the accountable human or team.
- **Target path:** the approved repository-relative destination, or `unassigned`
  while the import is not approved.
- **Evidence:** source inventory record, source-freeze evidence, test command and
  result, artifact-catalog linkage, adapter evidence, and later-state receipts.
- **Rollback:** the pre-import rollback target and the responsible owner.

Use [MIG-001](MIG-001-migration-control-plane.md) as the initial migration epic
and copy its work-item fields for each approved import wave.
