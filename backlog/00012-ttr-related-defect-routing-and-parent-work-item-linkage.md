---
id: wi-00012
title: TTR Related-Defect Routing and Parent Work-Item Linkage
summary: Route scoped defect domains to their TTR POC and retain separate child evidence under one authoritative parent work item.
type: work-item
subtype: task
lifecycle: in-progress
status: in-progress
status_reason: TTR-owned defect intake ttr-c8922be6-0235-4173-91d6-4e768638b293
priority: high
estimated: 3
tags:
  - ttr
  - defect-tracking
  - lifecycle
---

## Goal

Allow TTR to track related lifecycle defects independently while routing scoped domains to the configured TTR POC and sharing a single parent authoritative work item where explicitly linked.

## Background

A Doc-Vader Babysitter lifecycle run can surface multiple integration defects. The current TTR model resolves POCs only by exact domain keys, permits only one defect per authoritative work item, and has no parent/child defect relation. Consequently, scoped domains can become unassigned and linked evidence must be split across duplicate work items.

This is a TTR-extension defect, not a domain-POC implementation assignment. Domain POCs may provide evidence but cannot be assigned solutioning without explicit authority.

## Supporting investigation

See [`docs/architecture/ttr-related-defect-routing-investigation.md`](../docs/architecture/ttr-related-defect-routing-investigation.md) for the evidence-backed investigation that identified the exact-domain POC-routing and one-work-item-per-defect limitations addressed by this work item.

## Tasks

- [ ] Add configured canonical-domain, alias, and prefix routing for POC resolution while preserving exact-domain fallback behavior.
- [ ] Model and validate a related-defect parent/child relationship.
- [ ] Add `ttr_link_related_defect` to link a child to a parent and inherit the parent's authoritative work item in lane and evidence preambles.
- [ ] Preserve each child defect's intake, evidence, ownership, and status history.
- [ ] Prevent non-POC evidence reporters from being assigned TTR diagnosis or implementation lanes without explicit authority.
- [ ] Update command/tool documentation and regression coverage.

## Deliverables

- Durable TTR state schema and migration-compatible routing/linkage model.
- Tool surface for related-defect linking and canonical/alias/prefix POC configuration.
- Focused command and core regression tests for scoped routing, parent linkage, inherited preambles, and POC ownership boundaries.

## Acceptance Criteria

- [ ] A configured canonical domain routes its aliases and configured prefixes to the same active POC.
- [ ] Exact registered domains continue to resolve when no canonical mapping applies.
- [ ] A linked child defect retains its own intake and evidence while resolving its parent's authoritative work item for supported lane/evidence preambles.
- [ ] The same authoritative work item can be associated with explicitly linked related defects but not unrelated defects.
- [ ] The TTR tool surface rejects solutioning-lane assignment by a non-POC evidence reporter unless explicit authority is recorded.
- [ ] Focused regression tests and the relevant broader suite pass.
