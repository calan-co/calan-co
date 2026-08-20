# Activity Log

A structured record of significant sessions, decisions, and learnings that shape development.

## Purpose

Captures institutional knowledge and strategic context that extend beyond individual work items. Work items track **what was done**; activity logs capture **why decisions were made** and **what we learned**.

## Contents

- **Session Post-Mortems** (`session-*.md`): Retrospectives on major implementation cycles
- **Strategic Decisions** (`adr-implementation-notes.md`): Rationale and tradeoffs for ADRs
- **Learnings & Blockers** (`blockers-and-lessons.md`): Known issues and recommendations

## Format

All entries use standardized frontmatter for discoverability:

```yaml
---
date: YYYY-MM-DD
session_id: descriptive-id-timestamp
type: postmortem | decision | retrospective | blocker
related_work_items:
  - [[<001-work-item-file>]]
  - [[<002-work-item-file>]] 
  - [[<003-work-item-file>]]
related_adr:
  - [[adr-file-001]]
---
```

## When to Create an Entry

- **Post-mortem**: After completing a multi-part sprint or addressing architectural issues
- **Decision log**: When evaluating design tradeoffs or choosing between approaches
- **Blocker report**: When discovering systemic issues or delays
- **Retrospective**: At major milestones (v0.1.0, feature freeze, etc.)

## Lifecycle

1. Created during/after session
2. Reviewed and linked from related work items
3. Remains immutable for historical accuracy
4. Referenced in future sessions when similar decisions arise

---

For guidelines, see `TEMPLATE.md`.
