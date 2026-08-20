"""
Tests for base serializer interface and functionality.
"""

import pytest

from temple.compiler.serializers.base import (
    SerializationContext,
    Serializer,
)
from temple.diagnostics import Position, SourceRange
from temple.typed_ast import Block, Expression, Text


class MockSerializer(Serializer):
    """Mock serializer for testing base functionality."""

    def serialize(self, ast, data):
        context = SerializationContext(data)
        return self.evaluate(ast, context)

    def evaluate(self, node, context):
        if isinstance(node, Text):
            return node.text
        if isinstance(node, Expression):
            return str(context.get_variable(node.expr))
        if isinstance(node, Block):
            return "".join(str(self.evaluate(c, context)) for c in node.nodes)
        return ""

    def format_value(self, value):
        return str(value)


class TestSerializationContext:
    """Test SerializationContext functionality."""

    def test_simple_variable_access(self):
        """Test accessing simple variables."""
        ctx = SerializationContext({"name": "Alice", "age": 30})
        assert ctx.get_variable("name") == "Alice"
        assert ctx.get_variable("age") == 30

    def test_nested_variable_access(self):
        """Test accessing nested variables with dot notation."""
        ctx = SerializationContext(
            {"user": {"name": "Bob", "email": "bob@example.com"}}
        )
        assert ctx.get_variable("user.name") == "Bob"
        assert ctx.get_variable("user.email") == "bob@example.com"

    def test_array_access(self):
        """Test accessing array elements."""
        ctx = SerializationContext({"items": ["first", "second", "third"]})
        assert ctx.get_variable("items.0") == "first"
        assert ctx.get_variable("items.1") == "second"

    def test_undefined_variable(self):
        """Test accessing undefined variable returns None."""
        ctx = SerializationContext({"name": "Alice"})
        assert ctx.get_variable("missing") is None

    def test_scope_stack(self):
        """Test scope push/pop functionality."""
        ctx = SerializationContext({"outer": "value"})
        assert ctx.current_scope == {"outer": "value"}

        ctx.push_scope({"inner": "data"})
        assert ctx.current_scope == {"inner": "data"}
        assert ctx.get_variable("inner") == "data"

        ctx.pop_scope()
        assert ctx.current_scope == {"outer": "value"}

    def test_set_variable_available_to_expression_eval(self):
        """Set variables should participate in subsequent lookups."""
        ctx = SerializationContext({"user": {"name": "Ada"}})
        ctx.set_variable("greeting", "hello")

        assert ctx.get_variable("greeting") == "hello"
        assert ctx.get_variable("user.name") == "Ada"

    def test_scope_mapping_handles_non_dict_scope(self):
        """Scope mapping should be safe even when current scope is not a dict."""
        ctx = SerializationContext({"items": [1, 2, 3]})
        ctx.push_scope("scalar")
        mapped = ctx.scope_mapping()

        assert mapped["value"] == "scalar"
        ctx.pop_scope()


class TestBasicSerialization:
    """Test basic serialization functionality."""

    def test_text_serialization(self):
        """Test serializing text nodes."""
        source = SourceRange(Position(0, 0), Position(0, 0))
        text = Text(source, "hello")
        serializer = MockSerializer()
        result = serializer.serialize(text, {})
        assert result == "hello"

    def test_expression_serialization(self):
        """Test serializing expressions."""
        source = SourceRange(Position(0, 0), Position(0, 0))
        expr = Expression(source, "name")
        serializer = MockSerializer()
        result = serializer.serialize(expr, {"name": "world"})
        assert result == "world"

    def test_block_serialization(self):
        """Test serializing blocks."""
        source = SourceRange(Position(0, 0), Position(0, 0))
        children = [
            Text(source, "Hello "),
            Expression(source, "name"),
        ]
        block = Block(children, name="content")
        serializer = MockSerializer()
        result = serializer.serialize(block, {"name": "World"})
        assert result == "Hello World"


class TestTypeCoercion:
    """Test type coercion functionality."""

    def test_coerce_to_string(self):
        """Test coercion to string type."""
        from temple.compiler.types import StringType

        serializer = MockSerializer()
        result = serializer._type_coerce(123, StringType())
        assert result == "123"

    def test_coerce_to_number(self):
        """Test coercion to number type."""
        from temple.compiler.types import NumberType

        serializer = MockSerializer()
        result = serializer._type_coerce("42", NumberType())
        assert result == 42


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
