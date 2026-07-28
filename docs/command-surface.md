# Agent Workflows command surface

Agent Workflows exposes `/work:*` commands for runtime configuration, primitive role execution, workflow runs, Work discovery, planning, durable processing, and run management.

## Setup and storage

Run `/work:config init` to hydrate local runtime support files. `/work:config init` hydrates missing repo-local files and prompt templates without overwriting existing edits. `/work:config-raw` remains a deprecated compatibility alias for scripted callers.

Durable run records and logs are stored under `.pi/sandcastle/runs` and `.pi/sandcastle/results`. Cached planning artifacts are stored under `.pi/sandcastle/plans`. Durable state begins when `/work:process` or `/work:resume` executes an adapter-backed graph pipeline.

## Runtime and execution commands

- `/work:config` opens the friendly runtime configuration UI and owns `show|init|edit|editor|get|set|reset|validate` subcommands.
- `/work:config-raw` is a deprecated compatibility alias for `/work:config` subcommands.
- `/work:build-image [docker|podman]` builds the repo execution sandbox image.
- `/work:run [role] [prompt]` runs one configured Role with free-form prompt text.
- `/work:pipeline <pipeline> [prompt]` runs a graph-native Pipeline directly.
- `/work:runs` lists recent Work Process runs.
- `/work:status [run-id]` inspects the current, latest, or specified Work Process run.
- `/work:logs [run-id]` prints or returns the log path for a Work Process run.
- `/work:cancel [run-id|all]` cancels active Work Process work when supported.
- `/work:resume [run-id]` resumes a Work Process run when metadata and provider support make that safe.

## Work commands

- `/work:list [query]` lists matching Work Items without starting work.
- `/work:ready [query]` lists deterministic ready Work candidates from the configured Work Source.
- `/work:plan [query] --iterations N` runs the configured read-only `planWork` phase and caches a schema-validated Plan Artifact.
- `/work:next [query]` is a thin alias for `/work:plan --iterations 1`.
- `/work:inspect <item>` returns Work Item analysis, risks, relevant files, testing notes, and planning context.
- `/work:process [query] --pipeline <pipeline>` starts durable processing for the resolved Work query through graph lanes and per-lane worktrees.
- `/work:process --plan <plan-id> [--pipeline <pipeline>]` starts durable processing from a previously cached Plan Artifact, optionally overriding the policy-selected pipeline during this transition slice.

## Parsing rules

Work commands treat all non-flag text as query text. Pipeline selection is explicit through `--pipeline` or `-p`. If `/work:process` appears to treat query text as a pipeline, use `--pipeline <name>` or `-p <name>` and keep the remaining words as query text.

Example: `/work:process auth bugs --pipeline implement` uses `auth bugs` as query text and `implement` as the pipeline.

## Boundary

Discovery commands such as `/work:list`, `/work:inspect`, and `/work:ready` do not create durable records. `/work:plan` creates a cached Plan Artifact but does not execute implementation work. Durable state begins when `/work:process` or `/work:resume` executes an adapter-backed graph pipeline. Future PR workflow belongs under a separate `/pr:*` namespace.
