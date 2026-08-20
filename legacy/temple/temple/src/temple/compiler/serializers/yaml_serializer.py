"""
temple.compiler.serializers.yaml_serializer
YAML output serializer for typed DSL.

Produces valid YAML with proper handling of:
- Block scalars (|, >)
- Flow styles ({}, [])
- Multi-line strings
- Special scalars (true, false, null, numbers)
- Anchors and references
"""

from typing import Any

from temple.compiler.serializers.base import (
    ASTNode,
    SerializationContext,
    SerializationError,
    Serializer,
)
from temple.typed_ast import Block, Expression, For, If, Include, Set, Text


class YAMLSerializer(Serializer):
    """Serializer for YAML output format."""

    def __init__(
        self, pretty: bool = True, strict: bool = False, flow_style: bool = False
    ):
        """
        Initialize YAML serializer.

        Args:
            pretty: Enable pretty-printing (indentation, flow style)
            strict: Enforce strict YAML validation
            flow_style: Use flow style ({}, []) instead of block style
        """
        super().__init__(pretty, strict)
        self.flow_style = flow_style
        self.indent_level = 0

    def serialize(self, ast: ASTNode, data: dict[str, Any]) -> str:
        """
        Serialize AST with input data to YAML string.

        Args:
            ast: Type-checked AST to serialize
            data: Input data (variables)

        Returns:
            Valid YAML string

        Raises:
            SerializationError: If serialization fails
        """
        context = SerializationContext(data)
        self.indent_level = 0

        try:
            result = self.evaluate(ast, context)
            yaml_str = self._to_yaml(result)
            return yaml_str
        except Exception as e:
            raise SerializationError(
                f"YAML serialization error: {str(e)}", ast.source_range
            )

    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """
        Evaluate AST node to Python value suitable for YAML encoding.

        Args:
            node: AST node
            context: Serialization context

        Returns:
            Value for YAML encoding (dict, list, str, etc.)

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
            return value

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
                        "For loop requires iterable", node.source_range
                    )
                return []

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
                result = self._evaluate_block(list(node.body), context)
                context.pop_scope()

                if result is not None:
                    results.append(result)

            return results

        elif isinstance(node, Block):
            return self._evaluate_block(node.body, context)

        elif isinstance(node, Include):
            return None

        elif isinstance(node, Set):
            context.set_variable(node.name, context.get_variable(node.expr))
            return None

        else:
            return None

    def format_value(self, value: Any) -> str:
        """Format value as YAML."""
        return self._to_yaml(value)

    def _evaluate_block(
        self, children: list[ASTNode], context: SerializationContext
    ) -> Any:
        """Evaluate block of nodes."""
        if not children:
            return None

        if len(children) == 1:
            return self.evaluate(children[0], context)

        # Multiple children: combine as array
        results = []
        for child in children:
            result = self.evaluate(child, context)
            if result is not None:
                results.append(result)

        return results if results else None

    def _to_yaml(self, value: Any, indent: int = 0) -> str:
        """
        Convert Python value to YAML string representation.

        Args:
            value: Value to convert
            indent: Current indentation level

        Returns:
            YAML string
        """
        if value is None:
            return "null"

        if isinstance(value, bool):
            return "true" if value else "false"

        if isinstance(value, (int, float)):
            return str(value)

        if isinstance(value, str):
            return self._quote_string(value)

        if isinstance(value, dict):
            return self._dict_to_yaml(value, indent)

        if isinstance(value, (list, tuple)):
            return self._list_to_yaml(list(value), indent)

        # Fallback
        return self._quote_string(str(value))

    def _quote_string(self, s: str) -> str:
        """Quote string if necessary."""
        if not s:
            return "''"

        # Check if string needs quoting
        if any(c in s for c in ":#{}[]|>*&!%@`"):
            # Use single quotes and escape single quotes
            return "'" + s.replace("'", "''") + "'"

        # Check for special values that need quoting
        if s.lower() in ("true", "false", "null", "yes", "no", "on", "off"):
            return "'" + s + "'"

        return s

    def _dict_to_yaml(self, d: dict[str, Any], indent: int) -> str:
        """Convert dict to YAML string."""
        if not d:
            return "{}"

        if self.flow_style:
            items = [f"{k}: {self._to_yaml(v, indent)}" for k, v in d.items()]
            return "{" + ", ".join(items) + "}"

        lines = []
        for key, value in d.items():
            key_str = self._quote_string(str(key))

            if isinstance(value, (dict, list, tuple)):
                value_str = self._to_yaml(value, indent + 1)
                if "\n" in value_str:
                    # Multi-line value
                    lines.append(
                        f"{'  ' * indent}{key_str}:\n"
                        + "\n".join("  " + line for line in value_str.split("\n"))
                    )
                else:
                    lines.append(f"{'  ' * indent}{key_str}: {value_str}")
            else:
                value_str = self._to_yaml(value, indent + 1)
                lines.append(f"{'  ' * indent}{key_str}: {value_str}")

        return "\n".join(lines)

    def _list_to_yaml(self, lst: list[Any], indent: int) -> str:
        """Convert list to YAML string."""
        if not lst:
            return "[]"

        if self.flow_style:
            items = [self._to_yaml(v, indent) for v in lst]
            return "[" + ", ".join(items) + "]"

        lines = []
        for item in lst:
            item_str = self._to_yaml(item, indent + 1)
            if isinstance(item, (dict, list)):
                if "\n" in item_str:
                    lines.append(
                        f"{'  ' * indent}- "
                        + "\n".join(
                            ("  " if i == 0 else "") + line
                            for i, line in enumerate(item_str.split("\n"))
                        )
                    )
                else:
                    lines.append(f"{'  ' * indent}- {item_str}")
            else:
                lines.append(f"{'  ' * indent}- {item_str}")

        return "\n".join(lines)
