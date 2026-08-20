"""
Tests for the type system.
"""

from temple.compiler.types import (
    StringType,
    NumberType,
    BooleanType,
    NullType,
    ArrayType,
    ObjectType,
    TupleType,
    UnionType,
    AnyType,
    optional,
    infer_type_from_value,
)


class TestScalarTypes:
    """Test scalar type validation."""

    def test_string_type_valid(self):
        string_type = StringType()
        assert string_type.validate_value("hello") == (True, None)

    def test_string_type_invalid(self):
        string_type = StringType()
        is_valid, error = string_type.validate_value(123)
        assert not is_valid
        assert "Expected string" in error

    def test_string_min_length(self):
        string_type = StringType(min_length=5)
        assert string_type.validate_value("hello") == (True, None)
        is_valid, error = string_type.validate_value("hi")
        assert not is_valid
        assert "minimum" in error

    def test_string_max_length(self):
        string_type = StringType(max_length=10)
        assert string_type.validate_value("hello") == (True, None)
        is_valid, error = string_type.validate_value("hello world!")
        assert not is_valid
        assert "maximum" in error

    def test_string_enum(self):
        string_type = StringType(enum=["red", "green", "blue"])
        assert string_type.validate_value("red") == (True, None)
        is_valid, error = string_type.validate_value("yellow")
        assert not is_valid
        assert "not in allowed values" in error

    def test_number_type_valid(self):
        number_type = NumberType()
        assert number_type.validate_value(42) == (True, None)
        assert number_type.validate_value(3.14) == (True, None)

    def test_number_type_invalid(self):
        number_type = NumberType()
        is_valid, error = number_type.validate_value("123")
        assert not is_valid
        assert "Expected number" in error

    def test_number_integer_only(self):
        number_type = NumberType(integer_only=True)
        assert number_type.validate_value(42) == (True, None)
        is_valid, error = number_type.validate_value(3.14)
        assert not is_valid
        assert "integer" in error

    def test_number_range(self):
        number_type = NumberType(minimum=0, maximum=100)
        assert number_type.validate_value(50) == (True, None)

        is_valid, error = number_type.validate_value(-1)
        assert not is_valid
        assert "minimum" in error

        is_valid, error = number_type.validate_value(101)
        assert not is_valid
        assert "maximum" in error

    def test_boolean_type(self):
        bool_type = BooleanType()
        assert bool_type.validate_value(True) == (True, None)
        assert bool_type.validate_value(False) == (True, None)

        is_valid, error = bool_type.validate_value(1)
        assert not is_valid

    def test_null_type(self):
        null_type = NullType()
        assert null_type.validate_value(None) == (True, None)

        is_valid, error = null_type.validate_value("null")
        assert not is_valid


class TestCollectionTypes:
    """Test collection type validation."""

    def test_array_type_valid(self):
        array_type = ArrayType(StringType())
        assert array_type.validate_value(["a", "b", "c"]) == (True, None)

    def test_array_type_invalid_items(self):
        array_type = ArrayType(StringType())
        is_valid, error = array_type.validate_value([1, 2, 3])
        assert not is_valid
        assert "Item at index 0" in error

    def test_array_type_mixed_invalid(self):
        array_type = ArrayType(StringType())
        is_valid, error = array_type.validate_value(["a", 2, "c"])
        assert not is_valid
        assert "Item at index 1" in error

    def test_array_min_items(self):
        array_type = ArrayType(AnyType(), min_items=2)
        assert array_type.validate_value([1, 2, 3]) == (True, None)

        is_valid, error = array_type.validate_value([1])
        assert not is_valid
        assert "minimum" in error

    def test_object_type_valid(self):
        obj_type = ObjectType(
            properties={"name": StringType(), "age": NumberType()},
            required={"name", "age"},
        )
        assert obj_type.validate_value({"name": "Alice", "age": 30}) == (True, None)

    def test_object_missing_required(self):
        obj_type = ObjectType(
            properties={"name": StringType(), "age": NumberType()},
            required={"name", "age"},
        )
        is_valid, error = obj_type.validate_value({"name": "Alice"})
        assert not is_valid
        assert "Missing required property 'age'" in error

    def test_object_additional_properties_false(self):
        obj_type = ObjectType(
            properties={"name": StringType()},
            required=set(),
            additional_properties=False,
        )
        is_valid, error = obj_type.validate_value({"name": "Alice", "age": 30})
        assert not is_valid
        assert "Additional property 'age' not allowed" in error

    def test_object_additional_properties_typed(self):
        obj_type = ObjectType(
            properties={"name": StringType()},
            required=set(),
            additional_properties=NumberType(),
        )
        assert obj_type.validate_value({"name": "Alice", "age": 30}) == (True, None)

        is_valid, error = obj_type.validate_value({"name": "Alice", "age": "thirty"})
        assert not is_valid

    def test_tuple_type_valid(self):
        tuple_type = TupleType([StringType(), NumberType(), BooleanType()])
        assert tuple_type.validate_value(["hello", 42, True]) == (True, None)

    def test_tuple_type_wrong_length(self):
        tuple_type = TupleType([StringType(), NumberType()])
        is_valid, error = tuple_type.validate_value(["hello"])
        assert not is_valid
        assert "length" in error

    def test_tuple_type_wrong_types(self):
        tuple_type = TupleType([StringType(), NumberType()])
        is_valid, error = tuple_type.validate_value([123, "hello"])
        assert not is_valid
        assert "Item at index 0" in error


class TestUnionTypes:
    """Test union type validation."""

    def test_union_type_valid(self):
        union = UnionType([StringType(), NumberType()])
        assert union.validate_value("hello") == (True, None)
        assert union.validate_value(42) == (True, None)

    def test_union_type_invalid(self):
        union = UnionType([StringType(), NumberType()])
        is_valid, error = union.validate_value([])  # List not in union
        assert not is_valid
        assert "does not match any union type" in error

    def test_optional_type(self):
        opt_string = optional(StringType())
        assert opt_string.validate_value("hello") == (True, None)
        assert opt_string.validate_value(None) == (True, None)

        is_valid, error = opt_string.validate_value(123)
        assert not is_valid


class TestTypeInference:
    """Test type inference from values."""

    def test_infer_scalar_types(self):
        assert isinstance(infer_type_from_value(None), NullType)
        assert isinstance(infer_type_from_value(True), BooleanType)
        assert isinstance(infer_type_from_value(42), NumberType)
        assert isinstance(infer_type_from_value(3.14), NumberType)
        assert isinstance(infer_type_from_value("hello"), StringType)

    def test_infer_array_type(self):
        inferred = infer_type_from_value([1, 2, 3])
        assert isinstance(inferred, ArrayType)
        assert isinstance(inferred.item_type, NumberType)

    def test_infer_object_type(self):
        inferred = infer_type_from_value({"name": "Alice", "age": 30})
        assert isinstance(inferred, ObjectType)
        assert "name" in inferred.properties
        assert "age" in inferred.properties
        assert isinstance(inferred.properties["name"], StringType)
        assert isinstance(inferred.properties["age"], NumberType)

    def test_infer_nested_object(self):
        data = {"user": {"name": "Alice", "settings": {"theme": "dark"}}}
        inferred = infer_type_from_value(data)
        assert isinstance(inferred, ObjectType)
        assert "user" in inferred.properties
        user_type = inferred.properties["user"]
        assert isinstance(user_type, ObjectType)


class TestTypeCompatibility:
    """Test type compatibility checking."""

    def test_same_scalar_types_compatible(self):
        assert StringType().is_compatible_with(StringType())
        assert NumberType().is_compatible_with(NumberType())

    def test_different_scalar_types_incompatible(self):
        assert not StringType().is_compatible_with(NumberType())
        assert not NumberType().is_compatible_with(BooleanType())

    def test_any_type_compatible_with_all(self):
        any_type = AnyType()
        assert any_type.is_compatible_with(StringType())
        assert any_type.is_compatible_with(NumberType())
        assert any_type.is_compatible_with(ArrayType(AnyType()))

    def test_array_compatibility(self):
        arr1 = ArrayType(StringType())
        arr2 = ArrayType(StringType())
        assert arr1.is_compatible_with(arr2)

        arr3 = ArrayType(NumberType())
        assert not arr1.is_compatible_with(arr3)


class TestSchemaGeneration:
    """Test conversion to JSON Schema."""

    def test_string_schema(self):
        string_type = StringType(min_length=1, max_length=100)
        schema = string_type.to_schema()
        assert schema["type"] == "string"
        assert schema["minLength"] == 1
        assert schema["maxLength"] == 100

    def test_number_schema(self):
        number_type = NumberType(integer_only=True, minimum=0, maximum=100)
        schema = number_type.to_schema()
        assert schema["type"] == "integer"
        assert schema["minimum"] == 0
        assert schema["maximum"] == 100

    def test_array_schema(self):
        array_type = ArrayType(StringType(), min_items=1)
        schema = array_type.to_schema()
        assert schema["type"] == "array"
        assert schema["items"]["type"] == "string"
        assert schema["minItems"] == 1

    def test_object_schema(self):
        obj_type = ObjectType(
            properties={"name": StringType(), "age": NumberType()}, required={"name"}
        )
        schema = obj_type.to_schema()
        assert schema["type"] == "object"
        assert "name" in schema["properties"]
        assert "age" in schema["properties"]
        assert "name" in schema["required"]

    def test_union_schema(self):
        union_type = UnionType([StringType(), NumberType()])
        schema = union_type.to_schema()
        assert "anyOf" in schema
        assert len(schema["anyOf"]) == 2
