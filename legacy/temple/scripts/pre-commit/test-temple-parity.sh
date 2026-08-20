#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to run parity checks." >&2
  exit 1
fi

uv run \
  --with pytest \
  --with pytest-benchmark \
  --with jinja2 \
  --with-editable ./temple \
  python -m pytest temple/tests/parity/test_native_vs_jinja2_parity.py -q
