# ADR 005: Base-Lint Strategy and Diagnostics Pipeline

## Status
**Accepted** - February 14, 2026

## Context

Temple must provide both template-language diagnostics and base-language linting/formatting feedback in a single authoring flow. Recent integration work showed repeated failure modes:

- base-linter behavior diverges by extension and URI scheme support
- raw `.tmpl` linting leaks into diagnostics and creates false positives
- temp-file diagnostics are not consistently mapped to source files
- stale/duplicate diagnostics appear under edit bursts
- parser errors expose internal token names and low-clarity messages

The project needs a single, deterministic strategy that works across base languages, preserves workspace-local tool configuration, and maintains responsive UX.

## Decision

Temple will use a **strategy resolver** with this precedence order:

1. **Embedded adapter strategy**
   - If a Temple adapter exists for the base tool/language, run embedded linting directly in Temple.

2. **Virtual document strategy**
   - If no embedded adapter is available and the target extension supports in-memory URI handling for diagnostics/linting, use a virtual URI flow.

3. **Mirror-file ghost strategy**
   - If virtual is not supported, use a collocated hidden sibling ghost file as fallback.
   - Diagnostics from ghost files must be remapped to the original `.tmpl` URI before publication.

Mode behavior:

- `auto` (default): choose highest available strategy by precedence.
- `embedded`: require embedded when available; otherwise fall back in precedence order with explicit trace reason.
- `vscode`: skip embedded and choose `virtual` then `mirror-file`.

Additional operational rules:

- **Focus mode is cross-language**, not markdown-specific.
- **Diagnostics ownership is canonicalized** with dedupe across Temple/base channels.
- **Queueing + cancellation + adaptive debounce** are required to suppress stale diagnostics.
- **Cache reset on extension reload** is required for deterministic behavior.
- **Log level is configurable** to support deep troubleshooting without noisy defaults.

## Rationale

- Preserves Temple’s core value: deterministic author-time validation in mixed template/base documents.
- Supports heterogeneous VS Code extension behavior without forcing one brittle path.
- Keeps workspace and nested-config resolution intact via collocated fallback when needed.
- Makes performance and diagnostics quality explicit non-functional requirements, not incidental behavior.

## Alternatives Considered

1. **Temp directory mirror files only**
   - Rejected: breaks nested config resolution and creates poor source mapping/lifecycle behavior.

2. **Virtual URIs only**
   - Rejected: many extensions do not provide reliable lint/diagnostic support for custom in-memory schemes.

3. **Embedded only**
   - Rejected: not feasible across all base languages/tools; blocks broad VS Code compatibility.

4. **Ignore base linting and keep Temple-only diagnostics**
   - Rejected: violates Temple’s core premise of combined template + base author-time validation.

## Consequences

### Positive

- Deterministic strategy selection and fallback behavior.
- Better compatibility across base-language tools.
- Clear path to improved latency and reduced stale diagnostics.
- Explicit UX standards for diagnostics clarity and ownership.

### Costs and Risks

- Added complexity in resolver/capability registry and lifecycle management.
- Need robust tests for remapping, dedupe, and concurrency behavior.
- Ongoing maintenance to expand embedded adapter coverage.

## Implementation Notes

- Backlog implementation chain starts at `backlog/archive/73_lock_base_lint_strategy_and_publish_adr_005.md` and continues with active items 74-77.
- Resolver/capability registry and fallback strategies are implemented in subsequent backlog items 74-77.
- Mirror-file fallback should use hidden collocated siblings and repo-safe ignore patterns.

## References

- `temple/docs/adr/003-market-role-and-adapter-architecture.md`
- `backlog/archive/67_fix_lsp_base_diagnostics_transport.md`
- `backlog/archive/68_repair_vscode_extension_integration.md`
- `backlog/archive/73_lock_base_lint_strategy_and_publish_adr_005.md`
