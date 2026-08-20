# Backlog

This folder tracks planned and active work items.

## What Belongs Here

- `backlog/*.md`: open work items
- `backlog/archive/*.md`: completed work items
- one file per work item, with frontmatter + acceptance criteria

## What Does Not Belong Here

- long-lived status dashboards
- manually maintained file indexes
- timeline snapshots that will drift quickly

## Source Of Truth

- The work item file itself is the source of truth for:
  - status
  - dependencies
  - acceptance criteria
  - test evidence and related commits

## Lifecycle

1. Create item in `backlog/` with clear goal and acceptance criteria.
2. Move status through `not_started -> in_progress -> testing -> completed`.
3. Record test results and related commits in the item.
4. Archive completed item to `backlog/archive/`.

## Conventions

- Filename format: `<id>_<short_snake_case_title>.md`
- Keep scope small and dependency links explicit (`[[other_item.md]]`).
- Prefer updating existing items over creating overlapping duplicates.
