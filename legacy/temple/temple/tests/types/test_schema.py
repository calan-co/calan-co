"""
Tests for schema parsing and validation.
"""

import pytest
from temple.compiler.schema import (
    SchemaParser,
    SchemaBuilder,
    object_schema,
    array_schema,
)
from temple.compiler.types import StringType, NumberType, ObjectType, ArrayType


class TestSchemaParser:
    """Test JSON Schema parsing."""

    def test_parse_simple_string_schema(self):
        schema_dict = {"type": "string"}
        schema = SchemaParser.from_json_schema(schema_dict)
        assert isinstance(schema.root_type, StringType)

    def test_parse_string_with_constraints(self):
        schema_dict = {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "^[a-z]+$",
        }
        schema = SchemaParser.from_json_schema(schema_dict)
        string_type = schema.root_type
        assert isinstance(string_type, StringType)
        assert string_type.min_length == 1
        assert string_type.max_length == 100
        assert string_type.pattern == "^[a-z]+$"

    def test_parse_number_schema(self):
        schema_dict = {"type": "number", "minimum": 0, "maximum": 100}
        schema = SchemaParser.from_json_schema(schema_dict)
        number_type = schema.root_type
        assert isinstance(number_type, NumberType)
        assert number_type.minimum == 0
        assert number_type.maximum == 100

    def test_parse_integer_schema(self):
        schema_dict = {"type": "integer"}
        schema = SchemaParser.from_json_schema(schema_dict)
        number_type = schema.root_type
        assert isinstance(number_type, NumberType)
        assert number_type.integer_only is True

    def test_parse_array_schema(self):
        schema_dict = {"type": "array", "items": {"type": "string"}, "minItems": 1}
        schema = SchemaParser.from_json_schema(schema_dict)
        array_type = schema.root_type
        assert isinstance(array_type, ArrayType)
        assert isinstance(array_type.item_type, StringType)
        assert array_type.min_items == 1

    def test_parse_object_schema(self):
        schema_dict = {
            "type": "object",
            "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
            "required": ["name"],
        }
        schema = SchemaParser.from_json_schema(schema_dict)
        obj_type = schema.root_type
        assert isinstance(obj_type, ObjectType)
        assert "name" in obj_type.properties
        assert "age" in obj_type.properties
        assert "name" in obj_type.required

    def test_parse_nested_object_schema(self):
        schema_dict = {
            "type": "object",
            "properties": {
                "user": {"type": "object", "properties": {"name": {"type": "string"}}}
            },
        }
        schema = SchemaParser.from_json_schema(schema_dict)
        obj_type = schema.root_type
        assert isinstance(obj_type, ObjectType)
        user_type = obj_type.properties["user"]
        assert isinstance(user_type, ObjectType)
        assert "name" in user_type.properties


class TestSchemaValidation:
    """Test schema validation."""

    def test_validate_simple_object(self):
        schema = object_schema({"name": StringType(), "age": NumberType()})

        is_valid, error = schema.validate({"name": "Alice", "age": 30})
        assert is_valid
        assert error is None

    def test_validate_missing_required_field(self):
        schema = object_schema({"name": StringType(), "age": NumberType()})

        is_valid, error = schema.validate({"name": "Alice"})
        assert not is_valid
        assert "age" in error

    def test_validate_array_schema(self):
        schema = array_schema(StringType())

        is_valid, error = schema.validate(["a", "b", "c"])
        assert is_valid

        is_valid, error = schema.validate([1, 2, 3])
        assert not is_valid

    def test_validate_nested_object(self):
        schema = object_schema(
            {"user": ObjectType(properties={"name": StringType()}, required={"name"})}
        )

        is_valid, error = schema.validate({"user": {"name": "Alice"}})
        assert is_valid

        is_valid, error = schema.validate({"user": {}})
        assert not is_valid


class TestSchemaBuilder:
    """Test schema builder."""

    def test_build_simple_schema(self):
        builder = SchemaBuilder()
        schema = builder.build(StringType())

        assert isinstance(schema.root_type, StringType)

    def test_build_schema_with_definitions(self):
        builder = SchemaBuilder()
        builder.add_definition(
            "Person", ObjectType(properties={"name": StringType()}, required={"name"})
        )

        schema = builder.build(ArrayType(StringType()))
        assert "Person" in schema.definitions

    def test_schema_to_json_schema(self):
        schema = object_schema({"name": StringType(), "age": NumberType()})

        json_schema = schema.to_json_schema()
        assert json_schema["type"] == "object"
        assert "name" in json_schema["properties"]
        assert "age" in json_schema["properties"]


class TestTemplateCommentSchema:
    """Test parsing schema from template comments."""

    def test_parse_schema_comment(self):
        comment = """@schema
        {
          "type": "object",
          "properties": {
            "name": {"type": "string"}
          }
        }"""

        schema = SchemaParser.from_template_comment(comment)
        assert schema is not None
        assert isinstance(schema.root_type, ObjectType)

    def test_parse_invalid_schema_comment(self):
        comment = "@schema not-json"

        with pytest.raises(ValueError, match="Invalid JSON"):
            SchemaParser.from_template_comment(comment)

    def test_non_schema_comment(self):
        comment = "This is just a regular comment"
        schema = SchemaParser.from_template_comment(comment)
        assert schema is None
