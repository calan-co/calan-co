"""
temple.compiler.serializers package
Multi-format serializers for typed DSL output.

Includes:
- JSONSerializer: JSON output with type coercion
- MarkdownSerializer: Markdown output with formatting
- HTMLSerializer: HTML output with escaping and sanitization
- YAMLSerializer: YAML output with block/flow styles
"""

from temple.compiler.serializers.base import (
    Serializer,
    SerializationError,
    SerializationContext,
)
from temple.compiler.serializers.json_serializer import JSONSerializer
from temple.compiler.serializers.markdown_serializer import MarkdownSerializer
from temple.compiler.serializers.html_serializer import HTMLSerializer
from temple.compiler.serializers.yaml_serializer import YAMLSerializer

__all__ = [
    "Serializer",
    "SerializationError",
    "SerializationContext",
    "JSONSerializer",
    "MarkdownSerializer",
    "HTMLSerializer",
    "YAMLSerializer",
]
