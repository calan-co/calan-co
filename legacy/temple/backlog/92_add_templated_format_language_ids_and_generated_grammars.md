---
title: "Add templated format language IDs and generated base-scope grammars"
id: 92
status: testing
state_reason: null
priority: high
complexity: medium
estimated_hours: 10
actual_hours: 3.0
completed_date: null
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
test_results: |
  Current validation on 2026-02-16:
  - npm --prefix vscode-temple-linter run compile (pass; includes syntax generation)
  - npm --prefix vscode-temple-linter run lint (pass)
dependencies:
  - "[[archive/86_disable_auto_reassociation_and_lock_template_language_identity.md]]"
related_backlog:
  - "archive/74_implement_base_lint_strategy_resolver_and_capability_registry.md"
related_spike: []
notes: |
  2026-02-16: Created to make syntax scope identity explicit per format and
  remove ambiguity around highlighting ownership for templated files.
  2026-02-16: Started implementation.
  - Added `templ-{markdown,json,yaml,html,xml,toml}` languages to manifest.
  - Added explicit base template file associations for templ-* IDs.
  - Extended syntax generator to emit per-format templated grammars.
  - Updated integration test expectation for `.md.tmpl` -> `templ-markdown`.
  2026-02-16: Moved to testing.
  - Regenerated syntax artifacts and revalidated compile/lint.
  - Confirmed `.md.tmpl` association is format-specific (`templ-markdown`) with
    `templ-any` fallback retained for generic templates.
---

## Goal

Introduce per-format templated language IDs with generated grammars that merge
base syntax scopes and Temple token scopes.

## Background

A single `templ-any` grammar is insufficient for parity expectations across
formats and makes provider routing brittle. Per-format IDs create deterministic
selector and testing targets.

## Target Extension Baseline

This item must align language IDs and grammar routing to:

- `vscode.markdown-language-features`
- `DavidAnson.vscode-markdownlint`
- `vscode.json-language-features`
- `redhat.vscode-yaml`
- `vscode.html-language-features`
- `redhat.vscode-xml`
- `tamasfe.even-better-toml`

## Tasks

1. **Language contributions**
   - Add `templ-markdown`, `templ-json`, `templ-yaml`,
     `templ-html`, `templ-xml`, `templ-toml` in extension manifest.

2. **File associations**
   - Map explicit `*.{md,markdown,json,yaml,yml,html,htm,xml,toml}.{tmpl,template}`
     patterns to corresponding templ-* IDs.
   - Keep generic `*.tmpl` / `*.template` mapped to `templ-any`.

3. **Generated grammars**
   - Update syntax generation scripts to emit per-format templated grammars with
     Temple injections preserved.

4. **Docs/tests alignment**
   - Update README and integration tests to assert templ-* identities.

## Deliverables

- Updated `vscode-temple-linter/package.json` language/association entries.
- Generated grammar files under `vscode-temple-linter/syntaxes/`.
- Updated syntax generation script and integration assertions.

## Acceptance Criteria

- [x] All six templ-* language IDs are contributed and selectable.
- [x] Explicit base-extension template associations resolve to templ-* IDs.
- [x] Syntax highlighting shows base scopes plus Temple scopes in templated files.
- [ ] Integration tests assert correct language IDs for representative templates.
