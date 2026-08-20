---
title: Triage and Fix temple-linter Test Failures
id: 61
status: completed
related_commit:
  - 005276a  # MISSING-COMMIT
dependencies:
  - "[[59_split_tests_workflow_jobs.md]]"
estimated_hours: 4
priority: high
test_results: "temple-linter/tests: 54 passed; built wheel contains temple/typed_grammar.lark."
completed_date: 2026-02-12
---

## Goal

Resolve failing `temple-linter` tests by fixing the underlying packaging/runtime defect and validating the linter suite under CI-like installation behavior.

## Deliverables

- Root-cause analysis of failing linter tests.
- Code or packaging fix restoring linter parser runtime behavior.
- Verified `temple-linter` test pass in CI-like environment.

## Acceptance Criteria

- Previously failing linter tests now pass under installed-package execution.
- Root cause documented in the work item notes.

## Notes

This item tracks step `5` from the workspace review follow-up.

Completed changes:

- Root cause identified: `temple` package installs without `typed_grammar.lark`,
  producing parser runtime errors in linter tests.
- Added package-data entry in `temple/pyproject.toml` so grammar file is
  included in built wheel.
- Verified `temple-linter/tests` pass in CI venv and wheel contains
  `temple/typed_grammar.lark`.
