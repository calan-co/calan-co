#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

# Ensure CI venv is available if helper exists
if [ -f "$ROOT_DIR/scripts/ci/venv_utils.sh" ]; then
  . "$ROOT_DIR/scripts/ci/venv_utils.sh"
fi

if ! ensure_ci_venv_ready; then
  print_ci_venv_instructions || true
  exit 1
fi

PYTEST="$(command -v pytest || true)"
if [ -z "$PYTEST" ]; then
  echo "pytest not found on PATH; ensure .ci-venv is active or run ./scripts/setup-hooks.sh" >&2
  exit 1
fi

echo "Running quick benchmark validation tests"
$PYTEST -q \
  temple/tests/test_benchmarks.py::test_bench_real_small \
  temple/tests/test_benchmarks.py::test_bench_real_medium \
  temple/tests/test_benchmarks.py::test_bench_real_large \
  --maxfail=1 --disable-warnings

exit 0
