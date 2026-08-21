---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-001
title: Create UAT test file
summary: Create the baseline test.txt file used by downstream AFK work.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: ready
priority: high
estimated: 1
links:
  evidence: []
tags:
  - afk
  - uat
---

## Goal

Create `test.txt` as the visible repository artifact for the Agent Workflows UAT fixture.

## Background

This is the first AFK item. Later items depend on this file existing, so successful completion proves the worker can make a repository change, validate it, close the item, and merge the branch back to the base branch.

## Tasks

- [ ] Create `test.txt` at the repository root.
- [ ] Add the line `wi-001` to `test.txt`.
- [ ] Run `node --test test/uat-fixture.test.js` and confirm the focused test command passes for the current state.

## Deliverables

- Root-level `test.txt` committed on the work branch.
- Validation output for `node --test test/uat-fixture.test.js`.

## Acceptance Criteria

- [ ] `test.txt` exists.
- [ ] `test.txt` contains the line `wi-001`.
- [ ] This Work Item is closed as completed only after validation passes.

## Relationships

- `depends_on`: none
