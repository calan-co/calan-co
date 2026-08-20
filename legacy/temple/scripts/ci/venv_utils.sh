#!/usr/bin/env bash
set -euo pipefail

# Reusable CI venv readiness check.
# Usage: source scripts/ci/ci_venv_check.sh && ensure_ci_venv_ready

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ensure_ci_venv_ready() {
  # Prefer externally provided CI_VENV_PATH, then workspace cache, then local .ci-venv
  VENV_DIR="${CI_VENV_PATH:-$ROOT_DIR/.cache/ci-venv}"
  if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/activate" ] && [ -x "$VENV_DIR/bin/python" ]; then
    # Ensure the interpreter itself is runnable (handles stale/broken symlink venvs).
    if "$VENV_DIR/bin/python" -c "import sys" >/dev/null 2>&1; then
      . "$VENV_DIR/bin/activate"
      return 0
    fi
  fi

  # Try local development venv
  if [ -d "$ROOT_DIR/.ci-venv" ] && [ -f "$ROOT_DIR/.ci-venv/bin/activate" ] && [ -x "$ROOT_DIR/.ci-venv/bin/python" ]; then
    if ! "$ROOT_DIR/.ci-venv/bin/python" -c "import sys" >/dev/null 2>&1; then
      return 1
    fi
    # shellcheck disable=SC1090
    . "$ROOT_DIR/.ci-venv/bin/activate"
    return 0
  fi

  # Not ready
  return 1
}

print_ci_venv_instructions() {
  cat <<'MSG'
CI virtualenv not found or not ready.
Create it with:

  CI_VENV_PATH="<path>" ./scripts/ci/ensure_ci_venv.sh

Or run locally:

  ./scripts/ci/ensure_ci_venv.sh

This will create the shared CI venv and install required dependencies.
MSG
}

export -f ensure_ci_venv_ready print_ci_venv_instructions || true
