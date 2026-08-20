# Calan & Co

This is the public migration-control repository for the Calan & Co product monorepo. It starts as a deliberately empty, non-publishing control plane: no source history, packages, credentials, release environments, or release adapters have been imported or enabled.

## Policy model

`main` is the stable integration branch and `staging` is reserved for prerelease integration after it is created and governed separately. Short-lived branches use pull requests. The repository applies one review, evidence, and release-policy model, but **does not use lockstep versions or a universal publish command**. Every releasable artifact receives its own catalog entry, independent version source, release adapter, publish target, receipt, and rollback procedure—even when artifacts share the same branch and release policy.

The empty [`release-artifacts.yaml`](release-artifacts.yaml) catalog is the only future release-dispatch input. Its schema requires one owner, version source, adapter, target, environment, dry-run command, publish command, receipt command, and rollback command per artifact. Until an import has verified those facts, no catalog entry or publishing workflow is added.

## Bootstrap validation

The root policy is Node 24 and pnpm 11.9.0. Run the control-plane-only checks with:

```sh
pnpm run validate
```

This command validates the empty catalog and migration ledger and runs only their Node tests. It does not discover, install, build, test, package, or publish imported projects.

See [the compatibility matrix](docs/toolchain-compatibility.md) before importing an artifact. The root default is governance policy, not a claim that every source currently installs under this root.

## Migration boundaries

Imports are recorded in [`migration/ledger.yaml`](migration/ledger.yaml) and follow [the migration guide](migration/README.md). `legacy/**` is excluded from workspace discovery and must remain out of normal CI and release catalog discovery.

Forks, `calan-co/.github`, and `calan-co/cicd-shared-pipeline` remain outside this repository. Source repositories are not changed by this bootstrap.

## Security and contribution

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing control-plane or import changes. Report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.
