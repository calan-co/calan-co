# Temple: AI Agent Instructions

## Project Overview
Temple is a meta-templating system for structured data (JSON, XML, YAML, TOML) that enables authoring templates in target output formats (Markdown, HTML, JSON) with lightweight DSL overlays. The core philosophy: **declarative, logic-driven transformation of structured data into text** with a consistent, extensible authoring experience.

## Architecture: Three Interconnected Components

### 1. `temple/` - Core Templating Engine (Active Development)
- **Purpose**: Authoritative tokenization, core template processing, specifications
- **Status**: Functional core - tokenizer production-ready, rendering engine pending
- **Key Files**:
  - [src/temple/template_tokenizer.py](../temple/src/temple/template_tokenizer.py): Authoritative tokenizer with LRU caching
  - [src/temple/__init__.py](../temple/src/temple/__init__.py): Package exports (Token, TokenType, temple_tokenizer)
  - [tests/test_tokenizer.py](../temple/tests/test_tokenizer.py): Core tokenizer tests
  - [docs/ARCHITECTURE.md](../temple/docs/ARCHITECTURE.md): Modular architecture (parsers, query engine, linter, renderer)
  - [docs/syntax_spec.md](../temple/docs/syntax_spec.md): DSL syntax using configurable delimiters (default: `{% %}`, `{{ }}`)
  - [docs/query_language_and_schema.md](../temple/docs/query_language_and_schema.md): Dot notation, JMESPath, schema validation
- **Dependencies**: Python 3.8+ (stdlib only), installed via `pip install -e .`

### 2. `temple-linter/` - Template Linting & Diagnostics (Active Development)
- **Purpose**: LSP server for template-aware linting, strips templates for base format validation
- **Key Components**:
  - Imports tokenizer from `temple.template_tokenizer` (core dependency)
  - [template_preprocessing.py](../temple-linter/src/temple_linter/template_preprocessing.py): Strips template tokens (regex-based) for base format linting
  - [diagnostics.py](../temple-linter/src/temple_linter/diagnostics.py): Maps diagnostics between preprocessed and original positions
  - [linter.py](../temple-linter/src/temple_linter/linter.py): CLI entry point with `--delegate-base-lint` for external linter integration
- **Testing**: Run tests in `tests/` directory using pytest
- **Dependencies**: Python 3.8+, installed via `pip install -r requirements.txt`

### 3. `vscode-temple-linter/` - VS Code Extension (TypeScript)
- **Purpose**: VS Code integration using LSP proxy to delegate base format linting back to VS Code's native linters
- **Architecture**: Python LSP server (temple-linter) ↔ Node.js LSP proxy ↔ VS Code linters (see [ARCHITECTURE.md](../vscode-temple-linter/ARCHITECTURE.md))
- **Key File**: [src/extension.ts](../vscode-temple-linter/src/extension.ts)
  - Virtual document provider (`temple-cleaned://` scheme) for diagnostic collection
  - LSP proxy server handling `temple/createVirtualDocument` notifications
  - Fallback to temp files if virtual docs fail (controlled by `TEMPLE_LINTER_FORCE_TEMP`)
- **Build**: `npm run compile` (TypeScript → dist/src/)
- **File Extensions**: `.tmpl`, `.template` mapped to `templ-any` language ID

## Critical Patterns & Conventions

### Configurable Delimiters
Templates support custom delimiters to avoid conflicts with output formats:
```yaml
# Default: {% %}, {{ }}, {# #}
# Custom example:
temple:
  statement_start: "<<"
  statement_end: ">>"
  expression_start: "<:"
  expression_end: ":>"
```
**Implementation**: All tokenizers/parsers accept `delimiters` dict parameter (see [template_tokenizer.py](../temple/src/temple/template_tokenizer.py))

### Token Types
- **text**: Raw content (default if no delimiters match)
- **statement**: Logic blocks (`{% if %}`, `{% for %}`, etc.)
- **expression**: Variable insertion (`{{ user.name }}`)
- **comment**: Ignored content (`{# note #}`)

### Error Reporting Philosophy (from [error_reporting_strategy.md](../temple/docs/error_reporting_strategy.md))
- **Inline annotations**: Errors reference exact token positions (start/end tuples)
- **Actionable messages**: Suggest fixes, not just problems
- **Best-effort rendering**: Partial output with error comments when possible
- **Query validation**: Reference both query syntax and schema location

### Testing Conventions
- Test files: `test_*.py` in respective `tests/` directories
- Use helper functions like `tokens_to_tuples()` for easier test assertions (see [test_tokenizer.py](../temple/tests/test_tokenizer.py))
- Tests validate token positions (`(line, col)` tuples) and delimiter handling

## Monorepo Workspace Structure
This is a **single-root monorepo** defined in `temple.code-workspace`:
- All three components (`temple/`, `temple-linter/`, `vscode-temple-linter/`) are in one repository
- Each Python subproject has its own `.venv/` for dependency isolation
- VS Code extension has its own `node_modules/` directory
- Unified workspace settings apply to all folders (Python version, formatters, linters)
- Changes should consider cross-component impacts (e.g., delimiter config affects all three)

## Development Workflow

### Python Components (temple, temple-linter)
```bash
# Install temple core first
cd temple
pip install -e .

# Install temple-linter (depends on temple)
cd ../temple-linter
pip install -r requirements.txt

# Run tests (from component directory)
pytest tests/

# CLI usage example (temple-linter)
python -m src.temple_linter.linter --lint --input "{% if x %}hello{% end %}"
```

### VS Code Extension
```bash
cd vscode-temple-linter
npm install
npm run compile  # TypeScript compilation
npm run watch    # Development mode
```

### Key Commands
- Test tokenizer: `pytest temple/tests/test_tokenizer.py -v`
- Preprocess template: `python temple-linter/src/temple_linter/template_preprocessing.py --strip --input "<text>"`
- Build extension: `cd vscode-temple-linter && npm run compile`

## Integration Points
1. **temple → temple-linter**: temple-linter imports tokenizer from `temple.template_tokenizer`
2. **temple-linter → VS Code Extension**: Custom LSP notifications (`temple/createVirtualDocument`) for cleaned content
3. **VS Code → Native Linters**: Virtual document URIs trigger VS Code's diagnostic providers (JSON, Markdown, HTML, etc.)

## Roadmap Context
- Core `temple/` engine is **actively developed** - tokenizer production-ready, rendering engine pending
- `temple-linter/` is **actively developed** - depends on temple core, focus on LSP integration
- `vscode-temple-linter/` is **functional prototype** - needs testing with real-world templates

## When Adding Features
1. **Delimiter support**: Always add `delimiters` parameter with defaults
2. **Position tracking**: Maintain accurate `(line, col)` tuples through all transformations
3. **Error messages**: Follow inline + actionable format from error strategy doc
4. **Tests first**: Add test cases before implementing (see existing test patterns)
5. **Cross-component**: Consider if changes affect temple/temple-linter/vscode-linter integration
