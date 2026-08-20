#!/usr/bin/env bash
set -euo pipefail

# Wrapper for pre-commit: run detect-secrets scan then the repository compare
# Usage: scripts/pre-commit/run-detect-secrets.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Resolve detect-secrets command (assume tools available on PATH)
DETECT_SECRETS_CMD="$(command -v detect-secrets || true)"

# Determine repository-relevant plugins to disable (conservative defaults).
# If certain package files are absent, disable detectors unlikely to apply.
disable_plugins=(
  OpenAIDetector
  MailchimpDetector
  SendGridDetector
  StripeDetector
  SquareOAuthDetector
  TwilioKeyDetector
  TelegramBotTokenDetector
  DiscordBotTokenDetector
  SoftlayerDetector
  ArtifactoryDetector
  CloudantDetector
  IbmCloudIamDetector
  IbmCosHmacDetector
)

if ! find . -name 'package.json' -print -quit >/dev/null 2>&1; then
  disable_plugins+=(NpmDetector)
fi

if ! (find . -name 'pyproject.toml' -print -quit >/dev/null 2>&1 || find . -name 'requirements.txt' -print -quit >/dev/null 2>&1 || find . -name 'setup.py' -print -quit >/dev/null 2>&1); then
  disable_plugins+=(PypiTokenDetector)
fi

DISABLE_FLAGS=""
for p in "${disable_plugins[@]}"; do
  DISABLE_FLAGS+=" --disable-plugin $p"
done



# Collect staged files (null-delimited) into an array to handle spaces
staged_array=()
git diff --cached --name-only -z --diff-filter=ACM | \
  while IFS= read -r -d '' file; do
    staged_array+=("$file")
  done

# Note: above population happens in a subshell on some platforms; to support
# that case, also fall back to a whitespace-safe plain list if array remains empty.
if [ "${#staged_array[@]}" -gt 0 ]; then
  echo "Staged files detected: ${#staged_array[@]}"
  SCAN_ARGS=--
else
  # Try a simple, space-joined fallback (best-effort)
  staged_files_fallback=$(git diff --cached --name-only --diff-filter=ACM | sed '/^$/d')
  if [ -n "$staged_files_fallback" ]; then
    # split into array
    IFS=$'\n' read -r -d '' -a staged_array <<<"$staged_files_fallback" || true
    echo "Staged files detected (fallback): ${#staged_array[@]}"
    SCAN_ARGS=--
  else
    # Do NOT perform a full repository scan from a pre-commit hook by default.
    # Full scans are expensive and must only be run from scheduled CI jobs.
    # Allow a scheduled job to explicitly opt-in by setting
    # DETECT_SECRETS_ALLOW_FULL_REPO_SCAN=1 in its environment.
    if [ "${DETECT_SECRETS_ALLOW_FULL_REPO_SCAN:-}" = "1" ]; then
      echo "No staged files detected; DETECT_SECRETS_ALLOW_FULL_REPO_SCAN=1 -> running full scan"
      SCAN_ARGS="--all-files"
    else
      echo "No staged files detected; skipping detect-secrets scan (full repo scans only run in scheduled jobs)." >&2
      echo "Set DETECT_SECRETS_ALLOW_FULL_REPO_SCAN=1 in CI to allow a scheduled full scan." >&2
      exit 0
    fi
  fi
fi

# Path to baseline if present
BASELINE="$ROOT/.secrets.baseline"

# Determine python for compare fallback (use python on PATH)
PYTHON="$(command -v python3 || command -v python)"

if [ -n "${DETECT_SECRETS_CMD}" ]; then
  echo "Using detect-secrets command: $DETECT_SECRETS_CMD"

  # Prefer detect-secrets-hook for staged-file checks when a baseline exists
  if [ -f "$BASELINE" ] && [ "${#staged_array[@]}" -gt 0 ]; then
    # Prefer venv hook binary if available
    if [ -x "${CI_VENV_PATH%/}/bin/detect-secrets-hook" ]; then
      HOOK_CMD="${CI_VENV_PATH%/}/bin/detect-secrets-hook"
    elif [ -x "$ROOT/.ci-venv/bin/detect-secrets-hook" ]; then
      HOOK_CMD="$ROOT/.ci-venv/bin/detect-secrets-hook"
    elif command -v detect-secrets-hook >/dev/null 2>&1; then
      HOOK_CMD="$(command -v detect-secrets-hook)"
    else
      HOOK_CMD=""
    fi

    if [ -n "$HOOK_CMD" ]; then
      echo "Using detect-secrets-hook for staged files: $HOOK_CMD"
      # Run hook with baseline against staged files; pass filenames directly
      "$HOOK_CMD" --baseline "$BASELINE" "${staged_array[@]}" || true
      # Exit code handling: hook prints problems to stdout/stderr; let pre-commit fail via exit codes below
      # Treat hook as authoritative for staged checks
      exit_code=$?
      if [ "$exit_code" -ne 0 ]; then
        echo "detect-secrets-hook reported issues" >&2
        exit $exit_code
      fi
      exit 0
    fi
  fi

  # Fallback to full or per-path scan + compare
  if [ "${#staged_array[@]}" -gt 0 ]; then
    # join array into arguments safely
    if [ "${SCAN_ARGS:-}" = "--all-files" ]; then
      # Build a file list of tracked + untracked (but not git-ignored) files
      tmpf=$(mktemp)
      { git ls-files -z || true; git ls-files -z --others --exclude-standard || true; } > "$tmpf"
      if [ -s "$tmpf" ]; then
        # Feed null-delimited list to xargs -0 so detect-secrets only scans files git cares about
        cat "$tmpf" | xargs -0 $DETECT_SECRETS_CMD scan $DISABLE_FLAGS > detect_secrets_curr.json 2>/dev/null || true
      else
        # Nothing to scan
        echo '{"results":{}}' > detect_secrets_curr.json
      fi
      rm -f "$tmpf" || true
      output=$($PYTHON scripts/ci/detect_secrets_compare.py --curr detect_secrets_curr.json --no-write || true)
      # Save a baseline snapshot for CI upload if present
      cp -f detect_secrets_curr.json current.baseline 2>/dev/null || true
    else
      output=$($DETECT_SECRETS_CMD scan $DISABLE_FLAGS $SCAN_ARGS "${staged_array[@]}" 2>/dev/null | $PYTHON scripts/ci/detect_secrets_compare.py --curr - --no-write || true)
    fi
  else
    if [ "${SCAN_ARGS:-}" = "--all-files" ]; then
      tmpf=$(mktemp)
      { git ls-files -z || true; git ls-files -z --others --exclude-standard || true; } > "$tmpf"
      if [ -s "$tmpf" ]; then
        cat "$tmpf" | xargs -0 $DETECT_SECRETS_CMD scan $DISABLE_FLAGS > detect_secrets_curr.json 2>/dev/null || true
      else
        echo '{"results":{}}' > detect_secrets_curr.json
      fi
      rm -f "$tmpf" || true
      output=$($PYTHON scripts/ci/detect_secrets_compare.py --curr detect_secrets_curr.json --no-write || true)
      cp -f detect_secrets_curr.json current.baseline 2>/dev/null || true
    else
      output=$($DETECT_SECRETS_CMD scan $DISABLE_FLAGS $SCAN_ARGS 2>/dev/null | $PYTHON scripts/ci/detect_secrets_compare.py --curr - --no-write || true)
    fi
  fi
else
  echo "Falling back to python -m detect_secrets: $PYTHON"
  if [ "${#staged_array[@]}" -gt 0 ] && [ -f "$BASELINE" ]; then
    # Try python module hook if binary missing
    if python -c 'import detect_secrets.pre_commit_hook' >/dev/null 2>&1; then
      echo "Using python-pre_commit_hook for staged files"
      # call the pre-commit hook module with baseline and staged files
      python -m detect_secrets.pre_commit_hook --baseline "$BASELINE" "${staged_array[@]}" || true
      exit_code=$?
      if [ "$exit_code" -ne 0 ]; then
        echo "detect-secrets pre_commit_hook reported issues" >&2
        exit $exit_code
      fi
      exit 0
    fi
    output=$($PYTHON -m detect_secrets scan $DISABLE_FLAGS $SCAN_ARGS "${staged_array[@]}" 2>/dev/null | $PYTHON scripts/ci/detect_secrets_compare.py --curr - --no-write || true)
  else
    output=$($PYTHON -m detect_secrets scan $DISABLE_FLAGS $SCAN_ARGS 2>/dev/null | $PYTHON scripts/ci/detect_secrets_compare.py --curr - --no-write || true)
  fi
fi

# Parse status from compare output (first non-empty line)
status=$(printf '%s' "$output" | sed -n '1p' | tr -d '\r')
if [ -z "$status" ]; then
  status=ok
fi

if [ "$status" = "new" ]; then
  echo "detect-secrets: new secrets found" >&2
  # Print detailed report (second line onwards) if present
  printf '%s\n' "$output" | sed -n '2,$p' >&2 || true
  exit 1
fi

exit 0
