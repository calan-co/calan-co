#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "Running ESLint (vscode-temple-linter)..."
npm --prefix vscode-temple-linter run lint -- --max-warnings=0

exit 0
