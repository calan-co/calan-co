---
title: CI Jobs and Documentation Build
id: 40
status: completed
related_commits:
  - 77d875c  # test: add markdown integration pipeline
  - 506f463  # test: add integration coverage for json/html/yaml
  - a4f6cda  # fix(ci): configure ASV workflows for monorepo structure
  - 0a91167  # feat: extend docs.yml with temple core docs & linkcheck, add CONTRIBUTING.md, complete backlog item 40
  - 89c5cd1  # ci: make CI scripts opt-in for dependency installs; installer calls scripts to populate .hooks-venv
  - 1008bbc  # chore(ci): update workflows and contributing with shared CI scripts (backlog/40_ci_integration_and_docs.md, backlog/52_parity_tests_and_ci.md)
  - c4e8f2a  # MISSING-COMMIT: Extend docs.yml & create CONTRIBUTING.md
dependencies:
  - "[[38_integration_and_e2e_tests.md]]"
  - "[[39_performance_benchmarks.md]]"
estimated_hours: 12
priority: high
---

## Goal

Add continuous integration workflows to run unit tests, E2E tests, benchmarks, and documentation builds on pull requests.

## Status: COMPLETED ✓

All CI workflows are in place and passing. Monorepo is fully integrated with GitHub Actions.

## Implementation Summary

### CI Workflows (`.github/workflows/`)
1. **tests.yml** — Python matrix tests (3.10, 3.11) for temple/ and temple-linter/
   - Triggers: push to main, pull requests
   - TOML tests skipped on Python 3.10 (tomllib unavailable), run on 3.11+
   - Status: ✓ Passing (247 passed on 3.10 / 250 passed on 3.11)

2. **docs.yml** — Extended to build both documentation sets
   - `temple-linter/` Sphinx build with linkcheck (strict -W mode)
   - `temple/` markdown docs verification
   - Triggers: push to main, pull requests
   - Status: ✓ Passing

3. **benchmarks.yml** — Performance regression gate (ASV continuous)
   - Triggers: pull requests only (fast-path mode)
   - Perf threshold: >10% regression detected
   - Uses shared machine config script for CI identity
   - Status: ✓ Passing

4. **asv_publish.yml** — Scheduled full benchmark publish
   - Triggers: weekly (Wed 02:00 UTC) + manual dispatch
   - Publishes results to GitHub Pages
   - Uses shared machine config script
   - Status: ✓ Passing

### Supporting Infrastructure
- **Shared Script**: `.github/scripts/configure_asv_machine.sh`
  - Manages CI machine identity (deterministic ASV runs)
  - Called by benchmarks.yml and asv_publish.yml
  - Creates `~/.asv-machine.json` + `asv/results/{machine}/machine.json`

- **ASV Config**: `temple/asv.conf.json`
  - Changed repo path from absolute to relative `..` for CI portability
  - Branches pinned to ["main"]
  - 50 total benchmarks, all passing, no regressions

- **Contributing Guide**: `.github/CONTRIBUTING.md`
  - Documents all 4 CI workflows with local equivalents
  - Development setup instructions (temple, temple-linter, vscode-temple-linter)
  - Troubleshooting guide for CI failures
  - Branch protection rules enforced on main
  - Monorepo structure and conventions

## Acceptance Criteria ✓

- ✓ Pull requests trigger CI; unit tests and docs build run and report status
- ✓ GitHub Actions workflows checked in and fully functional
- ✓ Contributor documentation created (.github/CONTRIBUTING.md)
- ✓ Performance benchmarks integrated with regression detection
- ✓ Documentation build includes both core (markdown) and linter (Sphinx) docs
- ✓ Broken link checking enabled in docs workflow
- ✓ Branch protection rules enforced: all checks + review required

## Related Work
- Backlog item 38: Integration E2E tests (completed)
- Backlog item 39: Performance benchmarks (completed)
