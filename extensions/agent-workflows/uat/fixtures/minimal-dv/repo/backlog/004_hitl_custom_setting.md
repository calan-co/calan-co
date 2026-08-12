---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-004
title: Choose custom UAT setting
summary: Ask the user to choose a custom setting; this item is intentionally HITL and must be skipped by AFK processing.
type: work-item
subtype: task
lifecycle: active
status: blocked
status_reason: hitl-required
priority: medium
estimated: 1
links:
  evidence: []
tags:
  - hitl
  - uat
---

## Goal

Ask the user to choose a custom setting for a hypothetical follow-up.

## Background

This item intentionally requires human judgement. It validates that AFK processing skips HITL work instead of inventing a user preference.

## Tasks

- [ ] Ask the user which custom setting they prefer.
- [ ] Record the chosen setting and rationale.
- [ ] Create follow-up AFK implementation work if needed.

## Deliverables

- User-selected custom setting.
- Decision rationale.

## Acceptance Criteria

- [ ] AFK processing does not implement this item.
- [ ] The item remains non-completed until a human decision is provided.
- [ ] UAT logs report that `wi-004` was skipped because it is HITL.

## Relationships

- `depends_on`: none
