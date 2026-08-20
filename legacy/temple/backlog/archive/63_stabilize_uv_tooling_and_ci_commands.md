---
title: "Stabilize UV Tooling and CI Command Execution"
id: 63
status: completed
state_reason: success
priority: critical
complexity: medium
estimated_hours: 8
actual_hours: 3
completed_date: 2026-02-13
related_commit:
  - d61288c  # ci(tooling): stabilize hook and workflow command execution
test_results: "Local checks: lint-yaml and lint-shell pass; no active `uv pip run` usage; docs linkcheck invocation works but requires networked DNS to fully pass."
dependencies: []
related_backlog:
  - "archive/57_fix_ci_workflow_wiring.md"
  - "archive/58_fix_scripts_ci_pyproject_dependency_spec.md"
  - "archive/62_update_auto_resolve_workflow_triggers.md"
related_spike: []
notes: |
  Completed by normalizing hook/workflow command execution around shared CI venv activation.
  Removed invalid `uv pip run` invocations and restored failing semantics for benchmark/docs checks.
  Added local CI-parity command documentation in CONTRIBUTING.md.
---

## Goal

Replace invalid `uv` command usage and non-gating script behavior so pre-commit hooks and GitHub Actions execute reliably and fail correctly when regressions are introduced.

## Background

Recent workflow refactors introduced `uv pip run` invocations, which are not valid with the current uv CLI. This breaks benchmark/docs/automation jobs and undermines confidence in CI signals.

## Tasks

1. **Normalize uv command usage**
   - Replace `uv pip run ...` with supported invocations (`uv run ...` or equivalent explicit Python entrypoints)
   - Update `.pre-commit-config.yaml`, `scripts/pre-commit/*`, and impacted workflows

2. **Restore proper failure semantics**
   - Remove `|| true` where it suppresses required checks
   - Keep best-effort behavior only where explicitly intended and documented

3. **Validate hook and workflow command paths**
   - Ensure each command resolves in both local and CI context
   - Verify benchmark/docs/security automation scripts still run with declared environments

4. **Document the canonical local verification commands**
   - Add a short command matrix in docs for local equivalents of CI jobs

## Deliverables

- Updated command invocations in `.pre-commit-config.yaml`
- Updated scripts under `scripts/pre-commit/`
- Updated workflows under `.github/workflows/`
- Documentation note for local command parity

## Acceptance Criteria

- [x] No `uv pip run` usage remains in active hook/workflow/script paths
- [x] Required docs/benchmark/automation checks fail on actual errors
- [x] Local dry-run command set is documented and executable
- [x] CI workflow YAML remains valid
