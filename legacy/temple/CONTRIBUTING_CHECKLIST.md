# CONTRIBUTING / Checklist

This file lists exact commands maintainers can run locally and in CI to reproduce tests, linters, and common workflows.

Platform: macOS / Linux (bash / zsh)

---

## 1) Prepare a Python virtual environment

```bash
# from repo root
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
```

## 2) Install project packages and developer dependencies

Preferred (temple + temple-linter):

```bash
# Install temple package (editable)
cd temple
pip install -e .
# Install temple-linter dependencies
cd ../temple-linter
pip install -r requirements.txt
# Return to repo root
cd ..
```

If your environment uses extras for dev dependencies (check `pyproject.toml` or `setup.py`):

```bash
# from temple/ if extras are declared
pip install -e .[dev]
```

## 3) Run tests locally

Run the whole test suite (may be slow):

```bash
# from repo root
pytest -q
```

Run a component's tests:

```bash
# temple tests
cd temple
pytest tests/ -q
# temple-linter tests
cd ../temple-linter
pytest tests/ -q
```

Run a single test file or test function for quicker feedback:

```bash
pytest tests/test_lark_parser_advanced.py::test_elif_parsing -q
```

## 4) Common quick checks

Run formatting and linters (if configured):

```bash
# example: isort, black, flake8 (install them first)
black .
isort .
flake8 .
```

Type checks (if using pyright / mypy):

```bash
# mypy
mypy .
# pyright
pyright
```

## 5) Reproducing CI locally

If you use `act` to run GitHub Actions locally, install `act` and run the workflow file:

```bash
# install act (macOS via brew)
brew install act
# run default workflow (adjust -W to the workflow file if needed)
act -j test
```

Alternatively, run the same commands that CI uses in a clean environment (recommended):

```bash
# create a fresh venv and install only what's needed
python3 -m venv .ci-venv
source .ci-venv/bin/activate
pip install -r temple/requirements-dev.txt || true
pip install -e temple
pytest -q
```

## 6) Debugging failing tests

- Re-run failing tests with `-q -k <pattern>` to narrow down.
- Use `pytest -x` to stop on first failure.
- Capture tracebacks and failing input fixtures (attach to PR or issue).

## 7) Common environment variables used in workflows

- `TEMPLE_LINTER_FORCE_TEMP=1` — force temp-file fallback in VS Code extension helpers

## 8) Useful commands for maintainers

```bash
# Run a single pytest and show verbose output
pytest tests/test_lark_parser_advanced.py -q -vv
# Run linting for a single file
python -m pyflakes temple/temple/src/temple/lark_parser.py
```

---

If anything here is out of date for this repo, please open a PR updating this file with the exact commands your CI uses (include workflow file reference).

## Install Git hooks (recommended)

Use the repository's helper to create a local hooks venv and install `pre-commit` hooks:

```bash
./scripts/setup-hooks.sh
source .ci-venv/bin/activate  # optional
.ci-venv/bin/pre-commit run --all-files
```

This keeps hook tooling isolated in `.ci-venv`, matching the new contributor workflow.
