# Changelog

All notable changes to this repository will be documented in this file.

## [Unreleased]

### Added
- VS Code extension packaging guardrails (`activationEvents`, package-content checks, CI `vsce ls` validation).
- Schema-backed semantic linting coverage for undefined variables, missing properties, and type mismatches.
- LSP smoke tests covering initialization, diagnostics publishing, completion, hover, definition, references, and rename.
- Stable editor-facing settings contract for semantic schema/context configuration.
- Repository-level MIT `LICENSE`.
- Temple-native typed filter pipeline support with core filter signatures (`selectattr`, `map`, `join`, `default`).
- Adapter SDK contracts in `temple/sdk/adapter.py` and a Jinja2 adapter prototype with parity fixtures.
- Parity test suite + CI/pre-push checks for native-vs-adapter semantic diagnostic alignment.
- ADR/spec release-note draft and internal announcement template: `temple/docs/release/ADR003_ADAPTER_SPEC_ANNOUNCEMENT.md`.

### Changed
- Temple type checker now initializes variable/type bindings from schema definitions (not only runtime context).
- VS Code extension now reads `temple.semanticSchemaPath` and `temple.semanticContext`, resolves schema paths, and passes them to LSP initialization.
- LSP server now supports `semanticSchemaPath` as the canonical initialization key (with `schemaPath` compatibility fallback).
- Published architecture references are now linked from release notes and changelog:
  - `temple/docs/adr/003-market-role-and-adapter-architecture.md`
  - `temple/docs/ADAPTER_SPEC.md`
