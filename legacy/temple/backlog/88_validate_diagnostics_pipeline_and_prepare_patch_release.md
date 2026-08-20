---
title: "Validate diagnostics pipeline and prepare patch release for templ-any mode"
id: 88
status: in_progress
state_reason: null
priority: medium
complexity: low
estimated_hours: 4
actual_hours: 2.0
completed_date: null
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
test_results: |
  Validation rerun on 2026-02-16:
  - npm --prefix vscode-temple-linter run compile (pass)
  - npm --prefix vscode-temple-linter run lint (pass)
  - npm --prefix vscode-temple-linter run test:integration
    (fails in sandbox: VS Code test run terminates with SIGABRT after host launch;
    updater lookup also reports ENOTFOUND for update.code.visualstudio.com and
    falls back to cached 1.109.3)
dependencies:
  - "[[archive/86_disable_auto_reassociation_and_lock_template_language_identity.md]]"
  - "[[archive/87_align_manifest_docs_and_integration_tests_for_templated_any.md]]"
related_backlog:
  - "archive/57_vscode_packaging_and_init_contract_hardening.md"
  - "[[archive/89_implement_projection_snapshots_for_shadow_bridge.md]]"
  - "[[90_implement_shadow_document_lifecycle_and_diagnostic_ownership.md]]"
  - "[[91_proxy_base_language_lsp_features_with_edit_safety.md]]"
  - "[[92_add_templated_format_language_ids_and_generated_grammars.md]]"
  - "[[archive/93_harden_transport_timeouts_and_watched_files_noise.md]]"
  - "[[94_define_parity_matrix_and_pr_scope_for_shadow_bridge_rollout.md]]"
  - "[[95_run_unsandboxed_vscode_parity_validation_and_close_shadow_bridge.md]]"
related_spike: []
notes: |
  Validation started on 2026-02-16.
  Compile/lint pass for updated extension source.
  Integration test run currently blocked by VS Code test-host SIGABRT in this
  sandboxed environment; needs rerun in local IDE host/CI environment.
  2026-02-16: Shadow-bridge parity effort tracked in items 89-94 with explicit
  extension matrix and PR slice boundaries.
  2026-02-16: Status re-verified prior to starting 89+.
  - Compile/lint still pass.
  - Integration remains blocked in sandbox (SIGABRT), so item stays in_progress.
  2026-02-16: Revalidated after 89-94 implementation updates.
  - Extension compile/lint still pass with projection-backed shadow bridge.
  - Python projection/transport/integration suites pass.
  - VS Code integration host still terminates with SIGABRT in sandbox; release
    gate remains pending unsandboxed host validation.
  - PR submitted: https://github.com/squirrel289/temple/pull/11
  - Remote CI currently failing across required checks; see process-pr status.
---

## Goal

Confirm end-to-end diagnostic behavior and ship-ready quality after the policy change.

## Background

Language identity changes can affect diagnostics ordering/ownership and extension
packaging confidence. Validation is required before release.

## Tasks

1. Run compile/lint/integration tests in `vscode-temple-linter`.
2. Run manual smoke checks on `examples/templates/bench/real_small.md.tmpl` and
   `vscode-temple-linter/test_sample.json.tmpl`.
3. Record outcomes and release-notes delta.

## Deliverables

- Test evidence and patch-release readiness notes.

## Acceptance Criteria

- [ ] No auto language flip in smoke tests.
- [ ] Temple diagnostics still publish.
- [ ] No regression in base-lint request flow.
