"""
temple.compiler.serializers.base
Abstract serializer interface for multi-format output.

Serializers convert type-checked AST + input data into formatted output
(JSON, Markdown, HTML, YAML, etc.), respecting type annotations and producing valid output.
"""

from abc import ABC, abstractmethod
from typing import Any

from temple.compiler.types import BaseType
from temple.diagnostics import SourceRange
from temple.expression_eval import evaluate_expression

# Alias the core AST node type for type hints used in serializers.
# Importing as `ASTNode` keeps existing type hints stable and avoids
# NameError during test collection when annotations are evaluated.
from temple.typed_ast import Node as ASTNode


class SerializationError(Exception):
    """Error during serialization process."""

    def __init__(self, message: str, source_range: SourceRange | None = None):
        self.message = message
        self.source_range = source_range
        super().__init__(f"{message}" + (f" at {source_range}" if source_range else ""))


class SerializationContext:
    """Context for tracking serialization state and scope."""

    def __init__(self, data: dict[str, Any], schema: BaseType | None = None):
        """
        Initialize serialization context.

        Args:
            data: Input data to serialize against (variables)
            schema: Optional type schema for validation during serialization
        """
        self.data = data
        self.schema = schema
        self.variables: dict[str, Any] = {}
        self.scope_stack = [self.data]

    def get_variable(self, path: str | None) -> Any:
        """
        Get variable value by expression/path in the current scope.

        Args:
            path: Dot-notation variable path
            None to get current scope
        Returns:
            Value if found, None otherwise

        Raises:
            SerializationError: If path is invalid
        """
        value = self.scope_mapping()
        if path is None:
            return value
        return evaluate_expression(path, value)

    def scope_mapping(self) -> dict[str, Any]:
        """Return a dictionary view of the current scope with set variables."""
        current = self.current_scope
        scope = dict(current) if isinstance(current, dict) else {"value": current}
        if self.variables:
            scope.update(self.variables)
        return scope

    def set_variable(self, name: str, value: Any) -> None:
        """Persist variable assignment for subsequent expression evaluation."""
        self.variables[name] = value
        if isinstance(self.current_scope, dict):
            self.current_scope[name] = value

    def push_scope(self, data: Any) -> None:
        """Push new scope onto stack."""
        self.scope_stack.append(data)

    def pop_scope(self) -> None:
        """Pop scope from stack."""
        if len(self.scope_stack) > 1:
            self.scope_stack.pop()

    @property
    def current_scope(self) -> Any:
        """Get current scope data."""
        return self.scope_stack[-1]


class Serializer(ABC):
    """Abstract base class for format-specific serializers."""

    def __init__(self, pretty: bool = True, strict: bool = False):
        """
        Initialize serializer.

        Args:
            pretty: Enable pretty-printing/formatting
            strict: Enforce strict format validation
        """
        self.pretty = pretty
        self.strict = strict

    @abstractmethod
    def serialize(self, ast: ASTNode, data: dict[str, Any]) -> str:
        """
        Serialize AST with input data into formatted output.

        Args:
            ast: Type-checked AST to serialize
            data: Input data (variables) for template

        Returns:
            Formatted output string

        Raises:
            SerializationError: If serialization fails
        """
        pass

    @abstractmethod
    def evaluate(self, node: ASTNode, context: SerializationContext) -> Any:
        """
        Recursively evaluate AST node to produce intermediate representation.

        Args:
            node: AST node to evaluate
            context: Serialization context with current scope

        Returns:
            Evaluated value (format-specific)

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
            Formatted string for output
        """
        pass

    def _escape_special_chars(self, text: str) -> str:
        """Escape special characters for output format (override in subclasses)."""
        return text

    def _type_coerce(self, value: Any, target_type: BaseType | None) -> Any:
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

        # Basic type coercion (can be extended)
        type_name = target_type.__class__.__name__

        if type_name == "StringType" and not isinstance(value, str):
            return str(value)
        elif type_name == "NumberType" and isinstance(value, str):
            try:
                return float(value) if "." in value else int(value)
            except ValueError:
                return value
        elif type_name == "BooleanType" and isinstance(value, (int, str)):
            return bool(int(value)) if isinstance(value, str) else bool(value)

        return value
