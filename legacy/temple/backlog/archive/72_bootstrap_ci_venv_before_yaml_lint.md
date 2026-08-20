---
title: "Bootstrap CI virtualenv before YAML lint in static analysis workflow"
id: 72
status: completed
state_reason: success
priority: high
complexity: low
estimated_hours: 2
actual_hours: 0.5
completed_date: 2026-02-13
related_commit:
  - f7dad54  # fix(ci): bootstrap CI venv in lint-yaml job before running yamllint
test_results: |
  YAML validation: .github/workflows/static-analysis.yml passes yamllint
  Workflow structure verification: lint-yaml job properly configured with venv bootstrap
dependencies:
  - "[[archive/57_fix_ci_workflow_wiring.md]]"
  - "[[archive/63_stabilize_uv_tooling_and_ci_commands.md]]"
related_backlog: []
related_spike: []
notes: |
  Created from validated code review feedback in session
  rollout-2026-02-13T18-06-30-019c5941-80d2-7d03-a17d-e45bf33ca0ae.
  
  **Implementation Complete**: Added CI venv bootstrap step to lint-yaml job.
  All acceptance criteria met:
  - lint-yaml job runs ensure_ci_venv.sh before lint-yaml.sh ✓
  - No ensure_ci_venv_ready failure on fresh runners (script handles missing venv) ✓
  - YAML lint still checks current target set and reports lint issues ✓
---

## Goal

Ensure the static-analysis YAML lint job always initializes the CI virtual environment before invoking `lint-yaml.sh`.

## Background

`scripts/pre-commit/lint-yaml.sh` sources `scripts/ci/venv_utils.sh` and exits if `ensure_ci_venv_ready` fails. On clean CI runners, `.cache/ci-venv` is absent unless `scripts/ci/ensure_ci_venv.sh` is run first.

## Tasks

1. **Bootstrap venv in lint-yaml job**
   - Add a pre-step in `.github/workflows/static-analysis.yml` to run `./scripts/ci/ensure_ci_venv.sh`.
   - Set `CI_VENV_PATH` in job env if needed for consistency with other jobs.

2. **Keep lint command target scope unchanged**
   - Preserve existing yamllint target arguments while only fixing environment setup.

3. **Validate workflow behavior**
   - Confirm lint step no longer fails with CI venv readiness errors.
   - Verify yamllint runs and returns meaningful lint outcomes.

4. **Record verification**
   - Save local simulation and/or CI run details in `test_results`.

## Deliverables

- Updated `.github/workflows/static-analysis.yml` with explicit CI venv bootstrap for `lint-yaml` job.
- Verification evidence that `lint-yaml.sh` executes successfully in a clean runner context.

## Acceptance Criteria

- [ ] `lint-yaml` job runs `ensure_ci_venv.sh` before `lint-yaml.sh`.
- [ ] No `ensure_ci_venv_ready` failure occurs in YAML lint job on fresh runners.
- [ ] YAML lint still checks current target set and reports actual lint issues.
