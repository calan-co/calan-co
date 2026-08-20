---
title: "43_implement_template_syntax_validation"
status: completed
priority: High
complexity: Medium
estimated_effort: 8 hours
actual_effort: 2 hours
completed_date: 2025-01-29
related_commit: 
  - 3ccdc09  # Implement template syntax validation (#43)
test_results: "All 24 tests passing"
dependencies:
  - [[42_integrate_temple_core_dependency.md]] ✅
related_backlog: []
related_spike:
  - archive/30_typed_dsl_prototype.md (parser patterns)

notes: |
  Integrated temple.compiler.parser.TypedTemplateParser to replace stub TemplateLinter with real syntax validation.
  Created diagnostic_converter.py for temple→LSP conversion.
  Updated LintOrchestrator integration.
  Added comprehensive tests for syntax validation and integration.
---

## Goal

Integrate temple core's `TypedTemplateParser` to provide comprehensive syntax validation for template files, detecting unclosed blocks, malformed expressions, and syntax errors.

## Background

Currently, `TemplateLinter` is a stub that returns empty diagnostics. This task replaces it with actual parsing-based validation using temple core's parser to catch syntax errors at author time.

## Tasks

### 1. Implement Parser-Based Linting in TemplateLinter

Replace stub implementation in `linter.py`:

```python
from typing import List, Dict, Any, Optional
from temple.compiler import TypedTemplateParser, Diagnostic
from temple.compiler.diagnostics import DiagnosticSeverity

class TemplateLinter:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.parser = TypedTemplateParser()
    
    def lint(self, text: str) -> List[Diagnostic]:
        """
        Parse template and return syntax diagnostics.
        
        Returns:
            List of Diagnostic objects with syntax errors
        """
        try:
            ast, diagnostics = self.parser.parse(text)
            return diagnostics
        except Exception as e:
            # Convert unexpected errors to diagnostics
            return [
                Diagnostic(
                    message=f"Parser error: {str(e)}",
                    severity=DiagnosticSeverity.ERROR,
                    source_range=None,
                    source="temple-linter",
                    code="PARSER_ERROR"
                )
            ]
```

### 2. Add Diagnostic Conversion for LSP

Create `diagnostic_converter.py` to convert temple diagnostics to LSP format:

```python
from temple.compiler import Diagnostic, DiagnosticSeverity
from lsprotocol.types import Diagnostic as LspDiagnostic, DiagnosticSeverity as LspSeverity

def temple_to_lsp_diagnostic(diag: Diagnostic) -> LspDiagnostic:
    """Convert temple Diagnostic to LSP Diagnostic."""
    severity_map = {
        DiagnosticSeverity.ERROR: LspSeverity.Error,
        DiagnosticSeverity.WARNING: LspSeverity.Warning,
        DiagnosticSeverity.INFORMATION: LspSeverity.Information,
        DiagnosticSeverity.HINT: LspSeverity.Hint,
    }
    
    return LspDiagnostic(
        range=source_range_to_lsp_range(diag.source_range),
        severity=severity_map[diag.severity],
        code=diag.code,
        source=diag.source,
        message=diag.message,
    )
```

### 3. Update LintOrchestrator

Integrate parser validation into the orchestration flow:

```python
class LintOrchestrator:
    def __init__(self):
        self.template_linter = TemplateLinter()
        # ... other services
    
    def lint(self, text: str, uri: str) -> List[LspDiagnostic]:
        # 1. Parse template for syntax errors
        template_diagnostics = self.template_linter.lint(text)
        
        # 2. Clean tokens for base format linting (existing)
        cleaned_text, tokens = self.token_cleaner.clean_text_and_tokens(text)
        
        # 3. Lint base format (existing)
        base_diagnostics = self.base_linter.lint(cleaned_text, uri)
        
        # 4. Map and combine all diagnostics
        all_diagnostics = (
            [temple_to_lsp_diagnostic(d) for d in template_diagnostics] +
            base_diagnostics
        )
        
        return all_diagnostics
```

### 4. Add Tests for Syntax Validation

Update `tests/test_linter.py`:

```python
def test_unclosed_if_block():
    """Test detection of unclosed if block."""
    text = "{% if user.active %}Hello"
    linter = TemplateLinter()
    diagnostics = linter.lint(text)
    assert len(diagnostics) > 0
    assert any("unclosed" in d.message.lower() for d in diagnostics)

def test_malformed_expression():
    """Test detection of malformed expression."""
    text = "{{ user. }}"
    linter = TemplateLinter()
    diagnostics = linter.lint(text)
    assert len(diagnostics) > 0
    assert any("syntax" in d.message.lower() for d in diagnostics)

def test_valid_template():
    """Test that valid templates produce no diagnostics."""
    text = "{% if user.active %}{{ user.name }}{% end %}"
    linter = TemplateLinter()
    diagnostics = linter.lint(text)
    assert len(diagnostics) == 0
```

### 5. Add Integration Test with LSP Server

Test end-to-end syntax validation through LSP:

```python
def test_lsp_syntax_validation():
    """Test syntax validation through LSP server."""
    # Create LSP server with document
    server = create_test_lsp_server()
    doc_uri = "file:///test.html.tmpl"
    text = "{% if user.active %}{{ user.name }}"  # Missing end
    
    # Trigger diagnostics
    diagnostics = server.text_document_diagnostic(doc_uri, text)
    
    # Verify syntax error detected
    assert any(d.code == "UNCLOSED_BLOCK" for d in diagnostics)
```

## Acceptance Criteria

- ✓ `TemplateLinter.lint()` returns real syntax diagnostics from parser
- ✓ Unclosed blocks detected and reported with proper source positions
- ✓ Malformed expressions detected (empty paths, invalid syntax)
- ✓ Valid templates produce zero diagnostics
- ✓ Diagnostics converted to LSP format correctly
- ✓ LSP server displays syntax errors in editor
- ✓ Tests pass for common syntax error cases
- ✓ Performance acceptable for large files (< 100ms for 10KB template)

## Error Cases to Handle

1. **Unclosed blocks:**
   - `{% if x %}...` (missing `{% end %}`)
   - `{% for item in items %}...` (missing `{% end %}`)

2. **Mismatched blocks:**
   - `{% if x %}...{% end %}` (end expected)
   - `{% for x in y %}...{% end %}` (end expected)

3. **Malformed expressions:**
   - `{{ user. }}` (incomplete path)
   - `{{ }}` (empty expression)
   - `{{ user name }}` (invalid syntax)

4. **Invalid statements:**
   - `{% if %}` (missing condition)
   - `{% for %}` (missing iteration spec)
   - `{% unknown %}` (unsupported statement)

## Implementation Notes

- Parser must handle partial/incomplete templates gracefully
- Source positions must be accurate for editor integration
- Consider caching parsed ASTs for performance
- Error messages should be actionable and reference exact positions
- Handle multi-line templates correctly (line/column tracking)

## Related Work

- Backlog #42: Integrate Temple Core Dependency
- Backlog #34: Typed DSL Parser (provides parsing API)
- Backlog #17: LSP Server Refactor (LSP integration foundation)
