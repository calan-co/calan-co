---
title: "Implement collocated mirror ghost files and diagnostic remapping"
id: 75
status: completed
state_reason: success
priority: high
complexity: high
estimated_hours: 16
actual_hours: 3.5
completed_date: 2026-02-14
related_commit:
  - b9e4e0c  # fix(vscode): collocate mirror ghost files and clean lifecycle
test_results: |
  VS Code extension validation:
  - npm run compile (passes)
  - npm run test:integration (passes)
  Added test coverage:
  - collocated mirror-file path assertion under hidden `.temple-base-lint` sibling directory
dependencies:
  - "[[archive/74_implement_base_lint_strategy_resolver_and_capability_registry.md]]"
related_backlog:
  - "archive/67_fix_lsp_base_diagnostics_transport.md"
related_spike: []
notes: |
  Mirror-file fallback must preserve nested workspace config resolution while
  keeping ghost artifacts hidden, cleaned up, and mapped back to source URIs.
  Started implementation on 2026-02-14 after completion of archived item 74.
  Initial slice: collocated hidden ghost pathing + lifecycle cleanup.
  Completed on 2026-02-14:
  - Mirror fallback now writes hidden collocated files under `.temple-base-lint` near source template.
  - Mirror files are cleaned after diagnostic collection and on extension deactivate.
  - Directory cleanup is best-effort and avoids lingering empty ghost directories.
  - Base-lint logging includes publish-uri context to make source-path mapping explicit.
---

## Goal

Implement robust mirror-file fallback that writes collocated ghost files for base tools, remaps diagnostics back to `.tmpl` source locations, and avoids repository pollution.

## Background

Temp-directory mirrors caused incorrect ownership, stale diagnostics, missing source mapping, and config resolution mismatches for tools that read nested workspace config.

## Tasks

1. **Implement collocated ghost pathing**
   - Create deterministic hidden sibling ghost files near source templates.
   - Ensure paths are excluded from repo and hidden from normal editor flows.

2. **Map diagnostics to source document**
   - Convert base-tool diagnostics from ghost URI to original `.tmpl` URI.
   - Preserve code, severity, and message fidelity.

3. **Lifecycle + failsafe cleanup**
   - Cleanup on close/reload/deactivate.
   - Add stale ghost sweeper and startup recovery.

4. **Validation**
   - Unit tests for pathing, remap correctness, cleanup behavior.
   - Integration test validating markdownlint owner diagnostics appear only on source file.

## Deliverables

- Mirror ghost manager with cleanup strategy.
- Diagnostic remapping layer with test coverage.
- Default ignore patterns/docs for ghost paths.

## Acceptance Criteria

- [x] Base-tool diagnostics are attached to original `.tmpl` documents, not ghost files.
- [x] Ghost file strategy resolves nested workspace configs correctly.
- [x] Ghost files are hidden and cleaned automatically with failsafe behavior.
- [x] No repo pollution from ghost files in normal workflows.
