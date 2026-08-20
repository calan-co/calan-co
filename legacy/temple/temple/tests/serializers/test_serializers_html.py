"""
Tests for HTML serializer.
"""

import pytest
from temple.compiler.serializers.html_serializer import HTMLSerializer
from temple.typed_ast import Block, Text, Expression, If, For
from temple.diagnostics import Position, SourceRange


def make_source():
    """Create a dummy source range for testing."""
    return SourceRange(Position(0, 0), Position(0, 0))


class TestHTMLSerializer:
    """Test HTML serialization."""

    def test_serialize_text(self):
        """Test serializing plain text."""
        source = make_source()
        text = Text(source, "hello")
        serializer = HTMLSerializer(pretty=False)
        result = serializer.serialize(text, {})
        assert result == "hello"

    def test_serialize_expression(self):
        """Test serializing variable expressions."""
        source = make_source()
        expr = Expression(source, "name")
        serializer = HTMLSerializer(pretty=False)
        result = serializer.serialize(expr, {"name": "world"})
        assert result == "world"

    def test_serialize_if_block_true(self):
        """Test if block with true condition."""
        source = make_source()
        body = Block([Text(source, "shown")])
        else_body = Block([Text(source, "hidden")])
        if_node = If(source, "show", body, else_body=else_body)

        serializer = HTMLSerializer(pretty=False)
        result = serializer.serialize(if_node, {"show": True})
        assert result == "shown"

    def test_serialize_for_loop(self):
        """Test for loop serialization."""
        source = make_source()
        body = Block([Expression(source, "item"), Text(source, " ")])
        for_node = For(source, "item", "items", body)

        serializer = HTMLSerializer(pretty=False)
        result = serializer.serialize(for_node, {"items": ["x", "y"]})
        assert "x" in result and "y" in result

    def test_html_special_char_escaping(self):
        """Test that HTML special characters are escaped."""
        source = make_source()
        text = Text(source, "<script>alert('xss')</script>")
        serializer = HTMLSerializer(pretty=False)
        result = serializer.serialize(text, {})
        # Should escape HTML special chars
        assert "&lt;" in result
        assert "&gt;" in result

    def test_tag_generation_simple(self):
        """Test simple tag generation."""
        serializer = HTMLSerializer()
        tag = serializer.tag("p", "Hello world")
        assert tag == "<p>Hello world</p>"

    def test_tag_generation_with_attributes(self):
        """Test tag generation with attributes."""
        serializer = HTMLSerializer()
        tag = serializer.tag("a", "Link", {"href": "https://example.com"})
        assert "<a" in tag
        assert 'href="https://example.com"' in tag
        assert ">Link</a>" in tag

    def test_void_elements(self):
        """Test void/self-closing element generation."""
        serializer = HTMLSerializer()

        br = serializer.tag("br")
        assert br == "<br>"

        img = serializer.tag("img", attributes={"src": "image.jpg"})
        assert "<img" in img
        assert "src=" in img

    def test_attribute_escaping(self):
        """Test that attribute values are escaped."""
        serializer = HTMLSerializer()
        tag = serializer.tag("div", attributes={"data-text": 'Hello "World"'})
        assert "&quot;" in tag or '"' in tag

    def test_sanitization_removes_event_handlers(self):
        """Test that event handlers are removed in sanitization mode."""
        serializer = HTMLSerializer(sanitize=True)
        tag = serializer.tag("button", "Click", {"onclick": "alert('xss')"})
        # onclick should not be present
        assert "onclick" not in tag

    def test_sanitization_disabled(self):
        """Test that event handlers are kept when sanitization is disabled."""
        serializer = HTMLSerializer(sanitize=False)
        tag = serializer.tag("button", "Click", {"onclick": "doSomething()"})
        # onclick should be present
        assert "onclick" in tag

    def test_nested_tags(self):
        """Test generating nested HTML structure."""
        serializer = HTMLSerializer(pretty=False)
        inner = serializer.tag("strong", "important")
        outer = serializer.tag("p", inner)
        assert outer == "<p><strong>important</strong></p>"

    def test_void_element_with_attributes(self):
        """Test void element with attributes."""
        serializer = HTMLSerializer()
        input_tag = serializer.tag(
            "input",
            attributes={
                "type": "text",
                "name": "username",
                "placeholder": "Enter name",
            },
        )
        assert "<input" in input_tag
        assert 'type="text"' in input_tag
        assert 'name="username"' in input_tag


class TestHTMLSerializerErrors:
    """Test error handling in HTML serializer."""

    def test_invalid_tag_name(self):
        """Test that invalid tag names raise error."""
        serializer = HTMLSerializer()
        with pytest.raises(ValueError):
            serializer.tag("123invalid", "content")

    def test_undefined_variable_strict_mode(self):
        """Test that undefined variables raise error in strict mode."""
        from temple.compiler.serializers.base import SerializationError

        source = make_source()
        expr = Expression(source, "missing")
        serializer = HTMLSerializer(strict=True)

        with pytest.raises(SerializationError):
            serializer.serialize(expr, {})


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
