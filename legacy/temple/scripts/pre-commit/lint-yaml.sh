#!/usr/bin/env bash
set -euo pipefail

# Run yamllint across repository YAML files.
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/scripts/ci/venv_utils.sh" ]; then
  . "$ROOT_DIR/scripts/ci/venv_utils.sh"
fi

if ! ensure_ci_venv_ready; then
  print_ci_venv_instructions || true
  exit 1
fi

YAMLLINT="$(command -v yamllint || true)"
if [ -z "$YAMLLINT" ]; then
  echo "yamllint not found on PATH; ensure .ci-venv is active or run ./scripts/setup-hooks.sh" >&2
  exit 1
fi

echo "Running yamllint..."

targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
  while IFS= read -r file; do
    targets+=("$file")
  done < <(git ls-files '*.yml' '*.yaml')
fi

if [ "${#targets[@]}" -eq 0 ]; then
  echo "No YAML files found to lint."
  exit 0
fi

workflow_targets=()
default_targets=()

for target in "${targets[@]}"; do
  case "$target" in
    .github/workflows|.github/workflows/*)
      workflow_targets+=("$target")
      ;;
    *)
      default_targets+=("$target")
      ;;
  esac
done

if [ "${#workflow_targets[@]}" -gt 0 ]; then
  "$YAMLLINT" -c .github/workflows/.yamllint "${workflow_targets[@]}"
fi

if [ "${#default_targets[@]}" -gt 0 ]; then
  "$YAMLLINT" -c .yamllint "${default_targets[@]}"
fi
