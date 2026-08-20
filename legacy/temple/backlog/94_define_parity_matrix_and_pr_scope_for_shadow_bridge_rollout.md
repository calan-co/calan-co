---
title: "Define parity matrix and PR scope for shadow bridge rollout"
id: 94
status: testing
state_reason: null
priority: high
complexity: medium
estimated_hours: 6
actual_hours: 2.0
completed_date: null
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
test_results: |
  Tracking artifact update on 2026-02-16:
  - PR slice implementation currently active on branch
    `feature/90-shadow-doc-lifecycle`.
  - Compile/lint baseline for extension currently passing.
dependencies:
  - "[[archive/89_implement_projection_snapshots_for_shadow_bridge.md]]"
  - "[[90_implement_shadow_document_lifecycle_and_diagnostic_ownership.md]]"
  - "[[91_proxy_base_language_lsp_features_with_edit_safety.md]]"
  - "[[92_add_templated_format_language_ids_and_generated_grammars.md]]"
  - "[[archive/93_harden_transport_timeouts_and_watched_files_noise.md]]"
related_backlog:
  - "[[88_validate_diagnostics_pipeline_and_prepare_patch_release.md]]"
  - "[[95_run_unsandboxed_vscode_parity_validation_and_close_shadow_bridge.md]]"
related_spike: []
notes: |
  2026-02-16: Created to lock explicit provider parity expectations, PR
  boundaries, and release evidence requirements for this multi-PR effort.
  2026-02-16: Started implementation tracking.
  - Active implementation spans items 89-93 prior to PR slicing and merge flow.
  2026-02-16: PR scope and parity matrix refined; moved to testing.
  - PR1 scope: projection + diagnostics mapping + transport hardening (89, 93).
  - PR2 scope: shadow lifecycle + diagnostics ownership hygiene (90).
  - PR3 scope: provider proxy/remap/edit safety + semantic tokens (91).
  - PR4 scope: language IDs/grammars/docs/integration alignment (92, 88).
  - Remaining blocker for release gate: VS Code integration host SIGABRT in sandbox.
  - PR submitted: https://github.com/squirrel289/temple/pull/11
  - Current PR state: BLOCKED (no approvals + failing remote checks).
---

## Goal

Define and validate an explicit parity matrix and split implementation into
reviewable PR scopes with objective pass/fail criteria.

## Background

This rollout spans compiler services, VS Code transport/lifecycle, grammar
generation, and provider proxying. Without explicit matrix/scope definitions,
review and regression triage become ambiguous.

## Explicit Target Extension Matrix

Parity validation and PR sign-off must include this exact extension set:

1. `vscode.markdown-language-features`
2. `DavidAnson.vscode-markdownlint`
3. `vscode.json-language-features`
4. `redhat.vscode-yaml`
5. `vscode.html-language-features`
6. `redhat.vscode-xml`
7. `tamasfe.even-better-toml`

## Current Parity Matrix (2026-02-16)

| Extension | Features | Status | Evidence |
| --- | --- | --- | --- |
| `vscode.markdown-language-features` | completion, hover, definition, references, symbols, rename, formatting, semantic tokens | Implemented / needs host validation | `vscode-temple-linter/src/extension.ts`, compile/lint pass |
| `DavidAnson.vscode-markdownlint` | diagnostics remap via base request bridge | Implemented / needs host validation | `temple-linter/src/temple_linter/services/base_linting_service.py`, `.../lsp_server.py` |
| `vscode.json-language-features` | same proxy feature set | Implemented / needs host validation | provider bridge + projection remap |
| `redhat.vscode-yaml` | same proxy feature set | Implemented / needs host validation | provider bridge + projection remap |
| `vscode.html-language-features` | same proxy feature set | Implemented / needs host validation | provider bridge + projection remap |
| `redhat.vscode-xml` | same proxy feature set | Implemented / needs host validation | provider bridge + projection remap |
| `tamasfe.even-better-toml` | same proxy feature set | Implemented / needs host validation | provider bridge + projection remap |

## Tasks

1. **Define PR slices**
   - PR1: projection/mapping core + markdown regression fix.
   - PR2: shadow lifecycle + source-only diagnostics hygiene.
   - PR3: proxy providers + edit safety.
   - PR4: language IDs/grammars/docs/tests + transport hardening cleanup.

2. **Parity checklist**
   - For each target extension, record feature coverage and known degradation.
   - Capture diagnostics ownership checks (no mirror URI diagnostics).

3. **Validation artifacts**
   - Record compile/lint/unit/integration/manual smoke evidence per PR.
   - Store output/log snippets for timeout/noise regression checks.

4. **Release gate**
   - Define minimum passing matrix before patch release.

## Deliverables

- PR scope document embedded in work item notes/checklists.
- Completed parity matrix for all target extensions.
- Consolidated release readiness evidence and residual risk notes.

## Acceptance Criteria

- [x] PR boundaries are explicit and map cleanly to work items 89-93.
- [x] Every target extension has recorded parity status and evidence.
- [ ] No open blocker remains for source-only diagnostics ownership.
- [ ] Release gate criteria are documented and met before final merge.
