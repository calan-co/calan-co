---
title: "Lock base-lint strategy and publish ADR-005"
id: 73
status: completed
state_reason: success
priority: critical
complexity: medium
estimated_hours: 4
actual_hours: 1.5
completed_date: 2026-02-14
related_commit:
  - 1fb4f83  # docs(planning): add ADR-005 and base-lint execution backlog
test_results: |
  Pre-commit hooks on staged files:
  - docs: sync_readme_structure.py passed
  - secure: detect-secrets passed
  Manual verification:
  - ADR-005 links resolve from README and temple/docs/ARCHITECTURE.md
  - backlog items 74-77 created with explicit dependencies
dependencies:
  - "[[archive/67_fix_lsp_base_diagnostics_transport.md]]"
  - "[[archive/68_repair_vscode_extension_integration.md]]"
related_backlog:
  - "archive/69_align_docs_linting_and_vscode_workflow.md"
related_spike: []
notes: |
  This item defines the canonical strategy order for base-language tooling:
  embedded adapter -> virtual document -> mirror-file ghost fallback.
  It also locks UX/performance constraints before implementation work starts.
  Started implementation on 2026-02-14 with ADR drafting + backlog decomposition.

  Completed on 2026-02-14:
  - Published ADR-005 for base-lint strategy precedence and diagnostics pipeline.
  - Added dependency-ordered backlog chain (74-77).
  - Linked ADR-005 from root README and architecture docs.
---

## Goal

Publish a formal architectural decision for Temple base-language lint/format strategy, including fallback order, diagnostics ownership, focus mode semantics, and performance guardrails.

## Background

Recent extension/linter integration work exposed repeated regressions around temp file lifecycles, raw-file markdownlint leakage, slow diagnostics, duplicate diagnostics, and unclear parser token errors. The strategy has to be explicit so implementation can converge and remain testable across base languages.

## Tasks

1. **Publish ADR-005**
   - Add `temple/docs/adr/005-base-lint-strategy-and-diagnostics-pipeline.md`.
   - Record decision order: `embedded` -> `virtual` -> `mirror-file` with `auto` mode selecting best available.

2. **Define operational constraints**
   - Specify cross-language `focusMode` semantics.
   - Specify diagnostics ownership and de-duplication requirements.
   - Specify cleanup and cache reset expectations on extension reload.

3. **Define implementation decomposition**
   - Break implementation into dependent work items with clear acceptance criteria.
   - Identify observability and performance acceptance thresholds.

4. **Document references**
   - Link ADR-005 from architecture/readme docs.

## Deliverables

- New ADR: `temple/docs/adr/005-base-lint-strategy-and-diagnostics-pipeline.md`.
- Documentation links in `README.md` and/or `temple/docs/ARCHITECTURE.md`.
- New backlog chain for strategy implementation.

## Acceptance Criteria

- [x] ADR-005 exists with status, context, decision, alternatives, and consequences.
- [x] Strategy precedence and fallback behavior are explicitly defined.
- [x] Focus mode and diagnostics ownership rules are explicitly defined for all base languages.
- [x] Implementation work is broken into sequenced backlog items with dependencies.
- [x] Related docs reference ADR-005.
