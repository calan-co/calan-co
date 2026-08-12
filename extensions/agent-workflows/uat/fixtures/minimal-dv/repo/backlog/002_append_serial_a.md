---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-002
title: Append first dependent UAT line
summary: Append wi-002 to the UAT test file after wi-001 creates it.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: ready
priority: high
estimated: 1
links:
  evidence: []
  depends_on:
    - wi-001
tags:
  - afk
  - uat
---

## Goal

Append the first dependent line to `test.txt`.

## Background

This item depends on `wi-001`. It exercises a later AFK wave after the baseline file exists.

## Tasks

- [ ] Confirm `test.txt` already exists.
- [ ] Append a new line `wi-002` to `test.txt` if it is not already present.
- [ ] Run `node --test test/uat-fixture.test.js` and confirm the focused test command passes for the current state.

## Deliverables

- Root-level `test.txt` containing `wi-002`.
- Validation output for `node --test test/uat-fixture.test.js`.

## Acceptance Criteria

- [ ] `test.txt` contains the line `wi-002`.
- [ ] The change preserves the existing `wi-001` line.
- [ ] This Work Item is closed as completed only after validation passes.

## Relationships

- `depends_on`: wi-001
