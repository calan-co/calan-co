"""
Tests for the type checker.
"""

from temple.compiler.schema import object_schema
from temple.compiler.type_checker import TypeChecker, TypeEnvironment
from temple.compiler.types import NumberType, StringType
from temple.diagnostics import Position, SourceRange
from temple.typed_ast import Block, Expression, For, If, Text


class TestTypeEnvironment:
    """Test type environment."""

    def test_bind_and_lookup(self):
        env = TypeEnvironment()
        env.bind("x", StringType())

        result = env.lookup("x")
        assert isinstance(result, StringType)

    def test_lookup_parent_scope(self):
        parent = TypeEnvironment()
        parent.bind("x", StringType())

        child = parent.child_scope()
        result = child.lookup("x")
        assert isinstance(result, StringType)

    def test_child_scope_shadowing(self):
        parent = TypeEnvironment()
        parent.bind("x", StringType())

        child = parent.child_scope()
        child.bind("x", NumberType())

        result = child.lookup("x")
        assert isinstance(result, NumberType)


class TestTypeCheckerBasics:
    """Test basic type checking."""

    def test_check_text_node(self):
        checker = TypeChecker()
        sr = SourceRange(Position(0, 0), Position(0, 0))
        node = Text(sr, "hello")

        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_check_valid_expression(self):
        data = {"name": "Alice"}
        checker = TypeChecker(data=data)

        sr = SourceRange(Position(0, 0), Position(0, 0))
        node = Expression(sr, "name")
        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_check_undefined_variable(self):
        checker = TypeChecker(data={})

        sr = SourceRange(Position(0, 0), Position(0, 0))
        node = Expression(sr, "undefined")
        assert not checker.check(node)
        assert checker.errors.has_errors()

        error = checker.errors.errors[0]
        assert error.kind == "undefined_variable"
        assert "undefined" in error.message

    def test_check_property_access(self):
        data = {"user": {"name": "Alice"}}
        checker = TypeChecker(data=data)

        sr = SourceRange(Position(0, 0), Position(0, 0))
        node = Expression(sr, "user.name")
        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_check_missing_property(self):
        data = {"user": {"name": "Alice"}}
        checker = TypeChecker(data=data)

        sr = SourceRange(Position(0, 0), Position(0, 0))
        node = Expression(sr, "user.age")
        assert not checker.check(node)
        assert checker.errors.has_errors()

        error = checker.errors.errors[0]
        assert error.kind == "missing_property"
        assert "age" in error.message


class TestTypeCheckerControlFlow:
    """Test type checking for control flow."""

    def test_check_if_statement(self):
        data = {"active": True}
        checker = TypeChecker(data=data)

        sr_block = SourceRange(Position(0, 0), Position(1, 0))
        node = If(
            sr_block,
            "active",
            Block([Text(SourceRange(Position(1, 0), Position(1, 3)), "yes")]),
            else_if_parts=[],
            else_body=None,
        )

        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_check_for_loop_with_array(self):
        data = {"items": ["a", "b", "c"]}
        checker = TypeChecker(data=data)

        node = For(
            SourceRange(Position(0, 0), Position(1, 0)),
            "item",
            "items",
            Block([Expression(SourceRange(Position(1, 0), Position(1, 4)), "item")]),
        )

        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_check_for_loop_non_array(self):
        data = {"count": 42}
        checker = TypeChecker(data=data)

        node = For(
            SourceRange(Position(0, 0), Position(1, 0)),
            "item",
            "count",
            Block([Expression(SourceRange(Position(1, 0), Position(1, 4)), "item")]),
        )

        assert not checker.check(node)
        assert checker.errors.has_errors()

        error = checker.errors.errors[0]
        assert error.kind == "type_mismatch"
        assert "iterate" in error.message.lower()

    def test_check_for_loop_variable_scope(self):
        data = {"items": [{"name": "Alice"}, {"name": "Bob"}]}
        checker = TypeChecker(data=data)

        # Loop variable should be accessible in body
        node = For(
            SourceRange(Position(0, 0), Position(1, 0)),
            "item",
            "items",
            Block([Expression(SourceRange(Position(1, 0), Position(1, 10)), "item.name")]),
        )

        assert checker.check(node)
        # Should have no errors - item.name is valid in loop scope


class TestSchemaValidation:
    """Test schema-based validation."""

    def test_validate_with_schema(self):
        schema = object_schema({"name": StringType(), "age": NumberType()})
        data = {"name": "Alice", "age": 30}

        checker = TypeChecker(schema=schema, data=data)
        node = Expression(SourceRange(Position(0, 0), Position(0, 0)), "name")

        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_schema_only_detects_missing_property(self):
        schema = object_schema({"user": object_schema({"name": StringType()}).root_type})
        checker = TypeChecker(schema=schema)
        node = Expression(SourceRange(Position(0, 0), Position(0, 0)), "user.email")

        assert not checker.check(node)
        assert checker.errors.has_errors()
        assert checker.errors.errors[0].kind == "missing_property"

    def test_schema_only_detects_non_iterable_loop_target(self):
        schema = object_schema({"user": object_schema({"name": StringType()}).root_type})
        checker = TypeChecker(schema=schema)
        node = For(
            SourceRange(Position(0, 0), Position(1, 0)),
            "item",
            "user.name",
            Block([Expression(SourceRange(Position(1, 0), Position(1, 4)), "item")]),
        )

        assert not checker.check(node)
        assert checker.errors.has_errors()
        assert checker.errors.errors[0].kind == "type_mismatch"


class TestFilterTypeChecking:
    def test_filter_pipeline_with_map_join_is_valid(self):
        checker = TypeChecker(data={"users": [{"name": "Ada"}, {"name": "Grace"}]})
        node = Expression(
            SourceRange(Position(0, 0), Position(0, 0)),
            "users | map('name') | join(', ')",
        )

        assert checker.check(node)
        assert not checker.errors.has_errors()

    def test_filter_pipeline_unknown_filter_is_reported(self):
        checker = TypeChecker(data={"users": [{"name": "Ada"}]})
        node = Expression(
            SourceRange(Position(0, 0), Position(0, 0)),
            "users | no_such_filter('name')",
        )

        assert not checker.check(node)
        assert checker.errors.has_errors()
        assert "Unknown filter" in checker.errors.errors[0].message

    def test_filter_pipeline_selectattr_requires_array_input(self):
        checker = TypeChecker(data={"user": {"name": "Ada"}})
        node = Expression(
            SourceRange(Position(0, 0), Position(0, 0)),
            "user | selectattr('active')",
        )

        assert not checker.check(node)
        assert checker.errors.has_errors()
        assert "expects an array input" in checker.errors.errors[0].message

    def test_filter_pipeline_argument_paths_are_type_checked(self):
        checker = TypeChecker(data={"users": [{"name": "Ada"}]})
        node = Expression(
            SourceRange(Position(0, 0), Position(0, 0)),
            "users | map(missing_field) | join(', ')",
        )

        assert not checker.check(node)
        assert checker.errors.has_errors()
        assert checker.errors.errors[0].kind == "undefined_variable"


class TestErrorMessages:
    """Test error message generation."""

    def test_undefined_variable_suggestion(self):
        data = {"username": "Alice"}
        checker = TypeChecker(data=data)

        # Typo: "user_name" instead of "username"
        node = Expression(SourceRange(Position(0, 0), Position(0, 0)), "user_name")
        checker.check(node)

        assert checker.errors.has_errors()
        error = checker.errors.errors[0]

        # Should suggest "username"
        assert error.suggestion is not None
        assert "username" in error.suggestion

    def test_missing_property_suggestion(self):
        data = {"user": {"username": "Alice", "email": "alice@example.com"}}
        checker = TypeChecker(data=data)

        # Typo: "user.emai" instead of "user.email"
        node = Expression(SourceRange(Position(0, 0), Position(0, 0)), "user.emai")
        checker.check(node)

        assert checker.errors.has_errors()
        error = checker.errors.errors[0]

        # Should suggest "email"
        assert error.suggestion is not None
        assert "email" in error.suggestion.lower()

    def test_error_formatting(self):
        checker = TypeChecker(data={})
        node = Expression(SourceRange(Position(0, 5), Position(0, 5)), "undefined")
        checker.check(node)

        source_text = "{{ {{ undefined }} }}"
        formatted = checker.errors.format_all(source_text)

        assert "TypeError" in formatted
        assert "undefined_variable" in formatted
        assert "line 1" in formatted
