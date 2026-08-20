---
title: Split Tests Workflow into Explicit Root/Core/Linter Jobs
id: 59
status: completed
related_commit:
  - 005276a  # MISSING-COMMIT
dependencies:
  - "[[58_fix_scripts_ci_pyproject_dependency_spec.md]]"
estimated_hours: 6
priority: high
test_results: "Local suite validation: root tests 51 passed; temple tests 236 passed; temple-linter tests 54 passed."
completed_date: 2026-02-12
---

## Goal

Restructure the `Tests` workflow into explicit jobs that separately validate root automation tests, `temple` tests, and `temple-linter` tests.

## Deliverables

- Distinct jobs in `.github/workflows/tests.yml` for root, core, and linter suites.
- Deterministic dependency setup for each job.

## Acceptance Criteria

- Root tests run in their own job.
- Temple tests run in a dedicated job (matrix allowed).
- Temple-linter tests run in a dedicated job with local temple dependency installed.

## Notes

This item tracks step `3` from the workspace review follow-up.

Completed changes:

- `.github/workflows/tests.yml` now has explicit `root-python-tests`,
  `temple-tests`, and `temple-linter-tests` jobs.
- Each job has deterministic setup and target-specific execution commands.
