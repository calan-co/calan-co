"""
Tests for YAML serializer.
"""

import pytest
from temple.compiler.serializers.yaml_serializer import YAMLSerializer
from temple.typed_ast import Text, Expression, If, For, Block
from temple.diagnostics import Position, SourceRange


def make_source():
    """Create a dummy source range for testing."""
    return SourceRange(Position(0, 0), Position(0, 0))


class TestYAMLSerializer:
    """Test YAML serialization."""

    def test_serialize_text(self):
        """Test serializing plain text."""
        source = make_source()
        text = Text(source, "hello")
        serializer = YAMLSerializer(pretty=False)
        result = serializer.serialize(text, {})
        assert "hello" in result

    def test_serialize_expression(self):
        """Test serializing variable expressions."""
        source = make_source()
        expr = Expression(source, "name")
        serializer = YAMLSerializer(pretty=False)
        result = serializer.serialize(expr, {"name": "world"})
        assert "world" in result

    def test_serialize_if_block_true(self):
        """Test if block with true condition."""
        source = make_source()
        body = Block([Text(source, "shown")])
        else_body = Block([Text(source, "hidden")])
        if_node = If(source, "show", body, else_body=else_body)

        serializer = YAMLSerializer(pretty=False)
        result = serializer.serialize(if_node, {"show": True})
        assert "shown" in result

    def test_to_yaml_null(self):
        """Test YAML null output."""
        serializer = YAMLSerializer()
        result = serializer._to_yaml(None)
        assert result == "null"

    def test_to_yaml_boolean(self):
        """Test YAML boolean output."""
        serializer = YAMLSerializer()

        result = serializer._to_yaml(True)
        assert result == "true"

        result = serializer._to_yaml(False)
        assert result == "false"

    def test_to_yaml_numbers(self):
        """Test YAML number output."""
        serializer = YAMLSerializer()

        result = serializer._to_yaml(42)
        assert result == "42"

        result = serializer._to_yaml(3.14)
        assert result == "3.14"

    def test_to_yaml_string_simple(self):
        """Test YAML simple string output."""
        serializer = YAMLSerializer()
        result = serializer._to_yaml("hello")
        assert result == "hello"

    def test_to_yaml_string_with_special_chars(self):
        """Test YAML string with special characters."""
        serializer = YAMLSerializer()
        result = serializer._to_yaml("hello: world")
        # Should be quoted
        assert "'" in result or '"' in result

    def test_to_yaml_string_with_reserved_word(self):
        """Test YAML string that is a reserved word."""
        serializer = YAMLSerializer()
        result = serializer._to_yaml("true")
        # Reserved words should be quoted
        assert "'" in result or '"' in result

    def test_quote_string_empty(self):
        """Test quoting empty string."""
        serializer = YAMLSerializer()
        result = serializer._quote_string("")
        assert result == "''"

    def test_quote_string_with_single_quotes(self):
        """Test quoting string containing single quotes."""
        serializer = YAMLSerializer()
        result = serializer._quote_string("it's")
        # String with apostrophe is not a special YAML char, so it's not quoted
        assert result == "it's"

        # Test with special YAML char
        result2 = serializer._quote_string("it's:thing")
        assert "'" in result2 or '"' in result2

    def test_dict_to_yaml_block_style(self):
        """Test dictionary to YAML (block style)."""
        serializer = YAMLSerializer(flow_style=False)
        data = {"name": "Alice", "age": 30}
        result = serializer._dict_to_yaml(data, 0)
        assert "name: Alice" in result
        assert "age: 30" in result

    def test_dict_to_yaml_flow_style(self):
        """Test dictionary to YAML (flow style)."""
        serializer = YAMLSerializer(flow_style=True)
        data = {"name": "Alice", "age": 30}
        result = serializer._dict_to_yaml(data, 0)
        assert "{" in result and "}" in result

    def test_list_to_yaml_block_style(self):
        """Test list to YAML (block style)."""
        serializer = YAMLSerializer(flow_style=False)
        data = ["first", "second", "third"]
        result = serializer._list_to_yaml(data, 0)
        assert "- first" in result
        assert "- second" in result

    def test_list_to_yaml_flow_style(self):
        """Test list to YAML (flow style)."""
        serializer = YAMLSerializer(flow_style=True)
        data = ["a", "b", "c"]
        result = serializer._list_to_yaml(data, 0)
        assert "[" in result and "]" in result

    def test_nested_structure(self):
        """Test serializing nested structures."""
        serializer = YAMLSerializer(flow_style=False)
        data = {"user": {"name": "Bob", "items": [1, 2, 3]}}
        result = serializer._to_yaml(data)
        assert "user:" in result
        assert "name: Bob" in result
        assert "items:" in result


class TestYAMLSerializerEdgeCases:
    """Test edge cases in YAML serializer."""

    def test_empty_dict(self):
        """Test empty dictionary."""
        serializer = YAMLSerializer()
        result = serializer._dict_to_yaml({}, 0)
        assert result == "{}"

    def test_empty_list(self):
        """Test empty list."""
        serializer = YAMLSerializer()
        result = serializer._list_to_yaml([], 0)
        assert result == "[]"

    def test_for_loop_with_loop_variable(self):
        """Test for loop with loop context variable."""
        source = make_source()
        # Body that uses loop items only
        body = Block([Expression(source, "item")])
        for_node = For(source, "item", "items", body)

        serializer = YAMLSerializer(pretty=False)
        result = serializer.serialize(for_node, {"items": [10, 20]})
        # Result should contain list items
        assert "10" in result and "20" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
