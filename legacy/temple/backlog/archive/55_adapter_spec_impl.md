---
title: Implement Adapter Interface & SDK
id: 55
status: completed
state_reason: success
related_commit:
  - 6d8c044  # docs(adr): clarify market role and adapter architecture (ADR-003); add adapter spec; archive backlog/48_jinja_integration.md
  - 5d612db  # feat(sdk): add adapter interface contracts and tests
test_results: "2026-02-13: uv run --with pytest --with pytest-benchmark --with-editable ./temple python -m pytest temple/tests/test_adapter_sdk.py -q (4 passed)."
dependencies:
  - "[[003-market-role-and-adapter-architecture.md]]"
estimated_hours: 24
actual_hours: 4
completed_date: 2026-02-13
priority: high
---

## Goal

Design and implement the concrete adapter SDK in `temple/sdk/adapter.py` and document the adapter contract. Provide reference types (`AdapterParseResult`, `IR` nodes, `Diagnostic`) and unit tests for the adapter interfaces.

## Deliverables

- `temple/sdk/adapter.py` with typed Python interfaces
- Unit tests validating `parse_to_ir` and `source_map` behaviors
- Example usage docs and API docs in `temple/docs/ADAPTER_SPEC.md`

## Acceptance Criteria

- Adapter interfaces are type-annotated and importable
- Tests pass validating sample parse results and diagnostic shapes
- Documentation added linking to ADR-003

## Progress Notes

- 2026-02-13: Added `temple/sdk/adapter.py` with typed IR nodes, `AdapterParseResult`, `AdapterBase`, source-map mapping helpers, and filter-discovery traversal utilities plus unit coverage in `temple/tests/test_adapter_sdk.py`.
