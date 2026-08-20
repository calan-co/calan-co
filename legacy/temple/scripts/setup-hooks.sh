#!/usr/bin/env bash
set -euo pipefail

# setup-hooks.sh
# Unified helper for local hook setup and optional global installation.
# Supports: --global, --force, --no-deps

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

usage() {
  cat <<EOF
Usage: $0 [--global] [--force]

Install and configure repository hooks.

Options:
  --global   Install hooks into your global git template directory so new clones receive them automatically.
  --force    Overwrite existing global template hooks when using --global.
  -h, --help Show this help message
EOF
}

GLOBAL=0
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) GLOBAL=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 2 ;;
  esac
done

if [[ $GLOBAL -eq 1 ]]; then
  TARGET_DIR="$HOME/.git-templates/hooks"
  echo "Installing hooks to global git template: $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  if [[ -d .githooks && -n "$(ls -A .githooks)" ]]; then
    if [[ $FORCE -eq 1 ]]; then
      rm -rf "$TARGET_DIR"/*
    fi
    # Prefer using pre-commit for global installs so hooks are managed consistently.
    if command -v pre-commit >/dev/null 2>&1; then
      echo "Using pre-commit to initialize global template and install hooks"
      pre-commit init-templatedir "$HOME/.git-templates" || true
      # Copy repo config into the template so pre-commit knows which hooks to install
      if [[ -f .pre-commit-config.yaml ]]; then
        cp .pre-commit-config.yaml "$TARGET_DIR/.pre-commit-config.yaml" || true
      fi
      pre-commit install --install-hooks --template-dir "$HOME/.git-templates" || true
      git config --global init.templateDir "$HOME/.git-templates"
      echo "Global pre-commit hooks installed into $TARGET_DIR. New clones will receive hooks."
      echo "(Existing repositories must run 'git init' or re-clone to pick up the template.)"
    else
      # Fallback: copy raw hook scripts if pre-commit isn't available
      cp -R .githooks/* "$TARGET_DIR/"
      chmod +x "$TARGET_DIR"/* || true
      git config --global init.templateDir "$HOME/.git-templates"
      echo "Global git hooks installed (raw scripts) into $TARGET_DIR."
      echo "Consider installing 'pre-commit' (brew install pre-commit) for managed hooks."
    fi
  else
    echo "No hooks found in .githooks/ to install." >&2
    exit 1
  fi
  exit 0
fi

# Ensure local hooks venv path
HOOKS_VENV="$REPO_ROOT/.ci-venv"

# Create and populate the hooks venv (idempotent)
if [ ! -d "$HOOKS_VENV" ] || [ ! -x "$HOOKS_VENV/bin/python" ]; then
  echo "Creating and populating hooks venv at: $HOOKS_VENV"
  CI_VENV_PATH="$HOOKS_VENV" ./scripts/ci/ensure_ci_venv.sh || true
fi

# Use a repo-local pre-commit cache so hook virtualenvs don't depend on
# global ~/.cache/pre-commit state (avoids plugin/version mismatches).
export PRE_COMMIT_HOME="$REPO_ROOT/.cache/pre-commit"
mkdir -p "$PRE_COMMIT_HOME"

echo "Upgrading pip and installing tools into .ci-venv"
"$HOOKS_VENV/bin/python" -m pip install --upgrade pip || true

# Install consolidated CI requirements first so we control tool versions
# and avoid later conflicts when installing the editable package.
if [ -f "./scripts/ci/requirements.txt" ]; then
  echo "Installing CI requirements from scripts/ci/requirements.txt"
  "$HOOKS_VENV/bin/pip" install -r ./scripts/ci/requirements.txt || true
else
  echo "Installing minimal tooling into .ci-venv"
  "$HOOKS_VENV/bin/pip" install pre-commit ruff yamllint detect-secrets || true
fi

# Ensure pre-commit is available in the venv (CI requirements may not include it)
"$HOOKS_VENV/bin/pip" install --upgrade pre-commit || true

# Install the repository package in editable mode but avoid auto-installing
# its declared dependencies to prevent resolver conflicts with the CI pins.
"$HOOKS_VENV/bin/pip" install -e . || true

echo "Installing pre-commit hooks using the venv's pre-commit binary"
"$HOOKS_VENV/bin/pre-commit" install --install-hooks || true

# Quick detect-secrets sanity check (gives actionable guidance for baseline/plugin mismatches)
if ! "$HOOKS_VENV/bin/pre-commit" run detect-secrets --all-files --show-diff-on-failure >/dev/null 2>&1; then
  echo "Warning: detect-secrets hook failed to initialize or matched an incompatible baseline."
  echo "  - Run: '$HOOKS_VENV/bin/pre-commit autoupdate' or 'pre-commit autoupdate' to refresh hook revisions."
  echo "  - Alternatively, pin the detect-secrets hook revision in .pre-commit-config.yaml to match .secrets.baseline."
fi

# Install CI dependencies used by shared scripts into the hooks venv as a
# best-effort fallback for environments that rely on the helper script.
echo "Installing CI dependencies into $HOOKS_VENV"
if [ -f "./scripts/ci/ensure_ci_venv.sh" ]; then
  chmod +x ./scripts/ci/ensure_ci_venv.sh || true
  CI_VENV_PATH="$HOOKS_VENV" ./scripts/ci/ensure_ci_venv.sh || true
  echo "CI dependencies installed into $HOOKS_VENV (best-effort)."
else
  echo "Warning: ./scripts/ci/ensure_ci_venv.sh not found; skipping CI dependency install" >&2
fi

# Ensure node-based linters/deps are available for pre-commit hooks that use `npx`
if [[ -f "vscode-temple-linter/package.json" ]]; then
  echo "Installing Node devDependencies for vscode-temple-linter (for remark/eslint hooks)"
  if command -v npm >/dev/null 2>&1; then
    npm --prefix vscode-temple-linter install || true
    # Ensure remark-cli + recommended preset are present so pre-commit npx runs are fast
    npm --prefix vscode-temple-linter install --no-save --no-audit remark-cli remark-preset-lint-recommended || true
  else
    echo "npm not found; skipping Node linter install. Pre-commit will use npx at runtime." >&2
  fi
fi

cat <<'EOF'
Setup complete.
- To activate the venv: `source .ci-venv/bin/activate`
- To run hooks manually: `.ci-venv/bin/pre-commit run --all-files`
EOF

exit 0
