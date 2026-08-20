---
title: "44_implement_semantic_validation"
status: completed
state_reason: success
priority: High
complexity: High
estimated_effort: 12 hours
actual_effort: 6
completed_date: 2026-02-13
related_commit:
  - 62d1795  # feat(semantic): seed type checker from schema for lint diagnostics
test_results: "2026-02-13: semantic/schema/type-check suites passing locally (temple/tests/types/test_type_checker.py, temple-linter/tests/test_semantic_linter.py, temple-linter/tests/test_lsp_mvp_smoke.py)"
dependencies:
  - [[42_integrate_temple_core_dependency.md]] ⏳
  - [[43_implement_template_syntax_validation.md]] ⏳
    - [[54_complete_temple_native.md]] ⏳
related_backlog:
  - archive/02_query_language_and_schema.md (schema validation spec)
related_spike:
  - archive/30_typed_dsl_prototype.md (type checker reference)

notes: |
  Integrates type checker and schema system for semantic validation: undefined variables, type mismatches, schema violations.
  2026-02-13: Added schema-seeded type environments and schema-only semantic diagnostics in commit `62d1795`.
---

## Goal

Integrate temple core's type checker and schema system to provide semantic validation: undefined variables, type mismatches, invalid operations, and schema violations.

## Background

After syntax validation (backlog [[43_implement_template_syntax_validation]]), the next layer is semantic validation. This requires type checking template expressions against input data schemas to catch logical errors before runtime.

## Tasks

### 1. Add Schema Loading Support

Create `schema_loader.py` for loading schemas from various sources:

```python
from typing import Optional
from pathlib import Path
from temple.compiler import Schema, SchemaParser

class SchemaLoader:
    """Load and cache schemas for template validation."""
    
    def __init__(self):
        self.parser = SchemaParser()
        self._cache: Dict[str, Schema] = {}
    
    def load_from_file(self, schema_path: Path) -> Schema:
        """Load schema from JSON Schema or YAML file."""
        if str(schema_path) in self._cache:
            return self._cache[str(schema_path)]
        
        schema_text = schema_path.read_text()
        schema = self.parser.parse(schema_text)
        self._cache[str(schema_path)] = schema
        return schema
    
    def load_from_workspace(self, template_uri: str) -> Optional[Schema]:
        """
        Auto-discover schema for template.
        
        Search order:
        1. Sidecar file: template.json.tmpl -> template.schema.json
        2. Project root: .temple/schema.json
        3. Inline comment: {# @schema: path/to/schema.json #}
        """
        # Implementation for schema discovery
        pass
```

### 2. Integrate Type Checker in TemplateLinter

Extend `TemplateLinter` with type checking:

```python
from temple.compiler import TypedTemplateParser, TypeChecker, Schema
from temple.compiler.diagnostics import Diagnostic

class TemplateLinter:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.parser = TypedTemplateParser()
        self.schema_loader = SchemaLoader()
    
    def lint(
        self, 
        text: str, 
        schema: Optional[Schema] = None,
        template_uri: Optional[str] = None
    ) -> List[Diagnostic]:
        """
        Lint template with syntax and semantic validation.
        
        Args:
            text: Template content
            schema: Optional schema for validation
            template_uri: Optional URI for schema auto-discovery
            
        Returns:
            Combined syntax and semantic diagnostics
        """
        # 1. Parse for syntax errors
        ast, parse_diagnostics = self.parser.parse(text)
        
        # 2. If no AST (parse failed), return parse errors only
        if ast is None:
            return parse_diagnostics
        
        # 3. Auto-discover schema if not provided
        if schema is None and template_uri:
            schema = self.schema_loader.load_from_workspace(template_uri)
        
        # 4. Type check if schema available
        type_diagnostics = []
        if schema:
            type_checker = TypeChecker(schema)
            type_diagnostics = type_checker.check(ast)
        
        # 5. Combine all diagnostics
        return parse_diagnostics + type_diagnostics
```

### 3. Add Configuration for Schema Paths

Update config support in `lsp_server.py`:

```python
# In LSP initialization
def initialize(params: InitializeParams):
    # Read workspace configuration
    config = params.initialization_options or {}
    
    # Schema configuration
    schema_paths = config.get("temple.schemas", {})
    # Example: {"*.user.json.tmpl": "schemas/user.schema.json"}
    
    # Store for use in linting
    linter.schema_loader.set_pattern_mappings(schema_paths)
```

### 4. Implement Common Semantic Error Detection

Add specific error detection for common cases:

```python
class SemanticValidator:
    """Additional semantic validation beyond type checker."""
    
    def validate_includes(self, ast: Block) -> List[Diagnostic]:
        """Detect missing or circular includes."""
        pass
    
    def validate_loops(self, ast: Block) -> List[Diagnostic]:
        """Detect loops over non-iterable values."""
        pass
    
    def validate_conditionals(self, ast: Block) -> List[Diagnostic]:
        """Detect always-true/false conditions."""
        pass
```

### 5. Add Comprehensive Tests

Create `tests/test_semantic_validation.py`:

```python
def test_undefined_variable():
    """Test detection of undefined variables."""
    schema = Schema.from_dict({
        "type": "object",
        "properties": {
            "name": {"type": "string"}
        }
    })
    
    text = "{{ user.email }}"  # email not in schema
    linter = TemplateLinter()
    diagnostics = linter.lint(text, schema=schema)
    
    assert any(d.code == "UNDEFINED_VARIABLE" for d in diagnostics)
    assert any("email" in d.message for d in diagnostics)

def test_type_mismatch():
    """Test detection of type mismatches."""
    schema = Schema.from_dict({
        "type": "object",
        "properties": {
            "age": {"type": "number"}
        }
    })
    
    text = "{% if age %}...{% end %}"  # number in boolean context
    linter = TemplateLinter()
    diagnostics = linter.lint(text, schema=schema)
    
    assert any(d.code == "TYPE_MISMATCH" for d in diagnostics)

def test_invalid_operation():
    """Test detection of invalid operations."""
    schema = Schema.from_dict({
        "type": "object",
        "properties": {
            "name": {"type": "string"}
        }
    })
    
    text = "{{ name + 5 }}"  # string + number
    linter = TemplateLinter()
    diagnostics = linter.lint(text, schema=schema)
    
    assert any(d.code == "INVALID_OPERATION" for d in diagnostics)

def test_schema_auto_discovery():
    """Test automatic schema loading from workspace."""
    # Create test workspace with schema file
    workspace = create_test_workspace()
    workspace.write("template.json.tmpl", "{{ user.name }}")
    workspace.write("template.schema.json", '{"type": "object", "properties": {"user": {"type": "object"}}}')
    
    linter = TemplateLinter()
    diagnostics = linter.lint(
        "{{ user.email }}",  # not in schema
        template_uri=workspace.uri("template.json.tmpl")
    )
    
    assert any(d.code == "UNDEFINED_VARIABLE" for d in diagnostics)
```

### 6. Add LSP Integration for Schema-Based Features

Enable schema-aware features:

```python
# In lsp_server.py
@server.feature(TEXT_DOCUMENT_COMPLETION)
def completions(params: CompletionParams):
    """Provide completions based on schema."""
    doc = server.workspace.get_document(params.text_document.uri)
    schema = linter.schema_loader.load_from_workspace(params.text_document.uri)
    
    if schema:
        # Get available properties at cursor position
        cursor_pos = params.position
        # ... completion logic using schema
```

## Acceptance Criteria

- ✓ Undefined variables detected and reported with variable name
- ✓ Type mismatches detected (string vs number, etc.)
- ✓ Invalid operations detected (incompatible types)
- ✓ Schema auto-discovery works for common patterns
- ✓ Schema loading cached for performance
- ✓ Configuration supports custom schema mappings
- ✓ Tests cover common semantic error cases
- ✓ LSP integration enables schema-based completions
- ✓ Error messages reference both template position and schema location

## Semantic Errors to Detect

1. **Undefined Variables:**
   - `{{ user.missing_field }}` (field not in schema)
   - `{{ unknown_var }}` (variable not defined)

2. **Type Mismatches:**
   - `{% if age %}` where age is number (implicit bool conversion)
   - `{{ items[0] }}` where items is not array
   - `{% for x in name %}` where name is string (not iterable in typed context)

3. **Invalid Operations:**
   - `{{ name + age }}` (string + number)
   - `{{ age / name }}` (number / string)

4. **Schema Violations:**
   - Required fields missing
   - Extra properties not allowed
   - Constraint violations (min/max, pattern, etc.)

5. **Circular Includes:**
   - `a.tmpl` includes `b.tmpl` which includes `a.tmpl`

## Configuration Example

`.vscode/settings.json`:

```json
{
  "temple.schemas": {
    "*.user.json.tmpl": "schemas/user.schema.json",
    "*.config.yaml.tmpl": "schemas/config.schema.json"
  },
  "temple.validation.strict": true,
  "temple.validation.checkUnusedVariables": true
}
```

## Implementation Notes

- Schema validation should be optional (graceful degradation without schema)
- Consider performance impact of type checking on large templates
- Cache type environments for repeated validations
- Provide quick fixes for common issues (e.g., "Add field to schema")
- Support both JSON Schema and simpler inline schema formats

## Related Work

- Backlog #42: Integrate Temple Core Dependency
- Backlog #43: Implement Template Syntax Validation
- Backlog #35: Typed DSL Type System (provides type checker)
- Backlog #02: Query Language and Schema (schema validation spec)

[43_implement_template_syntax_validation]: archive/43_implement_template_syntax_validation.md "43_implement_template_syntax_validation"
