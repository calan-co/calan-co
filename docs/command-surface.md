# Sandcastle Backlog Command Surface

Pi-Sandcastle separates `/backlog:*` for Sandcastle configuration, primitive execution, and run management. from `/backlog:*` for backlog discovery, planning, durable processing, and backlog run management.

## Setup and storage

Run `/backlog:config-raw init` to hydrate local Sandcastle support files. `/backlog:config-raw init` hydrates missing repo-local files and prompt templates without overwriting existing edits.

Durable run records and logs are stored under `.pi/sandcastle/results`. Durable state begins when `/backlog:process` or `/backlog:resume` executes a Sandcastle-backed pipeline.

## Sandcastle primitive commands

- `/backlog:config-raw` manages repo-local Sandcastle config.
- `/backlog:run [agent] [prompt]` runs one configured agent with free-form prompt text.
- `/backlog:pipeline <pipeline> [prompt]` runs a fixed domain pipeline directly.
- `/backlog:runs` lists recent primitive Sandcastle runs.
- `/backlog:status [run-id]` inspects the current, latest, or specified primitive run.
- `/backlog:logs [run-id]` prints or returns the log path for a primitive run.
- `/backlog:cancel [run-id|all]` cancels active primitive run work.
- `/backlog:resume [run-id]` resumes a primitive run when the provider supports resumable execution.

## Backlog commands

- `/backlog:list [query]` lists matching backlog items without starting work.
- `/backlog:plan [query] --iterations N` produces a read-only multi-iteration processing plan.
- `/backlog:next [query]` is a thin alias for `/backlog:plan --iterations 1`.
- `/backlog:inspect <item>` returns item-level analysis, risks, relevant files, testing notes, and a recommended pipeline.
- `/backlog:process [query] --pipeline <pipeline>` starts durable processing for the resolved backlog query.
- `/backlog:runs` lists durable backlog process runs.
- `/backlog:status [run-id]` inspects the current, latest, or specified backlog process run.
- `/backlog:resume [run-id]` resumes a durable backlog process run when metadata and provider support make that safe.

## Parsing rules

Backlog commands treat all non-flag text as query text. Pipeline selection is explicit through `--pipeline` or `-p`. If `/backlog:process` appears to treat query text as a pipeline, use `--pipeline <name>` or `-p <name>` and keep the remaining words as query text.

Example: `/backlog:process auth bugs --pipeline implement` uses `auth bugs` as query text and `implement` as the pipeline.

## Boundary

Read-only commands never create durable records. Durable state begins when `/backlog:process` or `/backlog:resume` executes a Sandcastle-backed pipeline. Future PR workflow belongs under a separate `/pr:*` namespace.
