#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "Checking generated Temple defaults..."
node vscode-temple-linter/scripts/generate-defaults.js --check

exit 0
