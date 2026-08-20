#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/scripts/ci/venv_utils.sh" ]; then
  . "$ROOT_DIR/scripts/ci/venv_utils.sh"
fi

if ! ensure_ci_venv_ready; then
  print_ci_venv_instructions || true
  exit 1
fi

RUFF="$(command -v ruff || true)"
if [ -z "$RUFF" ]; then
  echo "ruff not found on PATH; ensure .ci-venv is active or run ./scripts/setup-hooks.sh" >&2
  exit 1
fi

echo "Running python linter (ruff)..."
"$RUFF" check "$@"
exit 0
