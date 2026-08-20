---
title: Integration & End-to-End Tests
id: 38
status: complete
related_commit:
  - 77d875c  # test: add markdown integration pipeline
  - 506f463  # test: add integration coverage for json/html/yaml
  - 06366df  # test: reorganize compiler tests into functional groupings (ADR-002 Phase 3)
dependencies:
	- "[[19_unified_token_model.md]]"
	- "[[37_typed_dsl_serializers.md]]"
related_backlog:
	- "[[39_performance_benchmarks.md]]"
estimated_hours: 24
priority: high
---

## Goal

Create reproducible end-to-end integration tests that exercise the full pipeline: parser → type checker → diagnostics → serializers.

## Tasks

- Define canonical input templates and corresponding expected outputs for JSON, Markdown, HTML, and YAML.
- Implement pytest-based E2E harness under `tests/integration/` that runs the full pipeline against examples.
- Add fixtures for runtime schemas and sample data used by the tests.
- Run the suite locally and on CI; triage any regressions.

## Acceptance Criteria

- `pytest tests/integration/` runs and either passes or emits documented failures.
- Each E2E test includes input template, expected serializer output, and any schema needed.

## Notes

- Start with a small set (3–5) of representative examples, expand later.
