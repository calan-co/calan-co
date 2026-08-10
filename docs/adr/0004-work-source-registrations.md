# Work Source Registrations

## Status

Accepted

Agent Workflows selects exactly one named Work Source Registration per repository. Every source uses the same Registration model: the selected Registration owns native reads, readiness, mutations, and preserved source material, while unselected Registrations are dormant beyond display and selection. Runtime-pack entries are ordinary Registrations, not a special built-in category.

## Consequences

The implicit local Markdown/backlog reader is removed outright. Work Source mutations occur through explicit graph nodes, not source-specific merge hooks. A selected Registration is checked when configuration is validated and again before execution; malformed source output, unavailable capabilities, or registration drift fail closed with diagnostics preserved. Plan Artifacts and Run Records retain the Registration identity and revalidate it on resume. Registrations are introduced as dormant and become selectable only after shared adapter-contract and native-fixture tests pass.

## Considered Options

We rejected a closed Work Source enum, implicit Doc-Vader/backlog behavior, generic core parsing of native source output, silent mutation skips, and source-specific merge hooks. These alternatives obscure the Work Source seam and distribute source rules across Agent Workflows modules.
