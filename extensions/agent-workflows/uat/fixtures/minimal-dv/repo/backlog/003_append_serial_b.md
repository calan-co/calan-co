---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-003
title: Append second dependent UAT line
summary: Append wi-003 to the UAT test file after wi-001 creates it.
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

Append the second dependent line to `test.txt`.

## Background

This item also depends on `wi-001`. Together with `wi-002`, it exercises the parallel dependent AFK wave after the first work item completes.

## Tasks

- [ ] Confirm `test.txt` already exists.
- [ ] Append a new line `wi-003` to `test.txt` if it is not already present.
- [ ] Run `node --test test/uat-fixture.test.js` and confirm the focused test command passes for the current state.

## Deliverables

- Root-level `test.txt` containing `wi-003`.
- Validation output for `node --test test/uat-fixture.test.js`.

## Acceptance Criteria

- [ ] `test.txt` contains the line `wi-003`.
- [ ] The change preserves the existing `wi-001` line.
- [ ] This Work Item is closed as completed only after validation passes.

## Relationships

- `depends_on`: wi-001
