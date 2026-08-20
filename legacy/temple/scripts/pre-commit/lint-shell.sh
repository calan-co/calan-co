#!/usr/bin/env bash
set -euo pipefail

# Lint all shell scripts in repository using `bash -n`.
# If available, also run `shellcheck` and show its results.
# Excludes files in .git and known binary paths.

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR" || exit

echo "Running bash -n on repository shell scripts..."

failed=0

# Temporary files for capturing diagnostics (cleaned up on exit)
BASH_ERR=$(mktemp)
SC_ERR=$(mktemp)
trap 'rm -f "$BASH_ERR" "$SC_ERR"' EXIT

# Detect shellcheck
if command -v shellcheck >/dev/null 2>&1; then
  SHELLCHECK_AVAILABLE=1
  echo "shellcheck found; shellcheck will be run on each script."
else
  SHELLCHECK_AVAILABLE=0
  echo "shellcheck not found; skipping shellcheck."
fi

while IFS= read -r -d $'\0' file; do
  # Skip files that are not regular files
  if [ ! -f "$file" ]; then
    continue
  fi

  printf "Checking %s... " "$file"

  # bash -n (syntax check)
  if bash -n "$file" >"$BASH_ERR" 2>&1; then
    printf "bash -n ok"
  else
    printf "bash -n ERROR\n"
    cat "$BASH_ERR"
    failed=1
    # continue to run shellcheck (if available) to show its findings as well
  fi

  # Use shellcheck (if available) - show results and mark failure on non-zero exit
  if [ "$SHELLCHECK_AVAILABLE" -eq 1 ]; then
    # Only fail on error-level issues (exclude warnings/style)
    if shellcheck -x -S error "$file" >"$SC_ERR" 2>&1; then
      printf " + shellcheck ok\n"
    else
      printf " + SHELLCHECK ERROR\n"
      cat "$SC_ERR"
      failed=1
    fi
  else
    printf "\n"
  fi

done < <(find . \
  -path './.git' -prune -o \
  -path './node_modules' -prune -o \
  -path './vscode-temple-linter/node_modules' -prune -o \
  -path './.cache' -prune -o \
  -path './temple/.venv' -prune -o \
  -path './temple-linter/.venv' -prune -o \
  -path './.ci-venv' -prune -o \
  -path './env' -prune -o \
  -type f -name '*.sh' -print0)

if [ "$failed" -ne 0 ]; then
  echo "One or more shell scripts failed checks."
  exit 2
fi

echo "All shell scripts passed checks."
exit 0