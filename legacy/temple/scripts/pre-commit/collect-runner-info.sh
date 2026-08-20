#!/usr/bin/env bash
set -euo pipefail
# Collect runner info for CI traceability
# Usage: collect-runner-info.sh [output_file]
OUTFILE="${1:-runner_info.txt}"
hostname > "$OUTFILE"
uname -a >> "$OUTFILE"
lscpu >> "$OUTFILE"
free -h >> "$OUTFILE"