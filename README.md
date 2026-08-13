# babysitter-dv

A stack-neutral Babysitter blueprint for deterministic, Doc-Vader-backed AFK repository delivery.

The implementation is planned in `backlog/`.

## Doc-Vader compatibility

The built-in Doc-Vader command contract is the default. Repositories may supply an **optional repository override** for command argv only when it declares `compatibleWith: ["doc-vader-contract/v1"]`. Overrides must continue to request the same versioned structured JSON results; they do not change readiness, policy, acceptance, or evidence controls.
