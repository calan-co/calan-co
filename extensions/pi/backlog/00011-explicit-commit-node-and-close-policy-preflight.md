---
id: wi-00011
title: Explicit Commit Node and Close Policy Preflight
summary: Replace implicit auto-capture commits and close-by-error retries with explicit graph nodes and typed repair paths.
type: work-item
subtype: task
lifecycle: proposed
status: proposed
status_reason: follow-up technical debt from Agent Workflows MVP
priority: high
estimated: 5
links:
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - agent-workflows
  - sandcastle
  - git
  - technical-debt
---

## Goal

Make commit creation and Work Source close readiness explicit graph responsibilities instead of relying on implicit dirty-worktree auto-capture and happy-path error handling.

## Background

The MVP flow currently relies on agents to commit changes and on `git.worktree` to auto-capture remaining dirty changes with a generic fallback message. This produces weak commit messages and leaves git hook or commitlint failures outside a typed repair path.

The current `work.close` finalizer loop is also an MVP compatibility shim: it attempts closure, treats provider policy failures as errors, prompts an agent to repair the missing metadata, and retries. This works for simple cases but is inefficient and not scalable. For Doc-Vader-backed work sources, `work.close` may dirty the worktree again because closing updates the underlying work item file, so commit handling and close handling need an explicit design rather than relying on incidental retry order.

## Tasks

- [ ] Add an explicit `git.commit` graph node that stages and commits repository changes with normal git hooks enabled.
- [ ] Let `git.commit` expose structured failure context when hooks or commitlint reject the attempted commit.
- [ ] Support a bounded MVP repair loop for `git.commit` analogous to the current `work.close.finalize` pattern.
- [ ] Route commit-message or staged-change repair through an agent prompt without duplicating external commitlint/conventional-commit rules in Agent Workflows config.
- [ ] Demote `git.worktree` dirty auto-capture to compatibility fallback or fail-closed behavior when an explicit `git.commit` node is expected.
- [ ] Replace close-by-error happy-path control flow with explicit Work Source readiness/preflight output that reports machine-readable blockers before invoking `work.close`.
- [ ] Account for Work Source close operations that dirty the worktree, especially Doc-Vader work item file updates, by defining where post-close commits happen.

## Deliverables

- Graph model/schema support for an explicit `git.commit` node.
- Runtime implementation and run-record evidence for commit attempts, hook failures, repairs, and resulting commit SHAs.
- Updated default pipelines that place commit handling deliberately around implementation, review, close, and merge.
- Typed close readiness/preflight design or implementation that avoids relying on close failure as the normal control plane.
- Tests covering commit hook failure repair, dirty worktree fallback behavior, and Doc-Vader close dirtying the worktree.

## Acceptance Criteria

- [ ] A pipeline can commit implementation changes through an explicit `git.commit` node and surface the commit SHA as a repository effect.
- [ ] Commit hook or commitlint failure causes a bounded repair iteration with the exact git failure output included in the repair context.
- [ ] Agent Workflows does not codify duplicate conventional-commit or commitlint templates when repo-local hooks/config already define the policy.
- [ ] `git.worktree` no longer silently creates generic semantic commits in pipelines that opt into explicit commit handling.
- [ ] Work Source close readiness can report blockers without first failing a close command on the happy path.
- [ ] Doc-Vader close mutations that dirty work item files are either committed by an explicit post-close commit path or reported as an unresolved dirty-worktree blocker.
