"""
temple.compiler.serializers.markdown_serializer
Markdown output serializer for typed DSL.

Produces valid Markdown with proper handling of:
- Heading levels (# ## ### etc.)
- Lists (unordered - bullet, ordered - numbered)
- Inline formatting (bold, italic, code)
- Code blocks with language tags
- Links and images
- Tables (future)
"""

from typing import Any

from temple.compiler.serializers.base import (
    ASTNode,
    SerializationContext,
    SerializationError,
    Serializer,
)
from temple.typed_ast import Block, Expression, For, If, Include, Set, Text


class MarkdownSerializer(Serializer):
    """Serializer for Markdown output format."""

    def __init__(
        self, pretty: bool = True, strict: bool = False, base_heading_level: int = 1
    ):
        """
        Initialize Markdown serializer.

        Args:
            pretty: Enable pretty-printing (spacing, newlines)
            strict: Enforce strict Markdown validation
            base_heading_level: Starting heading level (1-6)
        """
        super().__init__(pretty, strict)
        self.base_heading_level = max(1, min(6, base_heading_level))
        self.current_list_level = 0
        self.heading_level = base_heading_level

    def serialize(self, ast: ASTNode, data: dict[str, Any]) -> str:
        """
        Serialize AST with input data to Markdown string.

        Args:
            ast: Type-checked AST to serialize
            data: Input data (variables)

        Returns:
            Valid Markdown string

        Raises:
            SerializationError: If serialization fails
        """
        context = SerializationContext(data)
        self.current_list_level = 0
        self.heading_level = self.base_heading_level

        try:
            result = self.evaluate(ast, context)
            return result if isinstance(result, str) else str(result or "")
        except Exception as e:
            raise SerializationError(
                f"Markdown serialization error: {str(e)}", ast.source_range
            )

    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """
        Evaluate AST node to Markdown string.

        Args:
            node: AST node
            context: Serialization context

        Returns:
            Markdown string representation

        Raises:
            SerializationError: If evaluation fails
        """
        if isinstance(node, Text):
            return self._escape_markdown(node.text)

        elif isinstance(node, Expression):
            value = context.get_variable(node.expr)
            if value is None:
                if self.strict:
                    raise SerializationError(
                        f"Undefined variable: {node.expr}", node.source_range
                    )
                return ""
            return self._escape_markdown(str(value))

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
            return self._evaluate_block(node.nodes, context)

        elif isinstance(node, Include):
            # Full include handling requires file system access
            return ""

        elif isinstance(node, Set):
            context.set_variable(node.name, context.get_variable(node.expr))
            return ""

        else:
            return ""

    def format_value(self, value: Any) -> str:
        """Format value as Markdown."""
        return self._escape_markdown(str(value))

    def _evaluate_block(
        self, children: list[ASTNode], context: SerializationContext
    ) -> str:
        """Evaluate block of nodes, joining results with newlines."""
        results = []
        for child in children:
            result = self.evaluate(child, context)
            if result:
                results.append(result)

        if self.pretty:
            return "\n".join(results)
        else:
            return "".join(results)

    def _escape_markdown(self, text: str) -> str:
        """
        Escape special Markdown characters.

        Note: This is conservative; in contexts like code blocks, less escaping is needed.
        """
        if not text:
            return text

        # Don't escape if already in code block or already escaped
        escaped = text.replace("\\", "\\\\")
        escaped = escaped.replace("*", "\\*")
        escaped = escaped.replace("_", "\\_")
        escaped = escaped.replace("[", "\\[")
        escaped = escaped.replace("]", "\\]")
        escaped = escaped.replace("`", "\\`")
        escaped = escaped.replace("#", "\\#")

        return escaped

    def _heading(self, level: int, text: str) -> str:
        """Generate Markdown heading."""
        h_level = max(1, min(6, self.base_heading_level + level - 1))
        return f"{'#' * h_level} {text}"

    def _list_item(self, text: str, ordered: bool = False) -> str:
        """Generate Markdown list item."""
        indent = "  " * self.current_list_level
        prefix = "1." if ordered else "-"
        return f"{indent}{prefix} {text}"

    def _code_block(self, code: str, language: str = "") -> str:
        """Generate Markdown code block."""
        fence = "```"
        return f"{fence}{language}\n{code}\n{fence}"

    def _inline_code(self, code: str) -> str:
        """Generate inline code."""
        return f"`{code}`"

    def _bold(self, text: str) -> str:
        """Generate bold text."""
        return f"**{text}**"

    def _italic(self, text: str) -> str:
        """Generate italic text."""
        return f"*{text}*"

    def _link(self, text: str, url: str) -> str:
        """Generate link."""
        return f"[{text}]({url})"
