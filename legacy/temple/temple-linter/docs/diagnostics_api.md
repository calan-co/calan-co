# Diagnostics API Documentation

The Temple diagnostics system provides comprehensive error reporting with source position tracking, severity levels, and LSP integration. This guide covers diagnostic types, formatting, mapping, and integration with IDEs.

## Overview

Diagnostics are generated during three phases:

1. **Parsing:** Syntax errors (unexpected tokens, unclosed blocks)
2. **Type Checking:** Type errors (undefined variables, mismatched types)
3. **Semantic Analysis:** Logic errors (circular includes, invalid operations)

Each diagnostic includes:
- Source position (line, column) for precise error location
- Severity level (error, warning, information, hint)
- Actionable message with suggestions
- Optional source context for clarity

## Core API

### Diagnostic Severity

```python
from enum import Enum

class DiagnosticSeverity(Enum):
    """Diagnostic severity levels matching LSP specification."""
    ERROR = 1          # Compilation error; must be fixed
    WARNING = 2        # Non-critical issue; may affect output
    INFORMATION = 3    # Informational message
    HINT = 4          # Hint for improvement
```

### Diagnostic Class

```python
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
from temple.compiler.diagnostics import Diagnostic, DiagnosticSeverity
from temple.typed_ast import SourceRange

@dataclass
class Diagnostic:
    """Represents a single diagnostic message."""
    
    message: str                    # Human-readable error message
    severity: DiagnosticSeverity   # Error, warning, info, or hint
    source_range: SourceRange      # (line, col) start and end
    source: str = "temple"         # Source identifier (parser, type-checker, etc.)
    code: Optional[str] = None     # Error code (UNDEFINED_VAR, TYPE_MISMATCH, etc.)
    related_information: Optional[List['DiagnosticRelatedInformation']] = None
    tags: Optional[List['DiagnosticTag']] = None
    data: Optional[Dict[str, Any]] = None
    
    def to_lsp(self) -> Dict[str, Any]:
        """Convert to LSP Diagnostic format for IDE integration."""
        return {
            "range": self.source_range.to_lsp(),
            "message": self.message,
            "severity": self.severity.value,
            "source": self.source,
            "code": self.code,
            # ... additional LSP fields
        }
    
    def to_string(self, source_text: Optional[str] = None, include_context: bool = True) -> str:
        """Format diagnostic as human-readable string with optional source context."""
        # Returns formatted message with source snippet
        pass
```

### DiagnosticCollector

Aggregates diagnostics from all phases with filtering and formatting:

```python
from temple.compiler.diagnostics import DiagnosticCollector

collector = DiagnosticCollector()

# Add diagnostics from various phases
collector.add_error("Unexpected token", source_range)
collector.add_warning("Unused variable", source_range)

# Filter (e.g., suppress specific error codes)
collector.suppress("UNUSED_VARIABLE")

# Get summary
error_count = collector.error_count()  # Count of errors
warning_count = collector.warning_count()

# Convert to LSP format
lsp_diagnostics = collector.to_lsp()

# Format as human-readable report
report = collector.format_all(source_text)
print(report)
```

## Error Types

### Syntax Errors

Generated during parsing phase.

```python
# Example: Unclosed block
source_range = SourceRange(Position(5, 0), Position(5, 12))
diag = Diagnostic(
    message="Unclosed block: expected 'end' after 'if' statement",
    severity=DiagnosticSeverity.ERROR,
    source_range=source_range,
    source="parser",
    code="UNCLOSED_BLOCK"
)

# Example: Unexpected token
diag = Diagnostic(
    message="Unexpected token 'for'; expected expression or statement",
    severity=DiagnosticSeverity.ERROR,
    source_range=source_range,
    source="parser",
    code="UNEXPECTED_TOKEN"
)
```

### Type Errors

Generated during type-checking phase.

```python
# Example: Undefined variable
diag = Diagnostic(
    message="Undefined variable 'user.missing_field'",
    severity=DiagnosticSeverity.ERROR,
    source_range=source_range,
    source="type-checker",
    code="UNDEFINED_VARIABLE"
)

# Example: Type mismatch
diag = Diagnostic(
    message="Cannot iterate over non-iterable type 'string'",
    severity=DiagnosticSeverity.ERROR,
    source_range=source_range,
    source="type-checker",
    code="TYPE_MISMATCH"
)
```

### Semantic Errors

Generated during validation phase.

```python
# Example: Circular include
diag = Diagnostic(
    message="Circular include detected: 'header.tmpl' includes 'footer.tmpl' which includes 'header.tmpl'",
    severity=DiagnosticSeverity.ERROR,
    source_range=source_range,
    source="validator",
    code="CIRCULAR_INCLUDE"
)

# Example: Deprecated syntax
diag = Diagnostic(
    message="Deprecated syntax '{# comment #}'; use '# comment' instead",
    severity=DiagnosticSeverity.WARNING,
    source_range=source_range,
    source="validator",
    code="DEPRECATED_SYNTAX"
)
```

## Formatting Diagnostics

### ErrorFormatter

Formats diagnostics as human-readable messages with optional source context:

```python
from temple.compiler.error_formatter import ErrorFormatter
from temple.compiler.diagnostics import Diagnostic, DiagnosticSeverity
from temple.typed_ast import SourceRange, Position

formatter = ErrorFormatter(use_colors=True)

# Format a single diagnostic
diagnostic = Diagnostic(
    message="Undefined variable 'user.name'",
    severity=DiagnosticSeverity.ERROR,
    source_range=SourceRange(Position(5, 10), Position(5, 25)),
    source="type-checker",
    code="UNDEFINED_VARIABLE"
)

formatted = formatter.format_diagnostic(
    diagnostic,
    source_text=template_text,
    include_context=True,
    include_code=True
)

print(formatted)
# Output:
# [type-checker] error: Undefined variable 'user.name'
#   at line 6, column 11
#   Code: UNDEFINED_VARIABLE
#   
#   Context:
#     5 | {% if user.name %}
#     6 |   Hello, {{ user.name }}!
#            ^^^^^^^^^^^^^^^^
#     7 | {% end %}

# Format multiple diagnostics
diagnostics = [diag1, diag2, diag3]
report = formatter.format_diagnostics(
    diagnostics,
    source_text=template_text,
    include_context=True
)

print(report)
# Groups diagnostics by severity with formatted output
```

## Diagnostic Mapping (temple-linter)

Maps diagnostics from preprocessed templates back to original positions when base format linting is involved.

### TemplateMapping

Maps positions between preprocessed and original template:

```python
from temple_linter.template_mapping import TemplateMapping

# Original template with DSL tokens
original = """
{
  "name": "{{ user.name }}",
  "invalid": true true
}
"""

# Preprocessed (DSL tokens stripped)
preprocessed = """
{
  "name": "",
  "invalid": true true
}
"""

mapping = TemplateMapping(original)

# Map diagnostic position from preprocessed to original
preprocessed_pos = 52  # Position in preprocessed
original_pos = mapping.pre_to_orig(preprocessed_pos)
print(f"Position in original: {original_pos}")
```

### DiagnosticMappingService (LSP Integration)

Service for mapping LSP diagnostics between content versions:

```python
from temple_linter.services.diagnostic_mapping_service import DiagnosticMappingService
from lsprotocol.types import Diagnostic, Position, Range
from temple.template_tokenizer import temple_tokenizer

service = DiagnosticMappingService()

# Diagnostics from base linter (e.g., jsonlint)
# These have positions in the cleaned content
diagnostics = [
    Diagnostic(
        range=Range(
            start=Position(line=2, character=10),
            end=Position(line=2, character=20)
        ),
        message="Duplicate key 'name'"
    )
]

# Tokens from the original template
text_tokens = list(temple_tokenizer(original_template))

# Map diagnostics to original positions
mapped = service.map_diagnostics(diagnostics, text_tokens)

for diag in mapped:
    print(f"Error at line {diag.range.start.line + 1}, column {diag.range.start.character + 1}")
    # Output: Error at line 3, column 15 (in original template)
```

## LSP Integration

### Converting to LSP Format

Diagnostics are converted to LSP format for IDE integration:

```python
from temple.compiler.diagnostics import Diagnostic, DiagnosticSeverity
from temple.typed_ast import SourceRange, Position

diagnostic = Diagnostic(
    message="Undefined variable",
    severity=DiagnosticSeverity.ERROR,
    source_range=SourceRange(Position(5, 10), Position(5, 25))
)

# Convert to LSP
lsp_diag = diagnostic.to_lsp()
print(lsp_diag)
# Output:
# {
#     "range": {
#         "start": {"line": 5, "character": 10},
#         "end": {"line": 5, "character": 25}
#     },
#     "message": "Undefined variable",
#     "severity": 1  # ERROR
# }
```

### VS Code Extension Integration

The VS Code extension receives LSP diagnostics and displays them:

```typescript
// In VS Code extension (extension.ts)
client.onRequest('temple/requestBaseDiagnostics', async (params) => {
    const { uri, content } = params;
    
    // Get diagnostics from VS Code's native linters
    const diagnostics = vscode.languages.getDiagnostics(uri);
    
    // Convert to LSP format
    const lspDiagnostics = diagnostics.map(vscDiagToLspDiag);
    
    return { diagnostics: lspDiagnostics };
});
```

## Error Suppression

Suppress specific errors with comments:

```template
{% if not user.name %}
  {# @suppress UNDEFINED_VARIABLE #}
  Name is not available
{% end %}

{# @suppress UNUSED_VARIABLE #}
{% set temp = some_value %}
```

## Practical Examples

### Example 1: Undefined Variable Error

**Template:**
```template
{
  "name": "{{ user.fullName }}"
}
```

**Diagnostic:**
```python
Diagnostic(
    message="Undefined variable 'user.fullName'; did you mean 'user.name'?",
    severity=DiagnosticSeverity.ERROR,
    source_range=SourceRange(Position(1, 12), Position(1, 30)),
    source="type-checker",
    code="UNDEFINED_VARIABLE",
    data={"suggestion": "user.name"}
)
```

**IDE Output:**
```
[type-checker] error: Undefined variable 'user.fullName'; did you mean 'user.name'?
  at line 2, column 13
  Code: UNDEFINED_VARIABLE
  Suggestion: user.name
```

### Example 2: Type Mismatch Error

**Template:**
```template
{% for item in user.roles %}
  {{ item }}
{% end %}
```

**With data:** `{"user": {"roles": "admin"}}`

**Diagnostic:**
```python
Diagnostic(
    message="Cannot iterate over non-iterable type 'string'; expected array",
    severity=DiagnosticSeverity.ERROR,
    source_range=SourceRange(Position(0, 0), Position(0, 30)),
    source="type-checker",
    code="TYPE_MISMATCH"
)
```

### Example 3: Base Format Error with Mapping

**Original Template:**
```template
{
  "name": "{{ user.name }}",
  "invalid": true true
}
```

**Base Linter Error:** "Duplicate value at line 3, column 20"

**After Mapping:** "Duplicate value in original template at line 3, column 20"

## Acceptance Criteria

✓ All errors include accurate source position (line, column)  
✓ Error messages are actionable with suggestions when applicable  
✓ Diagnostics support severity levels (error, warning, info, hint)  
✓ LSP format conversion enables IDE integration  
✓ Diagnostic mapping preserves positions when stripping DSL tokens  
✓ Error suppression works via comments  
✓ Human-readable formatting with source context  

## Related Documentation

- [Serializers API](serializers.md) — Output format handling
- [Syntax Specification](syntax_spec.md) — Template syntax
- [Error Reporting Strategy](error_reporting_strategy.md) — Error philosophy and approach
