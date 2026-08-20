---
date: YYYY-MM-DD
session_id: descriptive-id-timestamp
type: postmortem | decision | retrospective | blocker
related_work_items:
  - [[XXX-WORK-ITEM-NAME]]
related_adr: 
  - [[ADR-XXX-NAME]]
participant_roles: [review, implementation, architecture, testing]
---

# Session Title

Concise description of what this session addressed.

## Context

Background: Why was this session needed? What problem triggered it?

## Actions Taken

Brief summary of work completed:

- Item 1 (work item reference, commit hash)
- Item 2 (work item reference, commit hash)
- Item 3 (work item reference, commit hash)

## Key Decisions

### Decision 1: [Title]

**Rationale**: Why did we choose this approach?
**Alternatives considered**: What else did we evaluate?
**Tradeoffs**: What did we gain and lose?
**Impact**: How does this affect future work?

## Strategic Insights

### Pattern Observed  

Description of reusable pattern or anti-pattern discovered.

### Recommendation for Future Work

Actionable guidance for similar situations.

## Test Results Summary

High-level validation evidence:

- Tests passing: 267 core + 82 linter
- Coverage: [areas covered]
- Known gaps: [areas to monitor]

## Effort & Velocity

| Item      | Estimated | Actual   | Variance |
|-----------|-----------|----------|----------|
| #XX       | 4h        | 2h       | -50%     |
| #XX       | 3h        | 1h       | -67%     |
| #XX       | 2h        | 0.5h     | -75%     |
| **Total** | **9h**    | **3.5h** | **-61%** |

## Blockers Encountered

None / List any issues that delayed work.

## Follow-Up Items

- [ ] Action 1 (if needed)
- [ ] Action 2 (if needed)
- Reference to subsequent work items if created

## References

- [Related ADR](../adr/XXX.md)
- [Backlog Item #XX](../../backlog/XX_description.md)
- Relevant commits: `abc1234`, `def5678`
