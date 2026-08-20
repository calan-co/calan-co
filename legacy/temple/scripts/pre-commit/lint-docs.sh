#!/usr/bin/env bash
set -euo pipefail

# Check for broken links in Sphinx docs with the shared CI venv.
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/scripts/ci/venv_utils.sh" ]; then
  . "$ROOT_DIR/scripts/ci/venv_utils.sh"
fi

if ! ensure_ci_venv_ready; then
  print_ci_venv_instructions || true
  exit 1
fi

SPHINX="$(command -v sphinx-build || true)"
if [ -z "$SPHINX" ]; then
  echo "sphinx-build not found on PATH; ensure .ci-venv is active or run ./scripts/setup-hooks.sh" >&2
  exit 1
fi

echo "Running Sphinx linkcheck for temple-linter docs"
"$SPHINX" -b linkcheck -W --keep-going temple-linter/docs temple-linter/docs/_build/linkcheck
