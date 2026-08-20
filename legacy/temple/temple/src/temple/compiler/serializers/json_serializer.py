"""
temple.compiler.serializers.json_serializer
JSON output serializer for typed DSL.

Produces valid JSON respecting schema types, with proper handling of:
- Numbers (int vs float)
- Strings (escaping, unicode)
- Arrays and objects
- Null values
"""

import json
from typing import Any

from temple.compiler.serializers.base import (
    ASTNode,
    SerializationContext,
    SerializationError,
    Serializer,
)
from temple.typed_ast import Block, Expression, For, If, Include, Set, Text


class JSONSerializer(Serializer):
    """Serializer for JSON output format."""

    def serialize(self, ast: ASTNode, data: dict[str, Any]) -> str:
        """
        Serialize AST with input data to JSON string.

        Args:
            ast: Type-checked AST to serialize
            data: Input data (variables)

        Returns:
            Valid JSON string

        Raises:
            SerializationError: If output is not valid JSON-serializable
        """
        context = SerializationContext(data)

        try:
            value = self.evaluate(ast, context)

            if self.pretty:
                return json.dumps(value, indent=2, ensure_ascii=False)
            else:
                return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        except (TypeError, ValueError) as e:
            raise SerializationError(
                f"JSON serialization error: {str(e)}", ast.source_range
            )

    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """
        Evaluate AST node to Python value suitable for JSON encoding.

        Args:
            node: AST node
                    return node.text

        Returns:
                    value = context.get_variable(node.expr)

        Raises:
            SerializationError: If evaluation fails
        """
        if isinstance(node, Text):
            return node.text

        elif isinstance(node, Expression):
            value = context.get_variable(node.expr)
            if value is None:
                if self.strict:
                    raise SerializationError(
                        f"Undefined variable: {node.expr}", node.source_range
                    )
                return None
            return self._make_json_safe(value)

        elif isinstance(node, If):
            condition = context.get_variable(node.condition)
            if condition:
                return self._evaluate_block(node.body.nodes, context)
            elif node.else_body:
                return self._evaluate_block(node.else_body.nodes, context)
            return None

        elif isinstance(node, For):
            iterable = context.get_variable(node.iterable)
            if not isinstance(iterable, (list, tuple)):
                if self.strict:
                    raise SerializationError(
                        f"For loop requires iterable, got {type(iterable).__name__}",
                        node.source_range,
                    )
                return []

            results = []
            for item in iterable:
                context.push_scope({node.var: item, **context.scope_mapping()})
                result = self._evaluate_block(node.body.nodes, context)
                context.pop_scope()

                if result is not None:
                    results.append(result)

            return results

        elif isinstance(node, Block):
            return self._evaluate_block(node.nodes, context)

        elif isinstance(node, Include):
            return None

        elif isinstance(node, Set):
            context.set_variable(node.name, context.get_variable(node.expr))
            return None

        else:
            return None

    def format_value(self, value: Any) -> str:
        """Format value as JSON string."""
        return json.dumps(value, indent=2 if self.pretty else None)

    def _evaluate_block(
        self, children: list[ASTNode], context: SerializationContext
    ) -> Any:
        """
        Evaluate a block of nodes, combining results.

        For JSON, blocks typically produce objects or arrays depending on context.
        """
        if not children:
            return None

        # If single child, return its evaluation
        if len(children) == 1:
            return self.evaluate(children[0], context)

        # Multiple children: try to combine as array
        results = []
        for child in children:
            result = self.evaluate(child, context)
            if result is not None:
                results.append(result)

        return results if results else None

    def _make_json_safe(self, value: Any) -> Any:
        """
        Convert value to JSON-safe representation.

        Handles:
        - Dates/datetimes → ISO 8601 strings
        - Custom objects → string representation
        - Bytes → UTF-8 strings
        """
        if value is None or isinstance(value, (bool, int, float, str)):
            return value

        if isinstance(value, (list, tuple)):
            return [self._make_json_safe(v) for v in value]

        if isinstance(value, dict):
            return {k: self._make_json_safe(v) for k, v in value.items()}

        # Date/datetime handling
        if hasattr(value, "isoformat"):
            return value.isoformat()

        # Bytes
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")

        # Fallback to string
        return str(value)
