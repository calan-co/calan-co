# Serializers API Documentation

The Temple serializers API provides a unified interface for converting type-checked ASTs into formatted output across multiple formats (JSON, Markdown, HTML, YAML). This guide covers the core API, extension points, and practical usage.

## Overview

Serializers are responsible for:
1. Evaluating AST nodes against input data (variables)
2. Respecting type annotations for proper formatting
3. Producing valid, well-formatted output in the target format
4. Handling errors gracefully with helpful diagnostics

## Core API

### Serializer (Abstract Base Class)

All format-specific serializers inherit from `Serializer`:

```python
from temple.compiler.serializers import Serializer, SerializationContext

class Serializer(ABC):
    """Abstract base class for format-specific serializers."""
    
    def __init__(self, pretty: bool = True, strict: bool = False):
        """
        Initialize serializer.
        
        Args:
            pretty: Enable pretty-printing/formatting (indentation, line breaks)
            strict: Enforce strict format validation (fail on invalid content)
        """
        self.pretty = pretty
        self.strict = strict
    
    @abstractmethod
    def serialize(self, ast: ASTNode, data: Dict[str, Any]) -> str:
        """
        Serialize AST with input data into formatted output.
        
        Args:
            ast: Type-checked AST to serialize
            data: Input data (variables) for template
            
        Returns:
            Formatted output string (JSON, Markdown, HTML, YAML, etc.)
            
        Raises:
            SerializationError: If serialization fails
        """
        pass
    
    @abstractmethod
    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """
        Recursively evaluate AST node to produce intermediate representation.
        
        Args:
            node: AST node to evaluate (Text, Expression, If, For, etc.)
            context: Serialization context with current scope/variables
            
        Returns:
            Evaluated value (format-specific: string, dict, list, etc.)
            
        Raises:
            SerializationError: If evaluation fails
        """
        pass
    
    @abstractmethod
    def format_value(self, value: Any) -> str:
        """
        Format evaluated value into string for output format.
        
        Args:
            value: Evaluated value (may be Python type or intermediate representation)
            
        Returns:
            Formatted string for output (escaped, quoted, indented, etc.)
        """
        pass
```

### SerializationContext

Tracks state during serialization, including variable scopes and type information:

```python
from temple.compiler.serializers import SerializationContext

class SerializationContext:
    """Context for tracking serialization state and scope."""
    
    def __init__(self, data: Dict[str, Any], schema: Optional[BaseType] = None):
        """
        Initialize context.
        
        Args:
            data: Input variables for template (dict-like structure)
            schema: Optional type schema for validation during serialization
        """
        self.data = data
        self.schema = schema
        self.scope_stack = [self.data]  # Stack of variable scopes
    
    def get_variable(self, path: str) -> Any:
        """
        Get variable value by dot-notation path.
        
        Args:
            path: Dot-notation path, e.g., 'user.name', 'items.0.title'
            
        Returns:
            Value if found, None otherwise
            
        Examples:
            >>> ctx = SerializationContext({"user": {"name": "Alice", "age": 30}})
            >>> ctx.get_variable("user.name")
            'Alice'
            >>> ctx.get_variable("user.age")
            30
            >>> ctx.get_variable("user.missing")
            None
        """
        pass
    
    def push_scope(self, data: Any) -> None:
        """
        Push new scope onto stack (used for loop iterations, conditionals).
        
        Args:
            data: New scope data (dict, value, etc.)
            
        Example:
            >>> ctx = SerializationContext({"outer": "value"})
            >>> ctx.push_scope({"inner": "item"})
            >>> ctx.get_variable("inner")
            'item'
        """
        pass
    
    def pop_scope(self) -> None:
        """Pop scope from stack, returning to parent scope."""
        pass
    
    @property
    def current_scope(self) -> Any:
        """Get current scope data (top of stack)."""
        pass
```

## Built-in Serializers

### JSONSerializer

Produces valid JSON with type coercion and proper handling of numbers, strings, and null values.

```python
from temple.compiler.serializers import JSONSerializer

serializer = JSONSerializer(pretty=True, strict=False)

# Template with expressions and loops
ast = parser.parse_template("""
{
  "name": "{{ user.name }}",
  "age": {{ user.age }},
  "active": {{ user.active }},
  "roles": [
    {% for role in user.roles -%}
    "{{ role }}"{% if not loop.last %},{% end %}
    {% end %}
  ]
}
""")

data = {
    "user": {
        "name": "Alice",
        "age": 30,
        "active": True,
        "roles": ["admin", "developer"]
    }
}

output = serializer.serialize(ast, data)
print(output)
# Output:
# {
#   "name": "Alice",
#   "age": 30,
#   "active": true,
#   "roles": [
#     "admin",
#     "developer"
#   ]
# }
```

**Key Features:**
- Type coercion (Python `True` → JSON `true`, `False` → `false`, `None` → `null`)
- Proper number formatting (integers vs. floats)
- String escaping (quotes, backslashes, control characters)
- ISO 8601 date/datetime conversion

### MarkdownSerializer

Produces valid Markdown with heading levels, lists, inline formatting, and code blocks.

```python
from temple.compiler.serializers import MarkdownSerializer

serializer = MarkdownSerializer(pretty=True, base_heading_level=1)

ast = parser.parse_template("""
# {{ title }}

{{ description }}

## Skills
{% for skill in skills -%}
- {{ skill }}
{% end %}
""")

data = {
    "title": "Developer Resume",
    "description": "Experienced full-stack engineer",
    "skills": ["Python", "TypeScript", "Kubernetes"]
}

output = serializer.serialize(ast, data)
```

**Key Features:**
- Heading level management (`base_heading_level` parameter)
- List formatting (bullets, ordered, nested)
- Inline formatting (bold, italic, inline code)
- Code blocks with language tags
- Proper Markdown escaping

### HTMLSerializer

Produces valid HTML with element escaping, attribute handling, and sanitization options.

```python
from temple.compiler.serializers import HTMLSerializer

serializer = HTMLSerializer(pretty=True, strict=False, sanitize=True)

ast = parser.parse_template("""
<div class="profile">
  <h1>{{ user.name }}</h1>
  <p>Status: <span class="{% if user.active %}active{% else %}inactive{% end %}">
    {% if user.active %}Active{% else %}Inactive{% end %}
  </span></p>
  <ul>
    {% for role in user.roles -%}
    <li>{{ role }}</li>
    {% end %}
  </ul>
</div>
""")

data = {
    "user": {
        "name": "Alice",
        "active": True,
        "roles": ["admin", "developer"]
    }
}

output = serializer.serialize(ast, data)
```

**Key Features:**
- HTML entity escaping (e.g., `&`, `<`, `>`, `"`)
- Attribute value escaping
- Void element handling (self-closing tags)
- Optional sanitization (strip unsafe tags)
- Proper indentation in pretty mode

### YAMLSerializer

Produces valid YAML with block/flow styles, anchors, and reference handling.

```python
from temple.compiler.serializers import YAMLSerializer

serializer = YAMLSerializer(pretty=True, strict=False)

ast = parser.parse_template("""
name: {{ user.name }}
age: {{ user.age }}
active: {{ user.active }}
roles:
  {% for role in user.roles -%}
  - {{ role }}
  {% end %}
bio: |
  {{ user.bio }}
""")

data = {
    "user": {
        "name": "Alice",
        "age": 30,
        "active": True,
        "roles": ["admin", "developer"],
        "bio": "Full-stack engineer\nwith 5 years experience"
    }
}

output = serializer.serialize(ast, data)
```

**Key Features:**
- Block scalar handling (`|` for multiline, `>` for folded)
- Flow styles for compact arrays/dicts
- Proper boolean/null formatting
- Anchor and reference support (future)
- YAML-safe string escaping

## Extension Points

### Creating Custom Serializers

Implement `Serializer` for custom output formats:

```python
from temple.compiler.serializers import Serializer, SerializationContext, SerializationError
from temple.typed_ast import ASTNode, Text, Expression, If, For

class CSVSerializer(Serializer):
    """Example: Custom CSV serializer."""
    
    def serialize(self, ast: ASTNode, data: Dict[str, Any]) -> str:
        """Convert AST to CSV format."""
        context = SerializationContext(data)
        try:
            result = self.evaluate(ast, context)
            return result if isinstance(result, str) else str(result or "")
        except Exception as e:
            raise SerializationError(f"CSV serialization error: {str(e)}", ast.source_range)
    
    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """Recursively evaluate AST nodes."""
        if isinstance(node, Text):
            return node.value
        
        elif isinstance(node, Expression):
            value = context.get_variable(node.value)
            return self.format_value(value)
        
        elif isinstance(node, For):
            iterable = context.get_variable(node.iterable)
            if not isinstance(iterable, (list, tuple)):
                if self.strict:
                    raise SerializationError(f"For loop requires iterable", node.source_range)
                return ""
            
            results = []
            for idx, item in enumerate(iterable):
                context.push_scope({
                    node.var: item,
                    "loop": {
                        "index": idx,
                        "first": idx == 0,
                        "last": idx == len(iterable) - 1
                    }
                })
                result = self._evaluate_block(node.body, context)
                context.pop_scope()
                if result:
                    results.append(result)
            
            return ",".join(results)
        
        elif isinstance(node, If):
            condition = context.get_variable(node.condition)
            if condition:
                return self._evaluate_block(node.body, context)
            elif node.else_body:
                return self._evaluate_block(node.else_body, context)
            return ""
        
        else:
            return ""
    
    def format_value(self, value: Any) -> str:
        """Format value as CSV field (quote if contains comma/quote)."""
        s = str(value or "")
        if "," in s or '"' in s:
            return f'"{s.replace('"', '""')}"'
        return s
    
    def _evaluate_block(self, children: List[ASTNode], context: SerializationContext) -> str:
        """Evaluate a block of nodes."""
        return "".join(str(self.evaluate(c, context)) for c in children)
```

### Type Coercion

Serializers automatically coerce Python values to format-appropriate types:

```python
class MySerializer(Serializer):
    def _type_coerce(self, value: Any, target_type: Optional[BaseType]) -> Any:
        """
        Coerce value to target type if schema provided.
        
        Args:
            value: Value to coerce
            target_type: Target type from schema
            
        Returns:
            Coerced value
        """
        if target_type is None or value is None:
            return value
        
        type_name = target_type.__class__.__name__
        
        if type_name == "StringType" and not isinstance(value, str):
            return str(value)
        elif type_name == "NumberType" and isinstance(value, str):
            try:
                return float(value) if '.' in value else int(value)
            except ValueError:
                return value
        elif type_name == "BooleanType" and isinstance(value, (int, str)):
            return bool(int(value)) if isinstance(value, str) else bool(value)
        
        return value
```

## Usage Examples

### Example 1: Simple Template

```python
from temple.compiler.parser import TypedTemplateParser
from temple.compiler.serializers import JSONSerializer

parser = TypedTemplateParser()
serializer = JSONSerializer(pretty=True)

template = '{"greeting": "{{ greeting }}", "name": "{{ name }}"}'
ast, _ = parser.parse(template)

data = {"greeting": "Hello", "name": "World"}
output = serializer.serialize(ast, data)
print(output)
# Output: {"greeting": "Hello", "name": "World"}
```

### Example 2: Conditional & Loop

```python
template = """
{
  "users": [
    {% for user in users -%}
    {
      "name": "{{ user.name }}",
      "active": {{ user.active }}{% if not loop.last %},{% end %}
    }
    {% end %}
  ]
}
"""

data = {
    "users": [
        {"name": "Alice", "active": True},
        {"name": "Bob", "active": False}
    ]
}

output = serializer.serialize(ast, data)
```

### Example 3: Type Coercion

```python
template = '{"age": {{ age }}, "price": {{ price }}, "available": {{ available }}}'

data = {
    "age": "30",        # String coerced to int
    "price": 19.99,     # Float preserved
    "available": 1      # Int coerced to boolean
}

output = serializer.serialize(ast, data)
# Output: {"age": 30, "price": 19.99, "available": true}
```

## Error Handling

Serializers raise `SerializationError` with source position information:

```python
from temple.compiler.serializers import SerializationError

try:
    output = serializer.serialize(ast, data)
except SerializationError as e:
    print(f"Error at line {e.source_range.start.line}: {e.message}")
```

## Performance Considerations

1. **Caching:** Type annotations are cached during parsing; serialization reuses them.
2. **Streaming:** For large templates, consider implementing streaming evaluation (future feature).
3. **Pretty Printing:** Disable `pretty=True` for faster serialization without formatting.

## Related Documentation

- [Typed DSL Syntax](syntax_spec.md) — Template syntax and DSL features
- [Query Language & Schema](query_language_and_schema.md) — Variable access and validation
- [Diagnostics API](diagnostics_api.md) — Error reporting and source mapping
