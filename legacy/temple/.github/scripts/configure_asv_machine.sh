#!/usr/bin/env bash
# Configure deterministic CI machine identity for ASV benchmarks
# Usage: configure_asv_machine.sh [ci_machine_json] [asv_machine_json_out] [asv_results_dir]
set -euo pipefail

HOSTNAME=$(hostname)
SRC="${1:-asv/machines/ci_machine.json}"
ASV_MACHINE_JSON="${2:-$HOME/.asv-machine.json}"
ASV_RESULTS_DIR="${3:-asv/results}"

if [ -f "$SRC" ]; then
  echo -n '{' > "$ASV_MACHINE_JSON"
  printf '%s' "\"$HOSTNAME\"" >> "$ASV_MACHINE_JSON"
  echo -n ':' >> "$ASV_MACHINE_JSON"
  cat "$SRC" >> "$ASV_MACHINE_JSON"
  echo -n ",\"version\": 1}" >> "$ASV_MACHINE_JSON"

  MNAME=$(grep -m1 '"machine"' "$SRC" | sed -E "s/.*:[[:space:]]*\"([^\"]+)\".*/\1/")
  if [ -z "$MNAME" ]; then
    MNAME="$HOSTNAME"
  fi

  mkdir -p "$ASV_RESULTS_DIR/$MNAME"
  cp "$SRC" "$ASV_RESULTS_DIR/$MNAME/machine.json"
  echo "✓ Configured ASV machine identity: $MNAME (hostname: $HOSTNAME)"
else
  echo "⚠ Warning: Machine config file not found: $SRC"
  exit 1
fi
