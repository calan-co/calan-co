#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "Running VS Code extension package validation..."
npm --prefix vscode-temple-linter run compile
npm --prefix vscode-temple-linter run lint -- --max-warnings=0
npm --prefix vscode-temple-linter run package:check

exit 0
