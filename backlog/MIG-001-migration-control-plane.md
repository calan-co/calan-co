# MIG-001: Migration control-plane readiness

- **Lifecycle:** queued
- **Owner:** @chris-cald
- **Target path:** unassigned; no source import is approved by this epic.
- **Rollback:** no import has occurred. Before any work item moves to `imported`,
  record its source-preserving rollback target and accountable rollback owner.

## Objective

Maintain the governance controls required before an approved source can enter an
import wave. This epic is not authorization to clone, modify, release, or import
a source repository.

## Evidence

- Approved sources: `migration/inventory.yaml`
- Import gate and state evidence: `migration/ledger.yaml`
- Artifact catalog linkage and release-path guard: `release-artifacts.yaml`
- Validation command: `pnpm run validate`
- Code-owner policy: `.github/CODEOWNERS`

## Migration work-item template

Create a child work item for each approved import with these fields before it
moves beyond `queued`:

```text
ID: MIG-001.<wave>
Lifecycle: queued
Owner: <accountable human or team>
Source inventory ID: <migration/inventory.yaml source id>
Source URL: <exact allowlisted original source URL>
Target path: <normalized repository-relative POSIX path>
Source freeze evidence: <date and evidence link>
Test command: <source-preserving command>
Test result evidence: <link or immutable record>
Artifact catalog linkage: <release-artifacts.yaml artifact IDs>
Adapter evidence: <compatibility adapter evidence link>
Rollback target: <pre-import commit, branch, or release target>
Rollback owner: <accountable human or team>
Parity evidence: <required after import>
Staging receipt: <required before staging-released>
```

## Phase-0 work items

All records below remain queued in [`migration/ledger.yaml`](../migration/ledger.yaml). Their authoritative default SHAs, source commands, observed versions, and explicitly unattested facts are in [`migration/artifact-baseline.json`](../migration/artifact-baseline.json).

- [MIG-001.1: doc-vader](MIG-001.1-doc-vader.md)
- [MIG-001.2: linkity](MIG-001.2-linkity.md)
- [MIG-001.3: pi-extensions](MIG-001.3-pi-extensions.md)
- [MIG-001.4: babysitter-dv](MIG-001.4-babysitter-dv.md)
- [MIG-001.5: awx-ee-proxmox](MIG-001.5-awx-ee-proxmox.md)
- [MIG-001.6: templjs](MIG-001.6-templjs.md)
- [MIG-001.7: templjs-template](MIG-001.7-templjs-template.md)
- [MIG-001.8: templjs-temple](MIG-001.8-templjs-temple.md)

## Exit criteria

A child work item may enter `imported` only when its source is allowlisted in the
inventory and its Phase-0 fields are present in the ledger and work item. No
Doc-Vader CLI command or automated backlog synchronization is available or
assumed by this epic.
