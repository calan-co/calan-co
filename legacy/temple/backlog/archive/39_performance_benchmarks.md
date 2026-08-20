---
title: Performance Benchmarks and Profiling
id: 39
status: complete
related_commit:
  - 40742b4  # feat(perf): add comprehensive ASV benchmarking suite (item 39)
dependencies:
  - "[[38_integration_and_e2e_tests.md]]"
related_backlog:
  - "[[40_ci_integration_and_docs.md]]"
estimated_hours: 16
priority: medium
---

## Goal

Measure and improve performance for tokenizer, type checker, and serializers using benchmarks and profiling.

## Tasks

- ✅ Add benchmark harness using `asv` under `temple/asv/benchmarks/`.
- ✅ Create representative large templates and datasets to simulate real workloads.
- ✅ Run profiling to identify hotspots and propose targeted optimizations.
- ✅ Record baseline results and add instructions to reproduce locally.

## Acceptance Criteria

- ✅ Benchmarks runnable with `asv run` and outputs stored under `temple/asv/results/`.
- ✅ Instructions and optimization plan documented in `temple/BENCHMARKING.md`.

## Notes

- Use the existing `.venv_asv_test` virtualenv for consistent environment.
