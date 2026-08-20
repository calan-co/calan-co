# Changelog

## 2026-01-15 — Control-flow closer canonicalization

- Change: Control-flow blocks now use a single canonical closer `{% end %}`.
  Rationale: Simplifies parsing and rendering logic; avoids proliferation of
  `end`/`end`/`end` variants which previously required special
  handling during validation and diagnostics.

- Compatibility: Templates using `end`, `end`, `end`, or other
  `end<suffix>` variants will no longer be treated as closers. Such tokens are
  preserved as plain statements; their openers will be reported as unclosed
  blocks if not closed by a canonical `{% end %}`.

- Impact: The test-suite and tooling were updated to reflect the canonical
  closer. Consumers intending to rely on `end<suffix>` should migrate templates
  to `{% end %}`. See ADR-004 (control-flow rendering) for discussion.
