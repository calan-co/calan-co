---
title: Fix CI Workflow Wiring (Static Analysis, Docs, Benchmarks)
id: 57
status: completed
related_commit:
  - 8e4ff9c  # MISSING-COMMIT
dependencies:
  - "[[52_parity_tests_and_ci.md]]"
estimated_hours: 4
priority: high
test_results: "yamllint passed for .github/workflows and .github/actions with updated configs."
completed_date: 2026-02-12
---

## Goal

Repair CI wiring issues that currently cause avoidable workflow failures in YAML linting, docs checks, and benchmark smoke checks.

## Deliverables

- Correct workflow script path usage for shell linting and YAML linting targets.
- Repair docs workflow path assumptions for core docs validation.
- Add missing checkout/environment bootstrap to benchmark smoke test job.

## Acceptance Criteria

- Static Analysis workflow references valid scripts and explicit YAML targets.
- Docs workflow validates files from an existing directory.
- Benchmarks PR smoke job has checkout + environment bootstrap and can execute benchmark validation.

## Notes

This item tracks step `1` from the workspace review follow-up.

Completed changes:

- `static-analysis.yml` now uses explicit YAML lint targets and valid shell-lint script wiring.
- `docs.yml` validates core docs from `temple/docs`.
- `benchmarks.yml` perf-regression job now includes checkout and CI env bootstrap.
