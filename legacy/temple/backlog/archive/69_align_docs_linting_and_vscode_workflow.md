---
title: "Align Documentation, Linting Guidance, and VS Code Workflow"
id: 69
status: completed
state_reason: success
priority: medium
complexity: medium
estimated_hours: 8
actual_hours: 5
completed_date: 2026-02-13
related_commit:
  - 88f0305  # docs(workflow): align setup and vscode dev tooling
test_results: "Docs/workflow validation: vscode-temple-linter compile+lint pass; .vscode JSON files validate; docs HTML build passes (network-dependent intersphinx warnings only)."
dependencies:
  - "[[68_repair_vscode_extension_integration.md]]"
related_backlog:
  - "47_documentation_updates_for_core_integration.md"
  - "archive/40_ci_integration_and_docs.md"
related_spike: []
notes: |
  Consolidates contributor guidance after tooling/runtime fixes land.
  Rewrote CONTRIBUTING.md to remove duplicated/outdated setup sections and align with CI-parity commands.
  Updated README and vscode-temple-linter README setup guidance for current Python/Node/tooling expectations.
  Added .vscode tasks/launch/extensions recommendations for core, linter, and extension dev loops.
---

## Goal

Update repository documentation and VS Code project configuration so contributors have one accurate, runnable setup path for templating, linting, CI parity, and extension development.

## Background

Current docs contain duplicate/outdated sections, placeholder values, and conflicting tool instructions. This increases onboarding time and causes avoidable setup errors.

## Tasks

1. **Consolidate and correct top-level docs**
   - Remove duplicated sections and stale commands
   - Replace placeholders (license/issues links) or clearly mark decisions

2. **Align linting/test command docs with actual tooling**
   - Ensure all documented commands match active scripts/workflows
   - Provide concise CI-to-local command matrix

3. **Improve VS Code repo ergonomics**
   - Add/align `.vscode` task/launch settings for core/linter/extension dev loops
   - Ensure workspace recommendations are consistent with actual stack

4. **Add documentation validation checks**
   - Ensure docs checks are meaningful and non-silent for required paths

## Deliverables

- Updated `README.md`, `CONTRIBUTING.md`, and component READMEs
- Updated workspace and `.vscode` configuration files as needed
- Doc validation command guidance aligned to current CI behavior

## Acceptance Criteria

- [x] Primary setup instructions are non-duplicative and runnable
- [x] Documented local commands match scripts/workflows
- [x] VS Code workflow files support core + linter + extension iteration
- [x] Documentation lint/build checks are explicit and actionable
