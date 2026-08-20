"""
Tests for JSON serializer.
"""

import pytest
import json
from temple.compiler.serializers.json_serializer import JSONSerializer
from temple.typed_ast import Text, Expression, If, For, Block
from temple.diagnostics import Position, SourceRange


def make_source():
    """Create a dummy source range for testing."""
    return SourceRange(Position(0, 0), Position(0, 0))


class TestJSONSerializer:
    """Test JSON serialization."""

    def test_serialize_text(self):
        """Test serializing plain text."""
        source = make_source()
        text = Text(source, "hello")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(text, {})
        assert result == '"hello"'

    def test_serialize_expression(self):
        """Test serializing variable expressions."""
        source = make_source()
        expr = Expression(source, "name")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(expr, {"name": "world"})
        assert result == '"world"'

    def test_serialize_number(self):
        """Test serializing numeric values."""
        source = make_source()
        expr = Expression(source, "count")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(expr, {"count": 42})
        assert result == "42"

    def test_serialize_nested_object(self):
        """Test serializing nested objects."""
        source = make_source()
        data = {"user": {"name": "Alice", "age": 30}}
        expr = Expression(source, "user")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(expr, data)
        parsed = json.loads(result)
        assert parsed["name"] == "Alice"
        assert parsed["age"] == 30

    def test_serialize_array(self):
        """Test serializing arrays."""
        source = make_source()
        data = {"items": [1, 2, 3]}
        expr = Expression(source, "items")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(expr, data)
        parsed = json.loads(result)
        assert parsed == [1, 2, 3]

    def test_serialize_with_pretty_printing(self):
        """Test pretty-printed JSON output."""
        source = make_source()
        data = {"items": [1, 2]}
        expr = Expression(source, "items")
        serializer = JSONSerializer(pretty=True)
        result = serializer.serialize(expr, data)
        # Check that it's valid JSON
        parsed = json.loads(result)
        assert parsed == [1, 2]
        # Check that indentation is present (pretty)
        assert "\n" in result

    def test_serialize_null_value(self):
        """Test serializing null values."""
        source = make_source()
        expr = Expression(source, "missing")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(expr, {})
        assert result == "null"

    def test_serialize_if_block_true(self):
        """Test if block with true condition."""
        source = make_source()
        body = Block([Text(source, "yes")])
        else_body = Block([Text(source, "no")])
        if_node = If(source, "flag", body, else_body=else_body)

        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(if_node, {"flag": True})
        assert result == '"yes"'

    def test_serialize_if_block_false(self):
        """Test if block with false condition."""
        source = make_source()
        body = Block([Text(source, "yes")])
        else_body = Block([Text(source, "no")])
        if_node = If(source, "flag", body, else_body=else_body)

        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(if_node, {"flag": False})
        assert result == '"no"'

    def test_serialize_for_loop(self):
        """Test for loop serialization."""
        source = make_source()
        body = Block([Expression(source, "item")])
        for_node = For(source, "item", "items", body)

        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(for_node, {"items": [1, 2, 3]})
        parsed = json.loads(result)
        assert parsed == [1, 2, 3]

    def test_serialize_string_escaping(self):
        """Test that special characters are properly escaped."""
        source = make_source()
        expr = Expression(source, "text")
        serializer = JSONSerializer(pretty=False)
        result = serializer.serialize(expr, {"text": 'hello "world"'})
        # Should be properly quoted and escaped
        parsed = json.loads(result)
        assert parsed == 'hello "world"'

    def test_json_safe_conversion(self):
        """Test JSON-safe type conversion."""
        from datetime import datetime

        serializer = JSONSerializer()

        # Date conversion
        date_val = datetime(2026, 1, 9)
        safe = serializer._make_json_safe(date_val)
        assert safe == "2026-01-09T00:00:00"

        # Bytes conversion
        bytes_val = b"hello"
        safe = serializer._make_json_safe(bytes_val)
        assert safe == "hello"

        # Nested structures
        nested = {"list": [1, 2], "date": date_val}
        safe = serializer._make_json_safe(nested)
        assert safe["list"] == [1, 2]
        assert isinstance(safe["date"], str)


class TestJSONSerializerErrors:
    """Test error handling in JSON serializer."""

    def test_undefined_variable_strict_mode(self):
        """Test that undefined variables raise error in strict mode."""
        from temple.compiler.serializers.base import SerializationError

        source = make_source()
        expr = Expression(source, "missing")
        serializer = JSONSerializer(strict=True)

        with pytest.raises(SerializationError):
            serializer.serialize(expr, {})

    def test_invalid_loop_strict_mode(self):
        """Test that non-iterable in for loop raises error in strict mode."""
        from temple.compiler.serializers.base import SerializationError

        source = make_source()
        body = Block([Text(source, "item")])
        for_node = For(source, "item", "count", body)
        serializer = JSONSerializer(strict=True)

        with pytest.raises(SerializationError):
            serializer.serialize(for_node, {"count": 42})


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
