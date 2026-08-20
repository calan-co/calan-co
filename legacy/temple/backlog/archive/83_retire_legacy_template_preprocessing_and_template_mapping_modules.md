---
title: "Retire legacy template_preprocessing and template_mapping modules"
id: 83
status: completed
state_reason: success
priority: medium
complexity: medium
estimated_hours: 6
actual_hours: 2
completed_date: 2026-02-15
related_commit:
  - 001003c  # refactor(linter): retire legacy preprocessing and mapping modules
test_results: "Local: .ci-venv/bin/python -m pytest temple-linter/tests/test_base_format_linter.py temple-linter/tests/test_integration.py"
dependencies:
  - "[[79_audit_cross_layer_dry_and_grammar_anchoring.md]]"
related_backlog:
  - "archive/19_unified_token_model.md"
related_spike:
  - "79_audit_cross_layer_dry_and_grammar_anchoring.md"
notes: |
  Finding: legacy preprocessing/mapping modules duplicate current behavior and
  are trim-semantic drift risk.
  Completed in commit 001003c by removing legacy modules/tests and routing
  remaining base cleaning through the services-based pipeline.
---

## Goal

Remove or clearly isolate and add deprecation warnings to legacy preprocessing/mapping paths so only one canonical cleaning/mapping pipeline remains active.

## Background

`template_preprocessing.py` and `template_mapping.py` still hold regex-based logic and defaults that diverge from the current services pipeline.

## Tasks

1. Determine active runtime/test usages and define migration plan.
2. Route remaining callers to services-based cleaning/mapping path.
3. Remove obsolete modules (or mark internal-deprecated with bounded cleanup timeline).
4. Update tests/docs accordingly.

## Deliverables

- Single canonical cleaning/mapping path in `temple-linter`.
- Removed or deprecated legacy modules with no active production callers.
- Updated test coverage reflecting consolidated behavior.

## Acceptance Criteria

- [x] No production path depends on legacy preprocessing/mapping modules.
- [x] Duplicate regex cleaning/mapping logic is removed or explicitly deprecated.
- [x] Tests validate consolidated pathway end-to-end.
