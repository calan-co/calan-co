"""
temple.compiler.type_checker
Type checking and semantic analysis for typed templates.

Walks AST, assigns types, validates against schema.
"""

from typing import Any, Optional

from temple.expression_eval import extract_variable_paths, is_simple_path, parse_filter_pipeline
from temple.filter_registry import DEFAULT_FILTER_ADAPTER
from temple.typed_ast import (
    Block,
    Expression,
    For,
    FunctionCall,
    FunctionDef,
    If,
    Include,
    Set,
    Text,
)
from temple.typed_ast import (
    Node as ASTNode,
)

from .schema import Schema
from .type_errors import TypeErrorCollector, TypeErrorKind
from .types import (
    AnyType,
    ArrayType,
    BaseType,
    BooleanType,
    ObjectType,
    StringType,
    UnionType,
    infer_type_from_value,
)


class TypeEnvironment:
    """Manages variable bindings and types during type checking."""

    def __init__(self, parent: Optional["TypeEnvironment"] = None):
        self.parent = parent
        self.bindings: dict[str, BaseType] = {}

    def bind(self, name: str, type_: BaseType):
        """Bind a variable name to a type in this scope."""
        self.bindings[name] = type_

    def lookup(self, name: str) -> BaseType | None:
        """Look up a variable's type, checking parent scopes."""
        if name in self.bindings:
            return self.bindings[name]
        if self.parent:
            return self.parent.lookup(name)
        return None

    def get_all_names(self) -> list[str]:
        """Get all variable names in scope."""
        names = list(self.bindings.keys())
        if self.parent:
            names.extend(self.parent.get_all_names())
        return names

    def child_scope(self) -> "TypeEnvironment":
        """Create a child scope."""
        return TypeEnvironment(parent=self)


class TypeChecker:
    """Type checker for templates."""

    def __init__(self, schema: Schema | None = None, data: Any | None = None):
        self.schema = schema
        self.data = data
        self.errors = TypeErrorCollector()

        # Initialize root environment with data types
        self.root_env = TypeEnvironment()
        if schema is not None:
            self._initialize_schema_types(schema.root_type)
        if data is not None:
            self._initialize_data_types(data)

    def _initialize_schema_types(self, schema_type: BaseType, prefix: str = ""):
        """Initialize type environment from schema definitions."""
        if isinstance(schema_type, UnionType):
            if schema_type.types:
                self._initialize_schema_types(schema_type.types[0], prefix)
            return

        if isinstance(schema_type, ObjectType):
            if prefix:
                self.root_env.bind(prefix, schema_type)
            for key, value in schema_type.properties.items():
                var_name = f"{prefix}.{key}" if prefix else key
                self.root_env.bind(var_name, value)
                self._initialize_schema_types(value, var_name)
            return

        if isinstance(schema_type, ArrayType):
            if prefix:
                self.root_env.bind(prefix, schema_type)
            item_prefix = f"{prefix}.0" if prefix else "0"
            self._initialize_schema_types(schema_type.item_type, item_prefix)
            return

        if prefix:
            self.root_env.bind(prefix, schema_type)

    def _initialize_data_types(self, data: Any, prefix: str = ""):
        """Initialize type environment from input data."""
        if isinstance(data, dict):
            for key, value in data.items():
                var_name = f"{prefix}.{key}" if prefix else key
                inferred_type = infer_type_from_value(value)
                self.root_env.bind(var_name, inferred_type)

                # Recursively add nested properties for objects
                if isinstance(value, dict):
                    self._initialize_data_types(value, var_name)

    def check(self, ast: ASTNode) -> bool:
        """
        Type check an AST node.

        Returns:
            True if no errors, False if errors were found.
        """
        self._check_node(ast, self.root_env)
        return not self.errors.has_errors()

    def _check_node(self, node: ASTNode, env: TypeEnvironment) -> BaseType:
        """
        Check a node and return its type.

        This is the main dispatch method for type checking.
        """
        if isinstance(node, Text):
            return self._check_text(node, env)
        elif isinstance(node, Expression):
            return self._check_expression(node, env)
        elif isinstance(node, If):
            return self._check_if(node, env)
        elif isinstance(node, For):
            return self._check_for(node, env)
        elif isinstance(node, Set):
            return self._check_set(node, env)
        elif isinstance(node, Include):
            return self._check_include(node, env)
        elif isinstance(node, Block):
            return self._check_block(node, env)
        elif isinstance(node, FunctionDef):
            return self._check_function_def(node, env)
        elif isinstance(node, FunctionCall):
            return self._check_function_call(node, env)
        elif isinstance(node, list):
            # List of nodes - check each
            for child in node:
                self._check_node(child, env)
            return AnyType()
        else:
            # Unknown node type
            return AnyType()

    def _check_text(self, node: Text, env: TypeEnvironment) -> BaseType:
        """Check a text node (always valid)."""
        return StringType()

    def _check_expression(self, node: Expression, env: TypeEnvironment) -> BaseType:
        """Check an expression node."""
        expr = (node.expr or "").strip()
        if not expr:
            return AnyType()

        base_expr, filter_pipeline = parse_filter_pipeline(expr)
        if filter_pipeline:
            current_type = self._check_expression(
                Expression(source_range=node.source_range, expr=base_expr), env
            )
            for filter_call in filter_pipeline:
                arg_paths: set[str] = set()
                for arg in filter_call.args:
                    arg_paths.update(extract_variable_paths(arg))
                for path in self._most_specific_paths(arg_paths):
                    self._resolve_var_path_type(path, env, node.source_range)
                current_type = self._apply_filter_type(
                    current_type,
                    filter_name=filter_call.name,
                    arg_count=len(filter_call.args),
                    source_range=node.source_range,
                )
            return current_type

        # Literals are valid without variable lookups.
        if expr in ("true", "false", "True", "False"):
            return BooleanType()
        if (expr.startswith("'") and expr.endswith("'")) or (
            expr.startswith('"') and expr.endswith('"')
        ):
            return StringType()
        if expr.replace(".", "", 1).isdigit():
            return infer_type_from_value(float(expr) if "." in expr else int(expr))
        is_list_literal = expr.startswith("[") and expr.endswith("]")

        # Simple dotted path can preserve precise type information.
        if is_simple_path(expr):
            return self._resolve_var_path_type(expr, env, node.source_range)

        # Complex expressions: validate variable references used by operators/list literals.
        raw_paths = extract_variable_paths(expr)
        if not raw_paths:
            if is_list_literal:
                return ArrayType(AnyType())
            return AnyType()

        for path in self._most_specific_paths(raw_paths):
            self._resolve_var_path_type(path, env, node.source_range)

        if is_list_literal:
            return ArrayType(AnyType())
        if self._looks_boolean_expression(expr):
            return BooleanType()
        return AnyType()

    def _most_specific_paths(self, raw_paths: set[str]) -> list[str]:
        paths = set(raw_paths)
        for path in list(raw_paths):
            if any(other.startswith(f"{path}.") for other in raw_paths if other != path):
                paths.discard(path)
        return sorted(paths)

    def _apply_filter_type(
        self,
        input_type: BaseType,
        *,
        filter_name: str,
        arg_count: int,
        source_range,
    ) -> BaseType:
        if not DEFAULT_FILTER_ADAPTER.has_filter(filter_name):
            available = ", ".join(DEFAULT_FILTER_ADAPTER.list_names())
            self.errors.add_error(
                kind=TypeErrorKind.TYPE_MISMATCH,
                message=f"Unknown filter '{filter_name}'",
                source_range=source_range,
                expected_type=f"one of: {available}",
                actual_type=filter_name,
            )
            return AnyType()

        if filter_name in ("selectattr", "map") and arg_count < 1:
            self.errors.add_error(
                kind=TypeErrorKind.TYPE_MISMATCH,
                message=f"Filter '{filter_name}' requires at least one argument",
                source_range=source_range,
                expected_type=">= 1 filter arguments",
                actual_type=str(arg_count),
            )
            return AnyType()

        if filter_name == "default" and arg_count < 1:
            self.errors.add_error(
                kind=TypeErrorKind.TYPE_MISMATCH,
                message="Filter 'default' requires a fallback argument",
                source_range=source_range,
                expected_type=">= 1 filter arguments",
                actual_type=str(arg_count),
            )
            return AnyType()

        if filter_name in ("selectattr", "map"):
            if isinstance(input_type, ArrayType):
                if filter_name == "selectattr":
                    return input_type
                return ArrayType(AnyType())
            if isinstance(input_type, AnyType):
                return AnyType()

            self.errors.add_error(
                kind=TypeErrorKind.TYPE_MISMATCH,
                message=f"Filter '{filter_name}' expects an array input",
                source_range=source_range,
                expected_type="array",
                actual_type=type(input_type).__name__,
            )
            return AnyType()

        if filter_name == "join":
            return StringType()

        if filter_name == "default":
            return input_type

        return AnyType()

    def _resolve_var_path_type(
        self, var_path: str, env: TypeEnvironment, source_range
    ) -> BaseType:
        """Resolve a variable path and report type errors when missing/invalid."""
        if "." not in var_path:
            var_type = env.lookup(var_path)
            if var_type is None:
                self.errors.add_undefined_variable(
                    source_range=source_range,
                    var_name=var_path,
                    available_vars=env.get_all_names(),
                )
                return AnyType()
            return var_type

        parts = var_path.split(".")
        current_type = env.lookup(parts[0])
        if current_type is None:
            self.errors.add_undefined_variable(
                source_range=source_range,
                var_name=parts[0],
                available_vars=env.get_all_names(),
            )
            return AnyType()

        for i, prop in enumerate(parts[1:], 1):
            if isinstance(current_type, ObjectType):
                if prop not in current_type.properties:
                    if current_type.additional_properties is True:
                        return AnyType()
                    if isinstance(current_type.additional_properties, BaseType):
                        return current_type.additional_properties
                    self.errors.add_missing_property(
                        source_range=source_range,
                        property_name=prop,
                        object_type=".".join(parts[:i]),
                        available_properties=list(current_type.properties.keys()),
                    )
                    return AnyType()
                current_type = current_type.properties[prop]
            elif isinstance(current_type, ArrayType) and prop.isdigit():
                current_type = current_type.item_type
            elif isinstance(current_type, AnyType):
                return AnyType()
            else:
                self.errors.add_error(
                    kind=TypeErrorKind.TYPE_MISMATCH,
                    message=f"Cannot access property '{prop}' on non-object type",
                    source_range=source_range,
                    expected_type="object",
                    actual_type=type(current_type).__name__,
                )
                return AnyType()

        return current_type

    def _looks_boolean_expression(self, expr: str) -> bool:
        return (
            " and " in expr
            or " or " in expr
            or expr.startswith("not ")
            or "==" in expr
            or "!=" in expr
            or "<=" in expr
            or ">=" in expr
            or "<" in expr
            or ">" in expr
        )

    def _check_if(self, node: If, env: TypeEnvironment) -> BaseType:
        """Check an if statement."""
        # Check condition expression (result not used directly)
        self._check_expression(
            Expression(expr=node.condition, source_range=node.source_range), env
        )

        # Condition should be boolean or truthy
        # For now, accept any type (JavaScript-like truthiness)

        # Check body
        for child in self._iter_nodes(node.body):
            self._check_node(child, env)

        # Check elif parts
        for elif_cond, elif_body in node.else_if_parts:
            self._check_expression(
                Expression(expr=elif_cond, source_range=node.source_range), env
            )
            for child in self._iter_nodes(elif_body):
                self._check_node(child, env)

        # Check else body
        if node.else_body:
            for child in self._iter_nodes(node.else_body):
                self._check_node(child, env)

        return AnyType()

    def _check_for(self, node: For, env: TypeEnvironment) -> BaseType:
        """Check a for loop."""
        # Check iterable expression
        iterable_expr = Expression(expr=node.iterable, source_range=node.source_range)
        iterable_type = self._check_expression(iterable_expr, env)

        # Iterable should be an array
        if not isinstance(iterable_type, ArrayType) and not isinstance(
            iterable_type, AnyType
        ):
            self.errors.add_error(
                kind=TypeErrorKind.TYPE_MISMATCH,
                message="Cannot iterate over non-array type",
                source_range=node.source_range,
                expected_type="array",
                actual_type=type(iterable_type).__name__,
                suggestion="Use an array or check the variable type",
            )
            item_type = AnyType()
        else:
            item_type = (
                iterable_type.item_type
                if isinstance(iterable_type, ArrayType)
                else AnyType()
            )

        # Create child scope with loop variable
        loop_env = env.child_scope()
        loop_env.bind(node.var, item_type)

        # Check body in loop scope
        for child in self._iter_nodes(node.body):
            self._check_node(child, loop_env)

        return AnyType()

    def _check_set(self, node: Set, env: TypeEnvironment) -> BaseType:
        """Check a set statement and bind the variable in current scope."""
        expr_type = self._check_expression(
            Expression(source_range=node.source_range, expr=node.expr), env
        )
        env.bind(node.name, expr_type)
        return AnyType()

    def _check_include(self, node: Include, env: TypeEnvironment) -> BaseType:
        """Check an include statement."""
        # For now, just verify the path is a string
        # Full implementation would load and type-check the included template
        return AnyType()

    def _check_block(self, node: Block, env: TypeEnvironment) -> BaseType:
        """Check a block definition."""
        # Check body
        for child in self._iter_nodes(node.body):
            self._check_node(child, env)
        return AnyType()

    def _check_function_def(self, node: FunctionDef, env: TypeEnvironment) -> BaseType:
        """Check a function definition."""
        # Create child scope for function body
        func_env = env.child_scope()

        # Bind function arguments (types unknown for now)
        for arg in node.args:
            func_env.bind(arg, AnyType())

        # Check function body
        for child in self._iter_nodes(node.body):
            self._check_node(child, func_env)

        return AnyType()

    def _check_function_call(
        self, node: FunctionCall, env: TypeEnvironment
    ) -> BaseType:
        """Check a function call."""
        # Check arguments
        for arg in node.args:
            self._check_expression(
                Expression(expr=arg, source_range=node.source_range), env
            )

        return AnyType()

    def _iter_nodes(self, obj):
        """Normalize access to node lists or Block-like containers.

        Accepts: list, Block with `.nodes`, object with `.body` (list or Block), or None.
        Returns an iterable of child nodes.
        """
        if obj is None:
            return []
        if isinstance(obj, list):
            return obj
        if hasattr(obj, "nodes"):
            return getattr(obj, "nodes") or []
        if hasattr(obj, "body"):
            body = getattr(obj, "body")
            if isinstance(body, list):
                return body
            if hasattr(body, "nodes"):
                return getattr(body, "nodes") or []
        # Fallback: treat single node as a one-element list
        return [obj]

    def validate_output_schema(self, ast: ASTNode) -> bool:
        """
        Validate that the template output will match the schema.

        This is a simplified check - full implementation would
        simulate rendering to determine output structure.
        """
        if not self.schema:
            return True

        # For now, just run type checking
        return self.check(ast)
