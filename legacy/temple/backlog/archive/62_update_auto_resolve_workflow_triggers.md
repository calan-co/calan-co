---
title: Update Auto-Resolve Workflow Trigger Names
id: 62
status: completed
related_commit:
  - 8e4ff9c  # MISSING-COMMIT
dependencies:
  - "[[57_fix_ci_workflow_wiring.md]]"
estimated_hours: 1
priority: medium
test_results: "Workflow YAML lint passed after trigger update."
completed_date: 2026-02-12
---

## Goal

Update auto-resolve `workflow_run` triggers to match current workflow names after CI refactoring.

## Deliverables

- `.github/workflows/auto_resolve_reviews.yml` references current workflow names.

## Acceptance Criteria

- Trigger list contains only active workflow names.
- Auto-resolve workflow remains runnable via `workflow_run` and manual dispatch.

## Notes

This item tracks step `6` from the workspace review follow-up.

Completed changes:

- Auto-resolve workflow trigger list updated to active workflow names:
  `Tests` and `Static Analysis`.
