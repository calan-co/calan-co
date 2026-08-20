# ADR 003: Market Role and Adapter Architecture

## Status
**Accepted** - January 2026

## Context

Temple aims to provide strong author-time guarantees for templates:

- typed expression and statement validation
- schema-aware query checks
- source-mapped diagnostics for editor and CI workflows

At the same time, many teams already run Jinja2 in production and want to keep
their runtime stack stable. A Temple strategy that requires full runtime
replacement raises migration friction and limits adoption, even when Temple's
validation and diagnostics are valuable.

The project needed a clear position on:

1. Temple-native runtime vs third-party runtime compatibility
2. how to preserve Temple's validation value when external engines are used
3. where interoperability boundaries should live

## Decision

Temple will be positioned as a **declarative, type-safe transformation and
validation core** with an **adapter architecture** for runtime interoperability.

Concretely:

1. **Temple-native remains first-class and independent**
   - Temple keeps its own parser/type-check/render pipeline.
   - Native behavior remains the baseline for correctness and diagnostics.

2. **Adapters are the interoperability boundary**
   - External template engines integrate through a small adapter SDK.
   - The first target adapter is Jinja2.

3. **Runtime model is selectable by use case**
   - `validate_with_temple + render_with_engine` (for compatibility-first
     adoption), or
   - `validate_with_temple + render_with_temple` (for stricter native control).

4. **Filter semantics are governed by Temple's typed registry**
   - Adapters map engine filter usage to Temple filter signatures.
   - Unknown filters are treated conservatively so diagnostics stay safe.

## Rationale

- Preserves Temple's differentiator: typed validation and diagnostics.
- Reduces migration risk for existing Jinja2 deployments.
- Avoids coupling Temple's value to one runtime engine.
- Supports incremental adoption: teams can start with validation, then choose
  runtime behavior later.

## Alternatives Considered

1. **Temple-native only**
   - Pros: full control and consistency.
   - Cons: higher adoption friction for existing Jinja2 ecosystems.

2. **Full Jinja2 embedding as primary runtime**
   - Pros: immediate ecosystem compatibility.
   - Cons: weakens Temple-native guarantees and blurs product identity.

3. **Design-time only, no native runtime path**
   - Pros: minimal runtime scope.
   - Cons: removes a strong end-to-end option and limits future evolution.

## Consequences

### Positive

- Clear product identity: Temple is the validation/type-safety core.
- Broader adoption path through compatibility mode.
- Explicit extension surface for future engines beyond Jinja2.

### Costs and Risks

- Adapter maintenance burden (AST mapping, source ranges, parity drift).
- Need parity testing between native and adapter-based diagnostics.
- Need precise documentation of what is guaranteed in each runtime mode.

## Implementation Notes

- Adapter contracts are specified in `temple/docs/ADAPTER_SPEC.md`.
- Prototype interfaces live in `temple/src/temple/sdk/adapter.py`.
- Initial Jinja2 adapter lives in `temple/src/temple/adapters/jinja2_adapter.py`.
- Native-vs-adapter parity checks live in
  `temple/tests/parity/test_native_vs_jinja2_parity.py`.

## References

- `temple/docs/ADAPTER_SPEC.md`
- `backlog/archive/48_jinja_integration.md`
- `backlog/archive/52_parity_tests_and_ci.md`
- `backlog/archive/55_adapter_spec_impl.md`
- `backlog/archive/56_jinja2_adapter_prototype.md`
