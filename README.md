# babysitter-dv

A stack-neutral Babysitter blueprint for deterministic, Doc-Vader-backed AFK repository delivery.

The implementation is planned in `backlog/`.

## Pilot gates

Use the pinned root commands:

```sh
npm ci
npm run test
npm run check
npm run pilot:rehearse
```

`pilot:rehearse` refuses a non-clean Git checkout, then runs the disposable-repository E2E fixture and emits a single `babysitter-pilot-rehearsal/v1` JSON evidence record containing the pinned checkout SHA, command, result, and TAP-output SHA-256.

## Doc-Vader compatibility

The built-in Doc-Vader command contract is the default. Repositories may supply an **optional repository override** for command argv only when it declares `compatibleWith: ["doc-vader-contract/v1"]`. Overrides must continue to request the same versioned structured JSON results; they do not change readiness, policy, acceptance, or evidence controls.
