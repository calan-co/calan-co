---
id: wi-001
title: Define the built-in Doc-Vader delivery contract and ready selection
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: high
actual: 1
completed_date: '2026-08-12'
links:
  evidence:
    - '[[record-wi-001-focused-validation-and-independent-source-review-passed]]'
tags:
  - babysitter
  - doc-vader
  - afk
---

## Goal

Define and test the versioned built-in `dv work` command contract used by the delivery blueprint, including JSON schemas and deterministic AFK-ready selection.

## Background

Babysitter needs Doc-Vader as the authority for work-item discovery, eligibility, dependencies, validation, and closure. The built-in contract must be executable and schema-validated; it must not fall back to Markdown parsing or inferred command output. Repository-specific deviations remain optional, versioned overrides.

## Tasks

- [x] Specify the built-in argv-based `dv work ready`, `show`, `status`/validate, and close command contracts.
- [x] Define versioned JSON schemas for their accepted results and compatible override declarations.
- [x] Implement fail-closed parsing and diagnostics for missing, malformed, ambiguous, or incompatible results.
- [x] Implement optional explicit work-ID selection and automatic selection after AFK/HITL/dependency filtering.
- [x] Sort automatic candidates by priority then stable work ID.

## Deliverables

- [x] Versioned Doc-Vader contract module and schemas.
- [x] Unit tests covering valid results and fail-closed cases.
- [x] Documented compatibility/override seam.

## Acceptance Criteria

- [x] An explicit work ID is accepted only when its canonical result satisfies the built-in AFK-ready rules.
- [x] Automatic selection is deterministic: eligibility filtering precedes priority then stable-ID ordering.
- [x] Invalid command output, unsupported schema version, ambiguous readiness, missing dependencies, and HITL work fail closed with actionable diagnostics.
- [x] No code path parses backlog Markdown as a substitute for structured Doc-Vader output.

## Dependencies

None.

- 2026-08-12: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
