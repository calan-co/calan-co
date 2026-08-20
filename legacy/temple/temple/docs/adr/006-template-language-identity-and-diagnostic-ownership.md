# ADR 006: Template Language Identity and Diagnostic Ownership

## Status

**Accepted (Amended)** - February 16, 2026

## Context

Temple originally auto-reassociated templated files (for example
`*.md.tmpl`, `*.json.tmpl`) to base language IDs such as `markdown` and
`json` to preserve editor features.

In practice, direct reassociation causes native linters/providers to run on raw
template source text before/alongside Temple's cleaned-content pipeline. That
produces misleading diagnostics and ambiguous ownership on the original source
URI.

The initial ADR-006 tranche removed reassociation and locked `templ-any`
ownership to protect diagnostics quality, but this also removed expected
base-language LSP affordances.

This amendment defines a shadow-bridge architecture that preserves Temple-owned
diagnostics while restoring full base-language LSP parity for an explicit
baseline of supported providers.

## Decision

Temple will keep source template documents on Temple-owned language identities
and provide base-language LSP capabilities through shadow documents.

Concretely:

- **No direct source reassociation**: Temple will not call
  `setTextDocumentLanguage` to switch source templates into raw base language
  IDs.
- **Per-format templated language IDs**: Temple will use explicit IDs for
  supported base formats:
  - `templ-markdown`
  - `templ-json`
  - `templ-yaml`
  - `templ-html`
  - `templ-xml`
  - `templ-toml`
  - plus `templ-any` fallback for unmatched templates.
- **Shadow-LSP bridge**: Temple will proxy base-language LSP features through
  cleaned shadow documents while remapping ranges/edits/locations back to the
  source template.
- **Diagnostics ownership invariant**: diagnostics shown to users must be
  source-owned Temple publications; mirror/shadow URIs must not appear in
  Problems as user-facing owners.
- **Bridge defaults/settings**:
  - `temple.baseLspBridgeMode`: `"full"` default (`"off"` optional)
  - `temple.baseLspParityBaseline`: `"official-defaults"` default

### Explicit Target Extension Baseline

The parity baseline is explicit and limited to:

1. `vscode.markdown-language-features`
2. `DavidAnson.vscode-markdownlint`
3. `vscode.json-language-features`
4. `redhat.vscode-yaml`
5. `vscode.html-language-features`
6. `redhat.vscode-xml`
7. `tamasfe.even-better-toml`

Providers outside this matrix are best-effort and may degrade gracefully with
trace logging.

## Decision Drivers

- Diagnostic correctness on templated sources.
- Source-only diagnostic ownership without mirror-file leakage.
- Full base-language LSP parity for defined supported providers.
- Predictable behavior through an explicit support matrix and testable scope.
- Maintainability through deterministic projection and remapping contracts.

## Alternatives Considered

1. **Direct reassociation to base language IDs**
   - Rejected: reintroduces raw-template lint noise and ambiguous ownership.

2. **Keep `templ-any` without LSP bridge**
   - Rejected: fails parity requirements for base-language authoring features.

3. **Guarantee parity for all installed extensions**
   - Rejected: not enforceable due to heterogeneous provider APIs and behavior;
     explicit matrix is required for testable guarantees.

## Consequences

### Positive

- Temple retains canonical diagnostic ownership on source template URIs.
- Base-language LSP capabilities are restored for the explicit support matrix.
- Clear implementation/test scope for PRs and release gating.

### Costs

- Higher implementation complexity (projection mapping, shadow lifecycle,
  provider proxying, edit safety checks).
- Ongoing maintenance of baseline provider matrix and parity tests.

### Risks

- Provider behavior drift may require bridge compatibility updates.
- User/workspace overrides can still force direct base language IDs and bypass
  ownership guarantees.
- Edit remapping can produce unsafe transformations unless overlap guardrails
  remain strict.

## Implementation Notes

- Initial tranche (completed/in-flight):
  - `backlog/86_disable_auto_reassociation_and_lock_template_language_identity.md`
  - `backlog/87_align_manifest_docs_and_integration_tests_for_templated_any.md`
  - `backlog/88_validate_diagnostics_pipeline_and_prepare_patch_release.md`
- Amendment tranche (shadow bridge + parity scope):
  - `backlog/89_implement_projection_snapshots_for_shadow_bridge.md`
  - `backlog/90_implement_shadow_document_lifecycle_and_diagnostic_ownership.md`
  - `backlog/91_proxy_base_language_lsp_features_with_edit_safety.md`
  - `backlog/92_add_templated_format_language_ids_and_generated_grammars.md`
  - `backlog/93_harden_transport_timeouts_and_watched_files_noise.md`
  - `backlog/94_define_parity_matrix_and_pr_scope_for_shadow_bridge_rollout.md`
- This ADR complements `ADR 005` by preserving cleaned diagnostics strategy
  precedence while redefining language identity and LSP feature delivery.

## References

- `temple/docs/adr/005-base-lint-strategy-and-diagnostics-pipeline.md`
- `backlog/94_define_parity_matrix_and_pr_scope_for_shadow_bridge_rollout.md`
- `vscode-temple-linter/src/extension.ts`
- `vscode-temple-linter/package.json`
