# Pi Sandcastle extension

Project-local Pi extension that exposes the updated Sandcastle `/sc:*` and backlog `/backlog:*` command surfaces while using Sandcastle as the sandboxed execution runtime.

## Install/runtime prerequisites

```bash
npm install --save-dev @ai-hero/sandcastle
npx @ai-hero/sandcastle init   # optional but recommended for .sandcastle env setup
```

Then reload Pi from this repo with `/reload`.

## Sandcastle commands

- `/sc:config setup|show|get|set|reset|validate` — create, inspect, mutate, reset, and validate repo-local Sandcastle config.
- `/sc:run [agent] <prompt>` — run one configured Sandcastle-backed agent directly.
- `/sc:pipeline <pipeline> [prompt]` — run a fixed-domain pipeline.
- `/sc:runs` — list durable Sandcastle runs.
- `/sc:status [run-id]` — inspect the active, latest, or specified Sandcastle run.
- `/sc:logs [run-id]` — show the stored log path for a run.
- `/sc:cancel [run-id]` — cancel active Sandcastle work.
- `/sc:resume [run-id]` — resume resumable Sandcastle work.

## Backlog commands

- `/backlog:list [query]` — list backlog items without mutation.
- `/backlog:inspect <item-id>` — inspect one backlog item without mutation.
- `/backlog:plan [query] --iterations N` — plan read-only backlog iterations.
- `/backlog:next [query]` — plan the next backlog iteration.
- `/backlog:process [query] --pipeline <pipeline>` — start durable backlog processing.
- `/backlog:runs [query]` — list backlog processing runs.
- `/backlog:status [run-id]` — inspect a backlog processing run.
- `/backlog:resume [run-id]` — resume a resumable backlog processing run.

## LLM tool

`delegate_agent({ agent, task })` lets the primary Pi agent delegate self-contained tasks to configured agents without exposing the removed legacy slash-command aliases.

## Config and artifacts

Edit `.pi/sandcastle/agents.yaml` for agents, teams, and chains. The default scaffold includes `researcher`, `builder`, and `reviewer` agents and an `explore-plan-review` chain.

Run artifacts are written under `.pi/sandcastle/results/`, `.pi/sandcastle/jobs/`, `.pi/sandcastle/runs/`, and `.pi/sandcastle/backlog-runs/`.
