---
title: "47_documentation_updates_for_core_integration"
status: completed
state_reason: success
priority: Medium
complexity: Low
estimated_effort: 6 hours
actual_effort: 2
completed_date: 2026-02-13
related_commit:
  - 87bb8ea  # docs(repo): automate markdown structure trees with scoped notes
  - 27f0660  # ci(docs): scope readme-structure validation to in-scope files
  - 4e193ab  # chore(release): add license metadata and MVP release docs
test_results: "Scoped docs validation passes locally (`python3 scripts/docs/sync_readme_structure.py --check README.md temple-linter/README.md vscode-temple-linter/README.md`); README structure blocks synchronized."
dependencies:
  - [[42_integrate_temple_core_dependency.md]] ⏳
  - [[43_implement_template_syntax_validation.md]] ⏳
  - [[44_implement_semantic_validation.md]] ⏳
  - [[45_implement_lsp_language_features.md]] ⏳
related_backlog:
  - archive/21_api_documentation.md (initial docs)
  - archive/16_documentation.md (original docs)
related_spike: []

notes: |
  Updates all temple-linter documentation to reflect temple core integration: installation, architecture, API reference, user guides, migration notes.
  2026-02-13: Rewrote `temple-linter/README.md` to remove stale setup instructions and align with current MVP behavior.
  2026-02-13: Added automated markdown tree sync + scoped YAML notes and updated project README structures in commit `87bb8ea`.
  2026-02-13: Added scoped docs validation and MVP release/readme updates in `27f0660` and `4e193ab`.
---

## Goal

Update all temple-linter documentation to reflect temple core integration: installation, architecture, API reference, user guides, and migration notes.

## Background

Temple-linter now depends on temple core and provides significantly enhanced functionality (syntax validation, semantic validation, LSP features). Documentation needs comprehensive updates to reflect these changes.

## Tasks

### 1. Update README.md

Major rewrite to reflect new capabilities:

```markdown
# Temple Linter

**LSP-based linter for Temple DSL templates** with comprehensive syntax validation, semantic type checking, and advanced IDE features.

## Features

### ✅ Template Validation
- **Syntax Validation:** Unclosed blocks, malformed expressions, invalid statements
- **Semantic Validation:** Undefined variables, type mismatches, schema violations
- **Base Format Linting:** Integrates with native linters (JSON, YAML, HTML, Markdown)

### 🚀 Language Server Features
- **Auto-Completion:** Schema-based property completions, keyword suggestions
- **Hover Information:** Type information and documentation from schemas
- **Go-to-Definition:** Navigate to included templates
- **Find References:** Find all variable usages
- **Rename Refactoring:** Update variable names across templates

### 📊 Schema Support
- **JSON Schema:** Full support for validation and completions
- **Auto-Discovery:** Automatic schema loading from workspace
- **Type Inference:** Smart type checking based on schema definitions

## Installation

### Prerequisites
- Python 3.8+
- Temple core package: `pip install temple`

### Install Temple Linter
```bash
# Install from source
git clone https://github.com/your-org/temple-linter
cd temple-linter
pip install -e .

# Or via pip (when published)
pip install temple-linter
```

### VS Code Extension
Install the Temple Linter extension from the marketplace, or:
```bash
cd vscode-temple-linter
npm install
npm run compile
code --install-extension temple-linter-0.1.0.vsix
```

## Quick Start

### Command Line
```bash
# Lint a template
temple-linter lint template.json.tmpl

# With schema validation
temple-linter lint template.json.tmpl --schema schema.json

# Specify output format
temple-linter lint template.json.tmpl --format json
```

### As a Library
```python
from temple_linter import TemplateLinter
from temple.compiler import Schema

# Create linter
linter = TemplateLinter()

# Lint template
template = "{% if user.active %}{{ user.name }}{% end %}"
diagnostics = linter.lint(template)

# With schema
schema = Schema.from_file("schema.json")
diagnostics = linter.lint(template, schema=schema)

# Print results
for diag in diagnostics:
    print(f"{diag.severity}: {diag.message} at {diag.source_range}")
```

### LSP Server
```bash
# Start LSP server
temple-linter-lsp

# Or with custom configuration
temple-linter-lsp --config linter.yaml
```

## Configuration

Create `.temple/config.yaml` in your workspace:

```yaml
# Schema mappings
schemas:
  "*.user.json.tmpl": "schemas/user.schema.json"
  "*.config.yaml.tmpl": "schemas/config.schema.json"

# Validation options
validation:
  strict: true
  checkUnusedVariables: true
  requireSchemas: false

# Base linting
base_linting:
  enabled: true
  passthrough_to_vscode: true
```

## Architecture

Temple-linter uses temple core for parsing and type checking, combined with base format linters for comprehensive validation:

```
Template File (JSON/YAML/HTML.tmpl)
          ↓
    [Temple Tokenizer] → Tokens
          ↓
    [Temple Parser] → AST + Syntax Diagnostics
          ↓
    [Type Checker] → Semantic Diagnostics (with Schema)
          ↓
    [Token Stripper] → Cleaned Base Format
          ↓
    [Base Linter] → Base Format Diagnostics
          ↓
    [Diagnostic Mapper] → Combined Diagnostics
          ↓
    LSP Server → Editor
```

## Documentation

- [API Documentation](docs/api.rst) - Full API reference
- [Diagnostics API](docs/diagnostics_api.md) - Error reporting system
- [Extending](docs/EXTENDING.md) - Custom validators and linters
- [Temple Core Docs](../temple/README.md) - Core templating engine

## Development

### Setup
```bash
# Clone repository
git clone https://github.com/your-org/temple-linter
cd temple-linter

# Install temple core first
cd ../temple && pip install -e .

# Install temple-linter
cd ../temple-linter && pip install -e .

# Install dev dependencies
pip install pytest pytest-cov pytest-benchmark
```

### Running Tests
```bash
# All tests
pytest

# Integration tests
pytest tests/test_e2e_integration.py

# Performance benchmarks
pytest tests/benchmarks/ --benchmark-only

# With coverage
pytest --cov=temple_linter --cov-report=html
```

## Troubleshooting

### Temple Core Not Found
Ensure temple is installed: `pip install temple` or `pip install -e ../temple`

### Schema Not Loading
Check schema path configuration in `.temple/config.yaml` or use absolute paths.

### LSP Server Not Starting
Verify installation: `which temple-linter-lsp`
Check logs: `tail -f ~/.temple/lsp.log`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.
```

### 2. Update Architecture Documentation

Expand `docs/ARCHITECTURE.md` with temple core integration details:

```markdown
# Temple Linter Architecture

## Overview

Temple-linter provides LSP-based linting with two validation layers:

1. **Template Layer:** Temple DSL syntax and semantics (via temple core)
2. **Base Format Layer:** Target format validation (JSON, YAML, HTML, etc.)

## Component Architecture

### Temple Core Integration

```
temple.compiler
├── parser.TypedTemplateParser    → Syntax validation
├── type_checker.TypeChecker      → Semantic validation  
├── diagnostics.Diagnostic        → Error reporting
└── schema.Schema                 → Type system
```

### Temple Linter Components

```
temple_linter/
├── linter.py                     → Main linting orchestration
├── services/
│   ├── token_cleaning_service.py → Strip DSL tokens
│   ├── diagnostic_mapping_service.py → Position mapping
│   └── base_linting_service.py   → Base format validation
└── lsp_server.py                 → LSP server implementation
```

## Data Flow

### 1. Document Opens
```
Editor → LSP → DidOpenTextDocument → TemplateLinter.lint()
```

### 2. Syntax Validation
```
Template Text → TypedTemplateParser.parse() → (AST, Diagnostics)
```

### 3. Semantic Validation (if schema available)
```
AST + Schema → TypeChecker.check() → Type Diagnostics
```

### 4. Base Format Validation
```
Template → TokenCleaner → Cleaned Text → Base Linter → Base Diagnostics
```

### 5. Diagnostic Mapping
```
Base Diagnostics → DiagnosticMapper → Original Positions → Combined Diagnostics
```

### 6. Result Delivery
```
Combined Diagnostics → LSP → Editor (underlines, problems panel)
```

## Caching Strategy

### AST Cache
- Cache parsed ASTs by document URI + version
- Invalidate on document change
- LRU eviction for memory management

### Schema Cache
- Cache schemas by file path
- Watch schema files for changes
- Reload on modification

### Token Position Map Cache
- Cache position mappings for diagnostic conversion
- Invalidate on document change

## Performance Optimizations

1. **Incremental Parsing:** Parse only changed regions (future)
2. **Lazy Type Checking:** Skip if no schema available
3. **Parallel Base Linting:** Run base linters concurrently
4. **Debounced Diagnostics:** Batch updates to reduce editor thrashing

## Extension Points

### Custom Validators
Implement `TemplateValidator` interface:
```python
class CustomValidator(TemplateValidator):
    def validate(self, ast: Block, schema: Optional[Schema]) -> List[Diagnostic]:
        # Custom validation logic
        pass
```

### Custom Schema Loaders
Implement `SchemaLoader` interface:
```python
class CustomSchemaLoader(SchemaLoader):
    def load(self, uri: str) -> Optional[Schema]:
        # Custom schema loading
        pass
```
```

### 3. Create User Guide

Add `docs/USER_GUIDE.md`:

```markdown
# Temple Linter User Guide

## Getting Started

### Installation
1. Install temple core: `pip install temple`
2. Install temple-linter: `pip install temple-linter`
3. Install VS Code extension (optional)

### First Template
Create `hello.json.tmpl`:
```json
{
  "greeting": "{{ message }}",
  "user": "{{ user.name }}"
}
```

### Schema Definition
Create `hello.schema.json`:
```json
{
  "type": "object",
  "properties": {
    "message": {"type": "string"},
    "user": {
      "type": "object",
      "properties": {
        "name": {"type": "string"}
      }
    }
  }
}
```

### Lint Your Template
```bash
temple-linter lint hello.json.tmpl --schema hello.schema.json
```

## Schema-Based Validation

### Auto-Discovery
Place schema alongside template:
```
mytemplate.json.tmpl
mytemplate.schema.json   ← Auto-discovered
```

### Project-Wide Schemas
Configure in `.temple/config.yaml`:
```yaml
schemas:
  "*.user.json.tmpl": "schemas/user.schema.json"
  "templates/*.yaml.tmpl": "schemas/config.schema.json"
```

## IDE Features

### Auto-Completion
Type `{{ user.` to see available properties from schema.

### Hover Information
Hover over variables to see type and documentation.

### Go-to-Definition
Ctrl+Click on include statements to jump to file.

### Find All References
Right-click variable → Find All References.

### Rename
Right-click variable → Rename Symbol.

## Common Patterns

### Conditional Rendering
```handlebars
{% if user.active %}
  Active user: {{ user.name }}
{% else %}
  Inactive user
{% end %}
```

### Loops
```handlebars
{% for item in items %}
  - {{ item.name }}
{% end %}
```

### Includes
```handlebars
{% include 'header.html' %}
<main>Content</main>
{% include 'footer.html' %}
```

## Troubleshooting

### "Undefined variable" errors
- Ensure variable exists in schema
- Check spelling and case sensitivity
- Verify schema is loaded (check LSP logs)

### Base format errors
- Verify cleaned output is valid
- Check if DSL tokens interfere with format
- Use custom delimiters if needed

### Performance issues
- Enable AST caching
- Reduce schema complexity
- Use incremental validation
```

### 4. Update API Documentation

Enhance `docs/api.rst` with temple core APIs:

```rst
Temple Linter API Reference
===========================

Core APIs
---------

TemplateLinter
~~~~~~~~~~~~~~

.. autoclass:: temple_linter.TemplateLinter
   :members:
   :undoc-members:

.. code-block:: python

   from temple_linter import TemplateLinter
   from temple.compiler import Schema
   
   linter = TemplateLinter()
   diagnostics = linter.lint(template_text, schema=schema)

Temple Core Integration
-----------------------

Parser
~~~~~~

.. autoclass:: temple.compiler.TypedTemplateParser
   :members: parse

Type Checker
~~~~~~~~~~~~

.. autoclass:: temple.compiler.TypeChecker
   :members: check, infer_type

Schema
~~~~~~

.. autoclass:: temple.compiler.Schema
   :members: from_dict, from_file

Diagnostics
~~~~~~~~~~~

.. autoclass:: temple.compiler.Diagnostic
   :members:

LSP Features
------------

CompletionProvider
~~~~~~~~~~~~~~~~~~

.. autoclass:: temple_linter.TemplateCompletionProvider
   :members: get_completions

HoverProvider
~~~~~~~~~~~~~

.. autoclass:: temple_linter.TemplateHoverProvider
   :members: get_hover
```

### 5. Add Migration Guide

Create `docs/MIGRATION.md`:

```markdown
# Migration Guide

## Upgrading from v0.x to v1.0 (Temple Core Integration)

### Breaking Changes

1. **Temple Core Dependency Required**
   ```bash
   # Old (v0.x)
   pip install temple-linter
   
   # New (v1.0+)
   pip install temple temple-linter
   ```

2. **Diagnostic Format Changed**
   ```python
   # Old
   {"message": "...", "line": 1, "col": 5}
   
   # New
   Diagnostic(
       message="...",
       severity=DiagnosticSeverity.ERROR,
       source_range=SourceRange(Position(1, 5), Position(1, 10))
   )
   ```

3. **Configuration Format Updated**
   ```yaml
   # Old
   linter:
     enable_base: true
   
   # New
   validation:
     strict: true
   base_linting:
     enabled: true
   ```

### New Features

- ✅ Syntax validation with temple core parser
- ✅ Semantic validation with type checker
- ✅ Schema support for variable validation
- ✅ LSP language features (completions, hover, etc.)

### Migration Steps

1. Install temple core: `pip install temple`
2. Update configuration file format
3. Update API calls if using programmatically
4. Test with new diagnostic format
```

## Acceptance Criteria

- ✓ README updated with installation, quick start, and features
- ✓ Architecture docs explain temple core integration
- ✓ User guide covers common workflows and patterns
- ✓ API reference documents all public APIs
- ✓ Migration guide helps v0.x users upgrade
- ✓ All code examples are tested and accurate
- ✓ Documentation builds without errors (Sphinx)
- ✓ Links between docs work correctly

## Documentation Structure

```
docs/
├── index.rst              # Documentation homepage
├── getting_started.md     # Installation and quick start
├── user_guide.md          # Common patterns and workflows
├── api.rst                # API reference (auto-generated)
├── architecture.md        # System architecture
├── diagnostics_api.md     # Diagnostics system (existing)
├── EXTENDING.md           # Extension points (existing)
└── MIGRATION.md           # Version migration guide
```

## Implementation Notes

- Use Sphinx for documentation generation
- Include code examples that can be tested
- Add diagrams for architecture (Mermaid or PlantUML)
- Link to temple core docs where appropriate
- Keep user guide beginner-friendly
- Provide troubleshooting section with common issues

## Related Work

- Backlog #42: Integrate Temple Core Dependency
- Backlog #43: Implement Template Syntax Validation
- Backlog #44: Implement Semantic Validation
- Backlog #45: Implement LSP Language Features
- Backlog #21: API Documentation (initial docs)
- Backlog #16: Documentation (original docs)
