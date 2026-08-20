---
title: "45_implement_lsp_language_features"
status: completed
state_reason: success
priority: Medium
complexity: High
estimated_effort: 16 hours
actual_effort: 5
completed_date: 2026-02-13
related_commit:
  - 98facb7  # feat(vscode-extension): update LSP integration and diagnostics handling
  - c96532b  # refactor(ast): migrate imports to temple.typed_ast; deprecate legacy ast_nodes shim (backlog #35)
  - 58fe36a  # chore(typings): update temple typed_ast stub and diagnostics docs (backlog #45)
  - 7be8f73  # docs(backlog): record serializers commit and clean tmp file (backlog #35)
  - a38d007  # feat(temple-linter): add native LSP providers and perf checks
  - 8bb34ef  # feat(vscode): harden LSP init contract and packaging checks
test_results: "Local: uv run --with pytest --with ./temple --with ./temple-linter python -m pytest temple-linter/tests/test_lsp_features.py temple-linter/tests/test_lsp_entrypoint.py -q passes (14 tests incl. updated feature coverage)."
dependencies:
  - [[42_integrate_temple_core_dependency.md]] ⏳
  - [[43_implement_template_syntax_validation.md]] ⏳
  - [[44_implement_semantic_validation.md]] ⏳
related_backlog:
  - archive/17_refactor_lsp_server.md (LSP foundation)
related_spike: []

notes: |
  Implements advanced LSP features using temple core's parser and type system: completions, hover, go-to-definition, find references, rename.
  2026-02-13: Started implementation of native LSP feature providers and server wiring.
  2026-02-13: Added `lsp_features.py` providers and registered completion/hover/definition/references/rename handlers in lsp_server.
  2026-02-13: Committed integrated provider implementation and parser dependency guards in `a38d007`.
  2026-02-13: Added semantic schema-path initialization support and VS Code init-option wiring in `8bb34ef`.
---

## Goal

Implement advanced LSP language features using temple core's parser and type system: completions, hover information, go-to-definition, find references, and rename refactoring.

## Background

With syntax and semantic validation in place (backlog #43, #44), the LSP server can now provide IDE-like features. These features leverage the parsed AST and type information to enhance the authoring experience.

## Tasks

### 1. Implement Auto-Completion

Add completion provider using schema information:

```python
from lsprotocol.types import (
    CompletionItem, CompletionItemKind, CompletionParams, CompletionList
)

class TemplateCompletionProvider:
    """Provide completions for variables, properties, and keywords."""
    
    def __init__(self, schema_loader: SchemaLoader):
        self.schema_loader = schema_loader
    
    def get_completions(
        self, 
        text: str, 
        position: Position,
        schema: Optional[Schema] = None
    ) -> CompletionList:
        """
        Get completions at cursor position.
        
        Completions include:
        - Schema properties (user.name, user.email)
        - Template keywords (if, for, include, etc.)
        - Built-in filters/functions
        """
        # Parse text up to cursor
        line = text.split('\n')[position.line]
        char = position.character
        prefix = line[:char]
        
        # Check context
        if self._in_expression_context(prefix):
            return self._get_variable_completions(prefix, schema)
        elif self._in_statement_context(prefix):
            return self._get_keyword_completions(prefix)
        
        return CompletionList(is_incomplete=False, items=[])
    
    def _get_variable_completions(
        self, 
        prefix: str, 
        schema: Optional[Schema]
    ) -> CompletionList:
        """Get completions for variables based on schema."""
        if not schema:
            return CompletionList(is_incomplete=False, items=[])
        
        # Parse variable path: "user.pr" -> ["user", "pr"]
        path = self._extract_variable_path(prefix)
        
        # Get type at path from schema
        current_type = schema.root_type
        for segment in path[:-1]:
            if isinstance(current_type, ObjectType):
                current_type = current_type.properties.get(segment)
        
        # Generate completions for current level
        items = []
        if isinstance(current_type, ObjectType):
            for prop_name, prop_type in current_type.properties.items():
                if prop_name.startswith(path[-1]):  # Match prefix
                    items.append(CompletionItem(
                        label=prop_name,
                        kind=CompletionItemKind.Property,
                        detail=str(prop_type),
                        documentation=prop_type.description
                    ))
        
        return CompletionList(is_incomplete=False, items=items)
```

### 2. Implement Hover Information

Add hover provider for type information and documentation:

```python
from lsprotocol.types import Hover, MarkupContent, MarkupKind

class TemplateHoverProvider:
    """Provide hover information for variables and expressions."""
    
    def get_hover(
        self,
        text: str,
        position: Position,
        ast: Optional[Block] = None,
        schema: Optional[Schema] = None
    ) -> Optional[Hover]:
        """
        Get hover information at position.
        
        Shows:
        - Variable type and description
        - Expected/actual types for expressions
        - Documentation from schema
        """
        if not ast or not schema:
            return None
        
        # Find AST node at position
        node = self._find_node_at_position(ast, position)
        
        if isinstance(node, Expression):
            # Get type of expression
            type_checker = TypeChecker(schema)
            expr_type = type_checker.infer_type(node)
            
            # Format hover content
            content = f"**Type:** `{expr_type}`\n\n"
            if expr_type.description:
                content += expr_type.description
            
            return Hover(
                contents=MarkupContent(
                    kind=MarkupKind.Markdown,
                    value=content
                ),
                range=self._node_to_range(node)
            )
        
        return None
```

### 3. Implement Go-to-Definition

Add definition provider for includes and variable references:

```python
from lsprotocol.types import Location, LocationLink

class TemplateDefinitionProvider:
    """Provide go-to-definition for includes and variables."""
    
    def get_definition(
        self,
        text: str,
        position: Position,
        ast: Optional[Block] = None,
        workspace_root: Optional[Path] = None
    ) -> Optional[Location]:
        """
        Get definition location.
        
        Handles:
        - Include statements -> included file
        - Variable references -> schema definition
        """
        if not ast:
            return None
        
        node = self._find_node_at_position(ast, position)
        
        if isinstance(node, Include):
            # Find included file
            include_path = self._resolve_include_path(
                node.name, 
                workspace_root
            )
            if include_path and include_path.exists():
                return Location(
                    uri=include_path.as_uri(),
                    range=Range(
                        start=Position(line=0, character=0),
                        end=Position(line=0, character=0)
                    )
                )
        
        return None
```

### 4. Implement Find References

Add references provider for variable usage:

```python
from lsprotocol.types import ReferenceParams

class TemplateReferenceProvider:
    """Find all references to variables."""
    
    def find_references(
        self,
        text: str,
        position: Position,
        ast: Optional[Block] = None
    ) -> List[Location]:
        """
        Find all references to variable at position.
        
        Returns:
        - All locations where variable is used
        """
        if not ast:
            return []
        
        node = self._find_node_at_position(ast, position)
        
        if isinstance(node, Expression):
            variable_path = node.path
            
            # Walk AST and find all matching references
            references = []
            for ast_node in walk_ast(ast):
                if isinstance(ast_node, Expression) and ast_node.path == variable_path:
                    references.append(Location(
                        uri=self.current_uri,
                        range=self._node_to_range(ast_node)
                    ))
            
            return references
        
        return []
```

### 5. Implement Rename Refactoring

Add rename provider for variables:

```python
from lsprotocol.types import WorkspaceEdit, TextEdit

class TemplateRenameProvider:
    """Rename variables across templates."""
    
    def prepare_rename(
        self,
        text: str,
        position: Position,
        ast: Optional[Block] = None
    ) -> Optional[Range]:
        """Check if rename is valid at position."""
        if not ast:
            return None
        
        node = self._find_node_at_position(ast, position)
        return self._node_to_range(node) if isinstance(node, Expression) else None
    
    def rename(
        self,
        text: str,
        position: Position,
        new_name: str,
        ast: Optional[Block] = None
    ) -> Optional[WorkspaceEdit]:
        """Perform rename refactoring."""
        # Find all references
        references = self.reference_provider.find_references(text, position, ast)
        
        # Create edits for each reference
        edits = [
            TextEdit(range=loc.range, new_text=new_name)
            for loc in references
        ]
        
        return WorkspaceEdit(changes={self.current_uri: edits})
```

### 6. Integrate Features into LSP Server

Register all features in `lsp_server.py`:

```python
@server.feature(TEXT_DOCUMENT_COMPLETION)
async def completions(params: CompletionParams):
    doc = server.workspace.get_document(params.text_document.uri)
    schema = linter.schema_loader.load_from_workspace(params.text_document.uri)
    
    provider = TemplateCompletionProvider(linter.schema_loader)
    return provider.get_completions(doc.source, params.position, schema)

@server.feature(TEXT_DOCUMENT_HOVER)
async def hover(params: HoverParams):
    doc = server.workspace.get_document(params.text_document.uri)
    ast, _ = linter.parser.parse(doc.source)
    schema = linter.schema_loader.load_from_workspace(params.text_document.uri)
    
    provider = TemplateHoverProvider()
    return provider.get_hover(doc.source, params.position, ast, schema)

@server.feature(TEXT_DOCUMENT_DEFINITION)
async def definition(params: DefinitionParams):
    doc = server.workspace.get_document(params.text_document.uri)
    ast, _ = linter.parser.parse(doc.source)
    
    provider = TemplateDefinitionProvider()
    return provider.get_definition(
        doc.source, 
        params.position, 
        ast, 
        server.workspace.root_path
    )

@server.feature(TEXT_DOCUMENT_REFERENCES)
async def references(params: ReferenceParams):
    doc = server.workspace.get_document(params.text_document.uri)
    ast, _ = linter.parser.parse(doc.source)
    
    provider = TemplateReferenceProvider()
    return provider.find_references(doc.source, params.position, ast)

@server.feature(TEXT_DOCUMENT_RENAME)
async def rename(params: RenameParams):
    doc = server.workspace.get_document(params.text_document.uri)
    ast, _ = linter.parser.parse(doc.source)
    
    provider = TemplateRenameProvider()
    return provider.rename(doc.source, params.position, params.new_name, ast)
```

### 7. Add Tests for Each Feature

Create `tests/test_lsp_features.py`:

```python
def test_completion_schema_properties():
    """Test completions for schema properties."""
    schema = Schema.from_dict({
        "type": "object",
        "properties": {
            "user": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "email": {"type": "string"}
                }
            }
        }
    })
    
    text = "{{ user. }}"  # Cursor after "user."
    position = Position(line=0, character=8)
    
    provider = TemplateCompletionProvider(schema_loader)
    completions = provider.get_completions(text, position, schema)
    
    labels = [item.label for item in completions.items]
    assert "name" in labels
    assert "email" in labels

def test_hover_shows_type():
    """Test hover displays variable type."""
    schema = Schema.from_dict({
        "type": "object",
        "properties": {
            "age": {"type": "number", "description": "User's age"}
        }
    })
    
    text = "{{ age }}"
    position = Position(line=0, character=4)  # Over "age"
    ast, _ = parser.parse(text)
    
    provider = TemplateHoverProvider()
    hover = provider.get_hover(text, position, ast, schema)
    
    assert "number" in hover.contents.value
    assert "User's age" in hover.contents.value

def test_goto_definition_include():
    """Test go-to-definition for includes."""
    text = "{% include 'header.html' %}"
    position = Position(line=0, character=15)  # Over filename
    ast, _ = parser.parse(text)
    
    provider = TemplateDefinitionProvider()
    location = provider.get_definition(text, position, ast, workspace_root)
    
    assert location is not None
    assert "header.html" in location.uri

def test_find_references():
    """Test finding all variable references."""
    text = "{{ name }} and {{ name }} again"
    position = Position(line=0, character=4)  # First "name"
    ast, _ = parser.parse(text)
    
    provider = TemplateReferenceProvider()
    refs = provider.find_references(text, position, ast)
    
    assert len(refs) == 2  # Both occurrences
```

## Acceptance Criteria

- ✓ Completions show schema properties with type information
- ✓ Completions include template keywords (if, for, include, etc.)
- ✓ Hover displays variable types and descriptions from schema
- ✓ Go-to-definition works for include statements
- ✓ Find references finds all variable usages
- ✓ Rename refactoring updates all references
- ✓ Performance acceptable (< 50ms response time)
- ✓ Features work in multi-file workspaces
- ✓ Tests cover all feature implementations

## Implementation Notes

- Cache parsed ASTs for performance
- Handle partial/incomplete templates gracefully
- Provide useful results even without schema (keyword completions, etc.)
- Consider semantic tokens for syntax highlighting
- Support incremental parsing for large files

## Related Work

- Backlog #42: Integrate Temple Core Dependency
- Backlog #43: Implement Template Syntax Validation (provides AST)
- Backlog #44: Implement Semantic Validation (provides type info)
- Backlog #17: LSP Server Refactor (LSP foundation)
