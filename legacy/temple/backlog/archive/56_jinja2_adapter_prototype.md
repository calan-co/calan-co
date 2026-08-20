---
title: Jinja2 Adapter Prototype
id: 56
status: completed
state_reason: success
related_commit:
  - 6d8c044  # docs(adr): clarify market role and adapter architecture (ADR-003); add adapter spec; archive backlog/48_jinja_integration.md
  - f51a2ea  # feat(adapters): add jinja2 adapter prototype
test_results: "2026-02-13: uv run --with pytest --with pytest-benchmark --with jinja2 --with-editable ./temple python -m pytest temple/tests/test_jinja2_adapter.py -q (4 passed)."
dependencies:
  - "[[55_adapter_spec_impl.md]]"
estimated_hours: 40
actual_hours: 8
completed_date: 2026-02-13
priority: high
---

## Goal

Build a prototype adapter `temple.adapters.jinja2` that parses templates with Jinja2, walks the Jinja2 AST, produces the Temple IR, and emits diagnostics mapped to original source ranges.

## Deliverables

- Prototype adapter module `temple/adapters/jinja2_adapter.py`
- Source mapping heuristics for Jinja2 nodes → original ranges
- Mapping for a set of built-in filters to Temple filter signatures
- Parity fixtures comparing native and adapter diagnostics

## Acceptance Criteria

- Prototype can process representative templates and produce IR
- Diagnostics for undefined variables and simple type mismatches are produced and mapped
- Adapter documented with examples

## Progress Notes

- 2026-02-13: Implemented `temple.adapters.jinja2_adapter.Jinja2Adapter` prototype with Jinja AST-to-IR conversion, best-effort line-based source mapping, filter discovery, typed-AST conversion, and semantic diagnostic bridging through `TypeChecker`.
