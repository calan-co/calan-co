#!/usr/bin/env bash
set -euo pipefail

# Create a detect-secrets baseline for the repo using the canonical wrapper.
# This delegates to scripts/pre-commit/secure-find-secrets.sh so the baseline
# is produced using the same plugin/filter/config behavior as CI and pre-commit.
# Usage: ./scripts/ci/create_secrets_baseline.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../" && pwd)"
cd "$ROOT_DIR"

# Ensure CI venv is available if helper exists
if [ -f "$ROOT_DIR/scripts/ci/venv_utils.sh" ]; then
  . "$ROOT_DIR/scripts/ci/venv_utils.sh"
fi

if ! ensure_ci_venv_ready; then
  print_ci_venv_instructions || true
  exit 1
fi

# Run the canonical wrapper in full-scan CI mode (it will write current.baseline)
DETECT_SECRETS_ALLOW_FULL_REPO_SCAN=1 CI_VENV_PATH="$ROOT_DIR/.cache/ci-venv" bash scripts/pre-commit/secure-find-secrets.sh

if [ -f current.baseline ]; then
  cp -f current.baseline .secrets.baseline
  echo "Wrote .secrets.baseline from current.baseline"
  echo "Review .secrets.baseline, then commit it: git add .secrets.baseline && git commit -m 'chore(secrets): add detect-secrets baseline'"
  exit 0
else
  echo "secure-find-secrets did not produce current.baseline; aborting" >&2
  exit 1
fi
