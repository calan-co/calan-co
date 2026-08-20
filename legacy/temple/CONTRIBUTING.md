# Contributing to Temple

This repo contains three projects:
- `temple/` (core language + renderer)
- `temple-linter/` (Python LSP server)
- `vscode-temple-linter/` (VS Code extension)

## Prerequisites
- Python `>=3.10` (Python `3.11` recommended to match CI)
- Node.js `>=18`
- Git + VS Code (for extension workflows)

## Initial Setup
1. Clone and enter the repository.
   ```bash
   git clone https://github.com/yourusername/temple.git
   cd temple
   ```
2. Bootstrap local hooks/tooling (recommended).
   ```bash
   ./scripts/setup-hooks.sh
   ```
3. Install editable Python packages in the local hooks venv.
   ```bash
   ./.ci-venv/bin/pip install -e ./temple[dev,ci]
   ./.ci-venv/bin/pip install -e ./temple-linter[dev,ci]
   ```
4. Install VS Code extension dependencies.
   ```bash
   cd vscode-temple-linter
   npm install
   npm run compile
   cd ..
   ```

## CI Parity Commands

Use these commands before opening a PR:

```bash
# Ensure shared tooling is selected by scripts
export CI_VENV_PATH="$PWD/.ci-venv"

# repo-level checks
./scripts/pre-commit/lint-python.sh scripts/ci tests temple/src temple-linter/src
./scripts/pre-commit/lint-yaml.sh .github/workflows .github/actions .pre-commit-config.yaml .yamllint
./scripts/pre-commit/lint-shell.sh
./scripts/pre-commit/lint-js.sh
./scripts/pre-commit/build-docs.sh
./scripts/pre-commit/lint-docs.sh
./scripts/pre-commit/validate-benchmarks.sh
python -m pytest tests -q

# project tests
cd temple && ../.ci-venv/bin/pytest tests -q && cd ..
cd temple-linter && ../.ci-venv/bin/pytest tests -q && cd ..
cd vscode-temple-linter && npm run compile && npm run lint && cd ..
```

## VS Code Workflow

The repo includes workspace config under `.vscode/` for:
- core/linter test loops
- extension compile/lint loops
- LSP/extension debugging entry points

Open the repo root in VS Code and run the provided tasks/launch configs.

## Pull Request Checklist
- [ ] CI parity commands run locally
- [ ] Behavior changes include tests
- [ ] Docs updated when commands/workflows change
- [ ] Commit messages are clear and scoped

## Notes
- Prefer repository scripts under `scripts/pre-commit/` and `scripts/ci/` over ad hoc commands.
- Avoid introducing `uv pip run`; use script wrappers or explicit interpreter/module calls.
