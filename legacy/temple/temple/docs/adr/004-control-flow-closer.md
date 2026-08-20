"""
ADR 004: Canonicalize Control-Flow Closers to a Single `{% end %}`

Status: Accepted
Date: 2026-01-15
Authors: Temple maintainers
"""

# Context

Temple templates previously allowed multiple closing-token variants for
control-flow blocks: `{% end %}`, `{% end %}`, `{% end %}`, etc.
These `end<suffix>` variants required special-case handling in the parser,
block validator, and diagnostics mapping layer. Multiple variants also
increased cognitive load for users and complexity for tooling that maps
diagnostics between preprocessed and original template texts.

# Decision

We will canonicalize control-flow closers to a single token: `{% end %}`.

Concretely:
- The tokenizer and parser will continue to produce statement tokens for any
  `{% ... %}` block verbatim.
- The `temple` validator and renderer will treat only the exact keyword
  `end` as the semantic block closer. Other tokens that begin with `end` will
  be treated as plain statements.
- Tooling and diagnostics will no longer attempt to interpret `end`,
  `end`, `end` as closers; templates using those variants must be
  migrated to `{% end %}`.

# Rationale

- Simpler semantics: A single closer reduces surface area for bugs and makes
  nested-block validation straightforward (push on openers, pop on `end`).
- Consistent diagnostics: Mapping diagnostics between preprocessed text and
  original templates becomes simpler when there is only one closer form.
- Easier adoption: Author and tooling authors have a clear, canonical
  pattern to document and support.

# Alternatives Considered

- Keep `end<suffix>` variants and map them to the corresponding opener. This
  preserves backwards compatibility but requires additional mapping logic and
  complicated diagnostics in the linter and IDE integrations.
- Deprecate `end<suffix>` but accept them for a transition period. This
  requires a deprecation schedule and extra runtime heuristics; we opted for
  a clearer, immediate decision to avoid long-lived complexity.

# Consequences

- Backwards-incompatible for templates that rely on `end<suffix>` as a
  meaningful closer: those templates must be migrated.
- Tests and tools must be updated (done) and CI will validate the change.
- Documentation and changelog entries must clearly cite the decision and the
  recommended migration steps.

# Migration

Search-and-replace instances of `{% end %}`, `{% end %}`, `{% end %}`
and similar to `{% end %}`. Update examples and docs to use the canonical form.

# References

- Backlog item: `backlog/archive/26_control_flow_rendering.md`
- Changelog: `temple/docs/CHANGELOG.md`
