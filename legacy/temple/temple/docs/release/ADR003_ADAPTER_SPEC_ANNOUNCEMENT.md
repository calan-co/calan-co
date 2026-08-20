# ADR-003 + Adapter Spec Release Note (Draft)

## Summary

Temple has published two architecture documents that define the next expansion phase after Temple-native MVP hardening:

- `temple/docs/adr/003-market-role-and-adapter-architecture.md`
- `temple/docs/ADAPTER_SPEC.md`

These documents establish Temple as the type-safety and validation core, with adapter-based interoperability for third-party template engines (starting with Jinja2).

## Key Points

- Temple-native remains the baseline implementation for parser/type-check/render behavior.
- Adapters must translate engine syntax to Temple IR and preserve source mapping for diagnostics.
- Filter validation now has explicit typed signature expectations through the filter registry contract.
- Jinja2 is the first prototype target to validate the adapter model end-to-end.

## Internal Announcement Template

Subject: Temple ADR-003 + Adapter Spec published

Body:

We have published ADR-003 and the first Adapter Spec draft:

- ADR-003: `temple/docs/adr/003-market-role-and-adapter-architecture.md`
- Adapter Spec: `temple/docs/ADAPTER_SPEC.md`

This formalizes our architecture direction: Temple-native as the core validation engine, with adapters for ecosystem interoperability (Jinja2 first). Current MVP work is now tracked against native completion, adapter SDK, Jinja2 prototype, and parity tests.

Please review and leave feedback on:
1. Required IR surface for adapters
2. Source-map precision requirements
3. Filter signature compatibility assumptions

## Status

- Drafted for MVP release packet
- Ready for review and channel-specific distribution
