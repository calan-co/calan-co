# PRD: Sandcastle-backed backlog processing commands for Pi

## Goal

Define a deterministic command surface for Pi users to configure Sandcastle-backed execution, run primitive AFK work, inspect backlog items, plan processing, and start durable backlog pipelines.

## User stories

1. As a Pi user, I want one Sandcastle config command, so that init, viewing, getting, setting, resetting, and validating config are organized consistently.
2. As a Pi user, I want config init to preserve edited repo-local files, so that setup is safe to rerun.
3. As a Pi user, I want config validation diagnostics, so that broken roles, prompts, pipelines, models, sandbox providers, and runner files are clear.
4. As a Pi user, I want repo-local config defaults, so that repeated Sandcastle runs use predictable agent, model, sandbox, and pipeline choices.
5. As a Pi user, I want prompt templates and pipeline definitions to be explicit files, so that AFK behavior is reviewable.
6. As a Pi user, I want command handlers to use injectable capabilities, so that tests never require real containers or agents.
7. As a Pi user, I want run records to be durable and repo-scoped, so that AFK work can be inspected after the fact.
8. As a Pi user, I want `/work:run [agent] [prompt]`, so that I can run one Sandcastle-backed agent without invoking a backlog workflow.
9. As a Pi user, I want `/work:pipeline <pipeline> [prompt]`, so that I can run a fixed domain pipeline directly.
10. As a Pi user, I want `/work:runs`, so that I can list recent Sandcastle-backed runs in the current repo.
11. As a Pi user, I want `/work:status [run-id]`, so that I can inspect the current, latest, or specified run.
12. As a Pi user, I want `/work:logs [run-id]`, so that I can inspect logs for an AFK run.
13. As a Pi user, I want `/work:cancel [run-id|all]`, so that I can stop in-flight Sandcastle work.
14. As a Pi user, I want `/work:resume [run-id]`, so that I can continue interrupted Sandcastle work when the API provider supports resume.
15. As a Pi user, I want `/work:list [query]`, so that I can see matching backlog items without starting work.
16. As a Pi user, I want `/work:plan [query] --iterations N`, so that I can get a read-only, multi-iteration plan across backlog items.
17. As a Pi user, I want `/work:next [query]`, so that I can get the next recommended backlog processing iteration without reading a full plan.
18. As a Pi user, I want `/work:next` to be a thin alias of `/work:plan --iterations 1`, so that the semantics stay simple.
19. As a Pi user, I want `/work:inspect <item>`, so that I can get item-level analysis, risks, relevant files, and a recommended pipeline without starting work.
20. As a Pi user, I want `/work:process [query] --pipeline <pipeline>`, so that I can start durable Sandcastle-backed processing for a backlog item or query.
21. As a Pi user, I want `/work:process` to accept a query, so that I can process “auth bugs” or “label:small” directly without first creating a persistent selection.
22. As a Pi user, I want pipeline selection to be explicit via `--pipeline`, so that query text is never confused with a pipeline name.
23. As a Pi user, I want `/work:process` to infer a recommended pipeline when `--pipeline` is omitted, so that common workflows require minimal typing.
24. As a Pi user, I want `/work:process` to support multiple items when the selected pipeline supports parallelism, so that independent backlog work can proceed AFK.
25. As a Pi user, I want backlog process records to preserve resolved items and pipeline details, so that runs remain auditable.
26. As a Pi user, I want `/work:runs`, so that I can list durable backlog processing runs.
27. As a Pi user, I want `/work:status [run-id]`, so that I can inspect the current/latest/specified backlog processing run.
28. As a Pi user, I want `/work:resume [run-id]`, so that I can continue the latest failed/interrupted run by default and specify an ID only for disambiguation.

## Boundaries

`/work:*` commands expose Sandcastle configuration, primitive execution, and run management. `/work:*` commands expose backlog discovery, planning, durable processing, and backlog-run management. PR lifecycle automation is intentionally out of scope and belongs under a future `/pr:*` namespace.
