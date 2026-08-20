---
title: "Fix temple-linter Packaging and CLI Entrypoints"
id: 64
status: completed
state_reason: success
priority: high
complexity: low
estimated_hours: 4
actual_hours: 2
completed_date: 2026-02-13
related_commit:
  - 1acd1c7  # fix(temple-linter): align lsp entrypoint and packaging
test_results: "Local: ruff passes on updated entrypoint files; pytest temple-linter/tests/test_lsp_entrypoint.py (5 tests) passes."
dependencies:
  - "[[archive/63_stabilize_uv_tooling_and_ci_commands.md]]"
related_backlog:
  - "archive/61_fix_temple_linter_packaged_grammar.md"
related_spike: []
notes: |
  Ensures package metadata, interpreter constraints, and entrypoints are internally consistent.
  Implemented explicit lsp_server.main() and routed __main__ execution through the same callable.
  Aligned pyproject/setuptools package discovery and setup.py metadata (python_requires and dependencies).
  Added packaging smoke tests for importable entrypoint and metadata consistency.
---

## Goal

Make `temple-linter` installable and executable through declared console scripts by aligning package metadata with actual module entrypoints.

## Background

`temple-linter` currently advertises a `temple-linter-lsp` script target that points to a non-existent `main` symbol. This causes runtime failure for normal package consumers.

## Tasks

1. **Implement explicit LSP entrypoint**
   - Add `main()` in `temple_linter.lsp_server`
   - Route module execution and console script through the same entrypoint

2. **Align packaging metadata**
   - Ensure `pyproject.toml` and `setup.py` reference valid entrypoint targets
   - Align Python version constraints across metadata files

3. **Add packaging smoke checks**
   - Add a lightweight verification that script import/dispatch works

## Deliverables

- Updated `temple-linter/src/temple_linter/lsp_server.py`
- Updated `temple-linter/pyproject.toml`
- Updated `temple-linter/setup.py`
- Added/updated test coverage for entrypoint behavior

## Acceptance Criteria

- [x] `temple-linter-lsp` resolves to an existing callable entrypoint
- [x] Module execution and console script path are consistent
- [x] Packaging metadata fields do not contradict each other
- [x] Smoke checks pass for import and script dispatch
