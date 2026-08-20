# Contributing

## Bootstrap scope

This repository currently contains only migration governance. Do not add imported source, release catalog records, release credentials, or publish jobs without the corresponding approved migration wave and evidence.

## Branch and validation rules

Use a short-lived branch and pull request targeting `main`. Keep changes focused. Before opening a pull request, run:

```sh
pnpm run validate
```

The pull-request workflow runs the same catalog, ledger, and validator-test checks without installing an imported project or publishing anything.

## Catalog and ledger changes

`release-artifacts.yaml` and `migration/ledger.yaml` use JSON-compatible YAML so their zero-dependency validators can run before any workspace import. Update their adjacent JSON Schemas and focused validator tests when changing a contract.

A catalog record is added only after its artifact has a verified owner, independent version source, adapter, target, environment, dry-run command, publish command, receipt command, and rollback command. Uniform branch/release policy never means a shared artifact version or publication target.

Ledger records track an import through `queued`, `imported`, `parity-verified`, `staging-released`, `cut-over`, and `archived` (or `blocked`). Evidence and rollback fields are mandatory before cut-over and archival.

## Legacy and source boundaries

Do not add `legacy/**` to pnpm workspace discovery or the release catalog. Do not modify, archive, or otherwise change a source repository as part of work in this bootstrap repository. History-preserving imports occur only in their approved migration branches after the ledger gate is satisfied.
