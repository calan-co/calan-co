---
title: "Align manifest defaults, docs, and integration tests for templ-any mode"
id: 87
status: completed
state_reason: success
priority: high
complexity: medium
estimated_hours: 5
actual_hours: 1.0
completed_date: 2026-02-16
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
test_results: |
  Validation on 2026-02-16:
  - Static checks:
    - `vscode-temple-linter/package.json` default associations only map
      `*.tmpl` / `*.template` -> `templ-any`.
    - `vscode-temple-linter/test/suite/integration.test.js` asserts
      `.md.tmpl` resolves to `templ-any`.
  - npm --prefix vscode-temple-linter run compile (pass)
  - npm --prefix vscode-temple-linter run lint (pass)
dependencies:
  - "[[archive/86_disable_auto_reassociation_and_lock_template_language_identity.md]]"
related_backlog:
  - "archive/58_mvp_release_readiness_docs_and_metadata.md"
  - "archive/69_align_docs_linting_and_vscode_workflow.md"
related_spike: []
notes: |
  2026-02-16: Implementation completed and moved to testing.
  - Removed base-language templated associations from package defaults.
  - Updated README language-identity/troubleshooting guidance.
  - Updated integration assertion for `.md.tmpl` to expect `templ-any`.
  2026-02-16: Re-validated and marked completed.
  - Manifest/docs/test expectations still align with templ-any policy.
---

## Goal

Align extension metadata, troubleshooting docs, and tests with the new language identity policy.

## Background

Manifest defaults and tests currently encode base-language reassociation behavior
for templated files. Those expectations must be updated to match policy.

## Tasks

1. **Done**: Removed base-language templated associations from `vscode-temple-linter/package.json`.
2. **Done**: Updated README language identity guidance and troubleshooting notes.
3. **Done**: Updated integration assertions that expect markdown for `.md.tmpl`.

## Deliverables

- Manifest/docs/tests consistent with templated ownership.

## Acceptance Criteria

- [x] Package defaults only map `*.tmpl`/`*.template` to `templ-any`.
- [x] Integration suite asserts `templ-any` for `real_small.md.tmpl`.
