---
id: wi-001
title: Define the built-in Doc-Vader delivery contract and ready selection
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
links:
  depends_on: []
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

- [ ] Specify the built-in argv-based `dv work ready`, `show`, `status`/validate, and close command contracts.
- [ ] Define versioned JSON schemas for their accepted results and compatible override declarations.
- [ ] Implement fail-closed parsing and diagnostics for missing, malformed, ambiguous, or incompatible results.
- [ ] Implement optional explicit work-ID selection and automatic selection after AFK/HITL/dependency filtering.
- [ ] Sort automatic candidates by priority then stable work ID.

## Deliverables

- [ ] Versioned Doc-Vader contract module and schemas.
- [ ] Unit tests covering valid results and fail-closed cases.
- [ ] Documented compatibility/override seam.

## Acceptance Criteria

- [ ] An explicit work ID is accepted only when its canonical result satisfies the built-in AFK-ready rules.
- [ ] Automatic selection is deterministic: eligibility filtering precedes priority then stable-ID ordering.
- [ ] Invalid command output, unsupported schema version, ambiguous readiness, missing dependencies, and HITL work fail closed with actionable diagnostics.
- [ ] No code path parses backlog Markdown as a substitute for structured Doc-Vader output.

## Dependencies

None.
