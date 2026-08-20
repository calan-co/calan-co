# Temple: Meta-Templating System

A declarative, type-safe transformation engine for structured data that validates and emits your target format.

Elevator pitch: Declarative, schema-checked transformations for JSON/YAML/HTML — catch errors at author time and emit any target format. See ADRs: [Market Role & Adapter Architecture](temple/docs/adr/003-market-role-and-adapter-architecture.md), [Base-Lint Strategy and Diagnostics Pipeline](temple/docs/adr/005-base-lint-strategy-and-diagnostics-pipeline.md).

A universal, format-agnostic meta-templating system for declaratively transforming structured data into text with real-time validation and developer tooling.

## What Temple IS

- A base-syntax aware templating engine
- A schema-aware templating system that offers intellisense, autocomplete and diagnostics (errors and warnings) based on specified data model
- Earlier static feedback from both template and host-language tools
- A best-effort static linting engine (template + source-mapped base lint)
  - Can be reinforced via optional scenario/rendered lint passes (run with sample contexts for dynamic rules)

## What Temple IS NOT

Temple cannot deterministically catch all data-dependent content rules at design time:

- duplicate heading text after loop expansion
- value-dependent rules only knowable after rendering real data

## 🏗️ Monorepo Structure

This repository contains three interconnected components:

### 1. **temple/** - Core Templating Engine (Specification Phase)

The heart of the Temple system: template DSL parser, query engine, rendering engine, and schema validation.

- **Language**: Python 3.10+
- **Status**: Architecture & specification phase
- **Key Features**:
  - Pluggable data format parsers (JSON, XML, YAML, TOML)
  - Unified query engine (dot notation, JMESPath)
  - Configurable delimiters for template DSL
  - Schema-aware query validation

📖 **Documentation**: [[ARCHITECTURE]]

### 2. **temple-linter/** - LSP Server & Template Linting (Active Development)

Language Server Protocol (LSP) implementation for template-aware linting and diagnostics.

- **Language**: Python 3.10+
- **Status**: Active development
- **Key Features**:
  - Template tokenization with configurable delimiters
  - Strips templates for base format validation
  - LSP integration for editor support
  - Position-accurate diagnostic mapping

📖 **Documentation**: [README](temple-linter/README.md)

### 3. **vscode-temple-linter/** - VS Code Extension (TypeScript)

Visual Studio Code extension providing real-time linting via LSP proxy to native VS Code linters.

- **Language**: TypeScript / Node.js
- **Status**: Functional prototype
- **Key Features**:
  - Virtual document provider for cleaned templates
  - LSP proxy to VS Code's native linters
  - Language support for `.tmpl`, `.template` files

📖 **Documentation**: [ARCHITECTURE](vscode-temple-linter/ARCHITECTURE.md)

## 🚀 Quick Start

- ### Prerequisites

- **Python 3.10+** (for `temple` and `temple-linter`)

> CI uses Python 3.11; using Python 3.11 locally is recommended to match CI runs.

- **Node.js 18+** (for `vscode-temple-linter`)
- **VS Code** (optional, for extension development)

### Setup Each Component

> Quick onboarding: after cloning the repository, run `./scripts/setup-hooks.sh` to create the local `.ci-venv` and install pre-commit hooks and tooling.

#### 1. temple (Core Engine)

```bash
./scripts/setup-hooks.sh
./.ci-venv/bin/pip install -e ./temple[dev,ci]
```

#### 2. temple-linter (LSP Server)

```bash
./.ci-venv/bin/pip install -e ./temple-linter[dev,ci]

# Run tests
cd temple-linter && ../.ci-venv/bin/pytest tests -q
```

#### 3. vscode-temple-linter (Extension)

```bash
cd vscode-temple-linter
npm install
npm run compile

# For development
npm run watch
```

## 🎯 Core Concepts

### Configurable Delimiters

Templates support custom delimiters to avoid conflicts with output formats:

```yaml
# Default: {% %}, {{ }}, {# #}
temple:
  statement_start: "<<"
  statement_end: ">>"
  expression_start: "<:"
  expression_end: ":>"
```

### Template Example

```markdown
# Resume
{% if user.name %}
## {{ user.name }}
{% end %}

{% for job in user.jobs %}
### {{ job.title }} at {{ job.company }}
{% end %}
```

### Optional: Install Git hooks (recommended)

We manage repository hooks with `pre-commit`. To set up hooks locally (recommended), use the provided helper which creates a local `.ci-venv` and installs `pre-commit` and `ruff`:

```bash
# create the hooks venv and install tooling
./scripts/setup-hooks.sh

# (optional) activate the venv for manual runs
source .ci-venv/bin/activate

# run all hooks across the repository to validate your environment
.ci-venv/bin/pre-commit run --all-files
```

If you prefer the system-wide `pre-commit` installation, install `pre-commit` and run `pre-commit install` instead. The helper keeps tooling isolated in `.ci-venv` and avoids mutating files during commits.

### Supported Output Formats

- Markdown (`.md`)
- HTML (`.html`)
- JSON (`.json`)
- XML (`.xml`)
- Any text-based format

## 🧪 Testing

Run tests for each component:

```bash
# temple
cd temple && pytest tests/

# temple-linter
cd temple-linter && pytest tests/

# vscode-temple-linter
cd vscode-temple-linter && npm run compile && npm run lint
```

## 📦 Dependency Isolation

Each subproject maintains its own isolated environment:

- **Python projects**: Use dedicated `.venv/` directories
- **Node.js project**: Uses local `node_modules/`
- **No cross-contamination**: Dependencies are scoped per component

## 🗺️ Development Workflow

### Multi-Root Workspace

Open `temple.code-workspace` in VS Code for optimal development experience. This configures:

- Separate workspace folders for each component
- Language-specific settings per folder
- Integrated terminal contexts

### Making Changes

1. **Specification changes** → Update `temple/docs/*.md`
2. **Tokenization/parsing** → Modify `temple-linter/src/`
3. **Editor integration** → Update `vscode-temple-linter/src/`
4. **Cross-component changes** → Update all affected components in same commit

### Commit Guidelines

Create atomic, logical commits:

- **feat**: New features
- **fix**: Bug fixes
- **docs**: Documentation only
- **refactor**: Code restructuring without behavior change
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

Example:

```bash
git commit -m "feat(temple-linter): add support for custom delimiters"
git commit -m "docs(temple): document query validation architecture"
```

## 🏛️ Architecture Philosophy

**The irreducible core:**
> Declarative, logic-driven transformation of structured data into text with a consistent, extensible authoring experience.

Temple abstracts away:

- Data structure types (JSON, XML, YAML, TOML)

## Local testing: CI helper scripts

1. Prepare the shared CI venv and install dependencies (recommended onboarding):

    ```bash
    ./scripts/setup-hooks.sh
    ```

    This helper creates a local `.ci-venv`, installs `pre-commit` and the required tooling, and runs `pre-commit install --install-hooks` so hooks execute with the venv-provided tools.

2. (Optional) If you prefer to create the venv manually or for CI-only use, you can run:

    ```bash
    ./scripts/ci/ensure_ci_venv.sh
    ```

3. Create a `detect-secrets` baseline (run once):

    ```bash
    ./scripts/ci/create_secrets_baseline.sh
    # review .secrets.baseline and commit it
    git add .secrets.baseline && git commit -m "chore(secrets): add detect-secrets baseline"
    ```

Pre-commit notes:

- The repository's hooks are managed via `pre-commit`. Running `./scripts/setup-hooks.sh` is the recommended onboarding step and ensures `pre-commit` is installed from the `.ci-venv` so hooks run against the venv's tools.
- To run hooks manually (after running `setup-hooks.sh`):

    ```bash
    .ci-venv/bin/pre-commit run --all-files
    ```

- The pre-commit hooks call scripts under `scripts/pre-commit/` (for example, `secure-find-secrets.sh`, `test-python.sh`, `build-docs.sh`). These step scripts assume required tools (Python, detect-secrets, pytest, sphinx-build, etc.) are available on PATH — which is satisfied when `pre-commit` is installed from `.ci-venv`.

If you prefer not to use the helper, you can still prepare the CI venv manually via `./scripts/ci/ensure_ci_venv.sh` and then run `.ci-venv/bin/pre-commit install --install-hooks` to get equivalent behavior.

## CI Status

Detect-secrets scan: ![detect-secrets](https://github.com/squirrel289/temple/actions/workflows/detect-secrets.yml/badge.svg)

The badge shows the latest status for the `detect-secrets` workflow. If the workflow fails, click the Actions tab and open the workflow run to see uploaded artifacts (scan output and report).

- Query engines and AST implementations
- Output formats and their linters
- Editor/IDE integration details

What remains:

- **Template logic language** (expressing mapping, looping, conditionals)
- **Transformation engine** (applying logic to data)
- **Extensibility hooks** (adding new logic, functions, integrations)

## 📄 License

See [[LICENSE]].

## Changelog

- Repository changelog: [[CHANGELOG]]
- January 2026: Clarified market positioning and adapter architecture in [ADR-003](temple/docs/adr/003-market-role-and-adapter-architecture.md). Temple now targets declarative, type-safe transformations and defines an adapter contract for engine integrations (Jinja2 first).
- February 2026: Locked base-language lint strategy precedence and diagnostics transport behavior in [ADR-005](temple/docs/adr/005-base-lint-strategy-and-diagnostics-pipeline.md).

## 🤝 Contributing

Contributions welcome! Please read each component's documentation before making changes:

- Understand the delimiter system (configurable tokens)
- Follow position tracking conventions (line, col tuples)
- Write tests before implementing features
- Consider cross-component impacts

## 🔗 Links

- **Specification Docs**: [temple/docs/](temple/docs/)
- **Issue Tracker**: [Add your issue tracker URL]
- **Discussion Forum**: [Add your discussion forum URL]

---

**Status**: Early development - specifications are stable, implementation is ongoing.

[LICENSE]: LICENSE "LICENSE"

[CHANGELOG]: .cache/pre-commit/repo70h0tvt5/CHANGELOG.md "What's New"

[ARCHITECTURE]: temple/docs/ARCHITECTURE.md "Temple: Sample Architecture"
