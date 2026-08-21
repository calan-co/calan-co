# Full Execution Runtime config with Roles

Agent Workflows uses a full repo-local Execution Runtime config with `roles`, task prompts, pipelines, policies, providers, and adapter choices visible in configuration, rather than a thin overrides file or Sandcastle template scaffold. We use **Role** as the domain term for reusable execution identities and reserve **Agent Provider** for external tools such as Pi, Claude Code, Codex, Cursor, OpenCode, and Copilot; Sandcastle remains a background execution adapter rather than a user-facing product model.
