---
title: Fix scripts/ci pyproject Dependency Spec
id: 58
status: completed
related_commit:
  - 005276a  # MISSING-COMMIT
dependencies:
  - "[[57_fix_ci_workflow_wiring.md]]"
estimated_hours: 2
priority: high
test_results: "Dependency entries parse successfully via packaging.requirements.Requirement."
completed_date: 2026-02-12
---

## Goal

Replace invalid dependency syntax in `scripts/ci/pyproject.toml` with a valid, local-reference dependency for Temple.

## Deliverables

- `scripts/ci/pyproject.toml` uses valid PEP 508 dependency syntax for local Temple package resolution.

## Acceptance Criteria

- Dependency string parses as a valid requirement.
- `scripts/ci` environment setup no longer fails due to malformed dependency metadata.

## Notes

This item tracks step `2` from the workspace review follow-up.

Completed changes:

- Replaced invalid dependency (`"./temple"`) with valid direct reference syntax
  (`"temple @ file:../../temple"`).
- Validated requirement parsing against packaging requirement parser.
