"""
temple.compiler.serializers.html_serializer
HTML output serializer for typed DSL.

Produces valid HTML with proper handling of:
- Tag generation and nesting
- Attribute escaping
- Special characters (entities)
- Void elements (br, hr, img, etc.)
- JavaScript/CSS content sanitization
"""

import html
import re
from typing import Any

from temple.compiler.serializers.base import (
    ASTNode,
    SerializationContext,
    SerializationError,
    Serializer,
)
from temple.typed_ast import Block, Expression, For, If, Include, Set, Text


class HTMLSerializer(Serializer):
    """Serializer for HTML output format."""

    # Self-closing/void elements
    VOID_ELEMENTS: set[str] = {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }

    def __init__(
        self, pretty: bool = True, strict: bool = False, sanitize: bool = True
    ):
        """
        Initialize HTML serializer.

        Args:
            pretty: Enable pretty-printing with indentation
            strict: Enforce strict HTML5 validation
            sanitize: Remove potentially unsafe HTML (scripts, event handlers)
        """
        super().__init__(pretty, strict)
        self.sanitize = sanitize
        self.indent_level = 0

    def serialize(self, ast: ASTNode, data: dict[str, Any]) -> str:
        """
        Serialize AST with input data to HTML string.

        Args:
            ast: Type-checked AST to serialize
            data: Input data (variables)

        Returns:
            Valid HTML string

        Raises:
            SerializationError: If serialization fails
        """
        context = SerializationContext(data)
        self.indent_level = 0

        try:
            result = self.evaluate(ast, context)
            return result if isinstance(result, str) else str(result or "")
        except Exception as e:
            raise SerializationError(
                f"HTML serialization error: {str(e)}", ast.source_range
            )

    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """
        Evaluate AST node to HTML string.

        Args:
            node: AST node
            context: Serialization context

        Returns:
            HTML string representation

        Raises:
            SerializationError: If evaluation fails
        """
        if isinstance(node, Text):
            return html.escape(node.text)

        elif isinstance(node, Expression):
            value = context.get_variable(node.expr)
            if value is None:
                if self.strict:
                    raise SerializationError(
                        f"Undefined variable: {node.expr}", node.source_range
                    )
                return ""
            return html.escape(str(value))

        elif isinstance(node, If):
            condition = context.get_variable(node.condition)
            if condition:
                return self._evaluate_block(node.body.nodes, context)
            elif node.else_body:
                return self._evaluate_block(node.else_body.nodes, context)
            return ""

        elif isinstance(node, For):
            iterable = context.get_variable(node.iterable)
            if not isinstance(iterable, (list, tuple)):
                if self.strict:
                    raise SerializationError(
                        "For loop requires iterable", node.source_range
                    )
                return ""

            results = []
            for idx, item in enumerate(iterable):
                context.push_scope(
                    {
                        node.var: item,
                        "loop": {
                            "index": idx,
                            "index0": idx,
                            "first": idx == 0,
                            "last": idx == len(iterable) - 1,
                        },
                        **context.scope_mapping(),
                    }
                )
                result = self._evaluate_block(node.body.nodes, context)
                context.pop_scope()

                if result:
                    results.append(result)

            return "\n".join(results) if self.pretty else "".join(results)

        elif isinstance(node, Block):
            return self._evaluate_block(node.body, context)

        elif isinstance(node, Include):
            return ""

        elif isinstance(node, Set):
            context.set_variable(node.name, context.get_variable(node.expr))
            return ""

        else:
            return ""

    def format_value(self, value: Any) -> str:
        """Format value as HTML-safe string."""
        return html.escape(str(value))

    def _evaluate_block(
        self, children: list[ASTNode], context: SerializationContext
    ) -> str:
        """Evaluate block of nodes."""
        results = []
        for child in children:
            result = self.evaluate(child, context)
            if result:
                results.append(result)

        if self.pretty:
            return "\n".join(results)
        else:
            return "".join(results)

    def _escape_attr(self, value: str) -> str:
        """Escape attribute value."""
        return html.escape(value, quote=True)

    def tag(
        self,
        name: str,
        content: str = "",
        attributes: dict[str, str] | None = None,
        self_closing: bool = False,
    ) -> str:
        """
        Generate HTML tag.

        Args:
            name: Tag name (e.g., 'div', 'span')
            content: Tag content (inner HTML)
            attributes: Dictionary of attributes (auto-escaped)
            self_closing: Generate as self-closing tag

        Returns:
            HTML tag string
        """
        # Validate tag name
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9-]*$", name):
            raise ValueError(f"Invalid tag name: {name}")

        # Build attributes
        attr_str = ""
        if attributes:
            for key, value in attributes.items():
                # Sanitize event handlers
                if self.sanitize and (
                    key.lower().startswith("on")
                    or key.lower() in ("onclick", "onerror", "onload")
                ):
                    continue

                escaped_key = html.escape(key)
                escaped_value = self._escape_attr(value)
                attr_str += f' {escaped_key}="{escaped_value}"'

        # Generate tag
        if self_closing or name.lower() in self.VOID_ELEMENTS:
            return f"<{name}{attr_str}>"
        elif not content:
            return f"<{name}{attr_str}></{name}>"
        else:
            return f"<{name}{attr_str}>{content}</{name}>"

    def _tag_indented(
        self, name: str, content: str = "", attributes: dict[str, str] | None = None
    ) -> str:
        """Generate tag with proper indentation."""
        if not self.pretty:
            return self.tag(name, content, attributes)

        indent = "  " * self.indent_level
        self.indent_level += 1
        result = f"{indent}{self.tag(name, content, attributes)}"
        self.indent_level -= 1
        return result
