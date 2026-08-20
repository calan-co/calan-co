#!/usr/bin/env bash
set -euo pipefail

# Ensure a CI virtualenv exists at CI_VENV_PATH (or default .cache/ci-venv)
# Usage: CI_VENV_PATH=/path/to/venv ./scripts/ci/ensure_ci_venv.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../" && pwd)"
VENV_DIR="${CI_VENV_PATH:-$ROOT_DIR/.cache/ci-venv}"

MIN_MAJOR=3
MIN_MINOR=10

echo "Ensuring CI venv at: $VENV_DIR"

# Helper: check that a python executable meets the minimum version
_python_ok() {
  local py_exec="$1"
  if ! command -v "$py_exec" >/dev/null 2>&1; then
    return 1
  fi
  # Query major and minor version
  local ver
  ver=$("$py_exec" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null) || return 2
  local major=${ver%%.*}
  local minor=${ver##*.}
  if [ "$major" -gt "$MIN_MAJOR" ] || { [ "$major" -eq "$MIN_MAJOR" ] && [ "$minor" -ge "$MIN_MINOR" ]; }; then
    return 0
  fi
  return 2
}

# Choose python interpreter: prefer CI_PYTHON, then common names
PY=""
if [ -n "${CI_PYTHON:-}" ]; then
  if _python_ok "$CI_PYTHON"; then
    PY="$CI_PYTHON"
  else
    echo "CI_PYTHON is set but does not meet minimum Python ${MIN_MAJOR}.${MIN_MINOR}: $CI_PYTHON" >&2
    exit 3
  fi
fi
for cand in python3.11 python3.10 python3 python; do
  if [ -n "$PY" ]; then break; fi
  if _python_ok "$cand"; then
    PY="$cand"
    break
  fi
done

if [ -z "${PY:-}" ]; then
  echo "No Python ${MIN_MAJOR}.${MIN_MINOR}+ interpreter found on PATH. Set CI_PYTHON to a compatible interpreter." >&2
  exit 4
fi

echo "Using python: $PY"

# If venv exists, verify its python is compatible; if not, recreate
if [ -d "$VENV_DIR" ] && [ -x "$VENV_DIR/bin/python" ]; then
  if _python_ok "$VENV_DIR/bin/python"; then
    echo "Existing venv at $VENV_DIR is compatible; reusing."
  else
    echo "Existing venv at $VENV_DIR uses incompatible Python; recreating."
    rm -rf "$VENV_DIR"
    "$PY" -m venv "$VENV_DIR"
  fi
else
  # Create venv with chosen interpreter
  "$PY" -m venv "$VENV_DIR"
fi

# Activate and install requirements (cached wheels will speed this up)
# shellcheck disable=SC1090
. "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$ROOT_DIR/scripts/ci/requirements.txt"

echo "CI venv ready: $VENV_DIR (python $($VENV_DIR/bin/python -V 2>&1))"
