---
id: wi-00001
title: Sandcastle Backlog Processing Command Surface PRD
summary: Capture the approved product requirements and implementation slices for Sandcastle-backed Pi backlog processing commands.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 3
links:
  reference:
    - '[[sandcastle-backlog-processing]]'
tags:
  - prd
  - sandcastle
  - backlog
  - command-surface
  - hitl
---

## Goal

Codify the Sandcastle-backed backlog processing command surface so implementation agents can work from stable requirements.

## Background

This parent work item records the agreed PRD. Implementation is decomposed into AFK child work items that can proceed independently according to their dependency order.

## Tasks

- [ ] Audit the PRD and child work items after command implementation lands, not before.
- [ ] Confirm every child work item points at concrete extension files, command handlers, and behavior tests.
- [ ] Keep PR lifecycle scope explicitly out of the Sandcastle/backlog command surface.

## Deliverables

- Doc-Vader-compatible parent work item.
- PRD copied into docs/prd.
- Child AFK work items linked as references.

## Acceptance Criteria

- [ ] The PRD exists in docs/prd and names the intended user-visible command semantics.
- [ ] Each child work item defines a vertical slice with files to change, command registration, behavior tests, and runtime verification.
- [ ] No PR lifecycle implementation is included in this parent item.

