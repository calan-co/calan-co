"""
temple.compiler.types
Type system for typed templates.

Defines base types, collections, unions, constraints, and type inference.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Union, Any, Dict, List, Set
from enum import Enum


class TypeKind(Enum):
    """Enumeration of type kinds in the type system."""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    NULL = "null"
    ARRAY = "array"
    OBJECT = "object"
    TUPLE = "tuple"
    UNION = "union"
    REFERENCE = "reference"
    ANY = "any"


@dataclass
class BaseType(ABC):
    """Abstract base class for all types."""

    @abstractmethod
    def is_compatible_with(self, other: "BaseType") -> bool:
        """Check if this type is compatible with another type."""
        pass

    @abstractmethod
    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value against this type.

        Returns:
            (is_valid, error_message)
        """
        pass

    @abstractmethod
    def to_schema(self) -> Dict[str, Any]:
        """Convert type to JSON Schema representation."""
        pass


@dataclass
class StringType(BaseType):
    """String type with optional constraints."""

    min_length: Optional[int] = None
    max_length: Optional[int] = None
    pattern: Optional[str] = None
    enum: Optional[List[str]] = None
    format: Optional[str] = None  # e.g., "date", "email", "uri"

    def is_compatible_with(self, other: BaseType) -> bool:
        """Strings are compatible with other strings (constraints checked separately)."""
        return isinstance(other, StringType) or isinstance(other, AnyType)

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is a string meeting constraints."""
        if not isinstance(value, str):
            return False, f"Expected string, got {type(value).__name__}"

        if self.min_length is not None and len(value) < self.min_length:
            return (
                False,
                f"String length {len(value)} is less than minimum {self.min_length}",
            )

        if self.max_length is not None and len(value) > self.max_length:
            return (
                False,
                f"String length {len(value)} exceeds maximum {self.max_length}",
            )

        if self.enum is not None and value not in self.enum:
            return False, f"Value '{value}' not in allowed values: {self.enum}"

        # Pattern and format validation would go here

        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        schema = {"type": "string"}
        if self.min_length is not None:
            schema["minLength"] = self.min_length
        if self.max_length is not None:
            schema["maxLength"] = self.max_length
        if self.pattern is not None:
            schema["pattern"] = self.pattern
        if self.enum is not None:
            schema["enum"] = self.enum
        if self.format is not None:
            schema["format"] = self.format
        return schema


@dataclass
class NumberType(BaseType):
    """Number type (int or float) with optional constraints."""

    integer_only: bool = False
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    exclusive_minimum: Optional[float] = None
    exclusive_maximum: Optional[float] = None
    multiple_of: Optional[float] = None

    def is_compatible_with(self, other: BaseType) -> bool:
        """Numbers are compatible with other numbers."""
        return isinstance(other, NumberType) or isinstance(other, AnyType)

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is a number meeting constraints."""
        if not isinstance(value, (int, float)):
            return False, f"Expected number, got {type(value).__name__}"

        if self.integer_only and not isinstance(value, int):
            return False, "Expected integer, got float"

        if self.minimum is not None and value < self.minimum:
            return False, f"Value {value} is less than minimum {self.minimum}"

        if self.maximum is not None and value > self.maximum:
            return False, f"Value {value} exceeds maximum {self.maximum}"

        if self.exclusive_minimum is not None and value <= self.exclusive_minimum:
            return False, f"Value {value} must be greater than {self.exclusive_minimum}"

        if self.exclusive_maximum is not None and value >= self.exclusive_maximum:
            return False, f"Value {value} must be less than {self.exclusive_maximum}"

        if self.multiple_of is not None and value % self.multiple_of != 0:
            return False, f"Value {value} is not a multiple of {self.multiple_of}"

        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        schema = {"type": "integer" if self.integer_only else "number"}
        if self.minimum is not None:
            schema["minimum"] = self.minimum
        if self.maximum is not None:
            schema["maximum"] = self.maximum
        if self.exclusive_minimum is not None:
            schema["exclusiveMinimum"] = self.exclusive_minimum
        if self.exclusive_maximum is not None:
            schema["exclusiveMaximum"] = self.exclusive_maximum
        if self.multiple_of is not None:
            schema["multipleOf"] = self.multiple_of
        return schema


@dataclass
class BooleanType(BaseType):
    """Boolean type."""

    def is_compatible_with(self, other: BaseType) -> bool:
        """Booleans are compatible with other booleans."""
        return isinstance(other, BooleanType) or isinstance(other, AnyType)

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is a boolean."""
        if not isinstance(value, bool):
            return False, f"Expected boolean, got {type(value).__name__}"
        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        return {"type": "boolean"}


@dataclass
class NullType(BaseType):
    """Null/None type."""

    def is_compatible_with(self, other: BaseType) -> bool:
        """Null is compatible with other nulls and optional types."""
        return isinstance(other, NullType) or isinstance(other, AnyType)

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is None."""
        if value is not None:
            return False, f"Expected null, got {type(value).__name__}"
        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        return {"type": "null"}


@dataclass
class ArrayType(BaseType):
    """Array/list type with item type and constraints."""

    item_type: BaseType
    min_items: Optional[int] = None
    max_items: Optional[int] = None
    unique_items: bool = False

    def is_compatible_with(self, other: BaseType) -> bool:
        """Arrays are compatible if item types are compatible."""
        if isinstance(other, AnyType):
            return True
        if not isinstance(other, ArrayType):
            return False
        return self.item_type.is_compatible_with(other.item_type)

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is an array meeting constraints."""
        if not isinstance(value, list):
            return False, f"Expected array, got {type(value).__name__}"

        if self.min_items is not None and len(value) < self.min_items:
            return (
                False,
                f"Array length {len(value)} is less than minimum {self.min_items}",
            )

        if self.max_items is not None and len(value) > self.max_items:
            return False, f"Array length {len(value)} exceeds maximum {self.max_items}"

        if self.unique_items and len(value) != len(set(str(v) for v in value)):
            return False, "Array items must be unique"

        # Validate each item
        for i, item in enumerate(value):
            is_valid, error = self.item_type.validate_value(item)
            if not is_valid:
                return False, f"Item at index {i}: {error}"

        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        schema = {"type": "array", "items": self.item_type.to_schema()}
        if self.min_items is not None:
            schema["minItems"] = self.min_items
        if self.max_items is not None:
            schema["maxItems"] = self.max_items
        if self.unique_items:
            schema["uniqueItems"] = True
        return schema


@dataclass
class ObjectType(BaseType):
    """Object/dict type with property types and constraints."""

    properties: Dict[str, BaseType] = field(default_factory=dict)
    required: Set[str] = field(default_factory=set)
    additional_properties: Union[bool, BaseType] = False
    min_properties: Optional[int] = None
    max_properties: Optional[int] = None

    def is_compatible_with(self, other: BaseType) -> bool:
        """Objects are compatible if all required properties are compatible."""
        if isinstance(other, AnyType):
            return True
        if not isinstance(other, ObjectType):
            return False

        # Check that all required properties in other are present and compatible
        for prop_name in other.required:
            if prop_name not in self.properties:
                return False
            if not self.properties[prop_name].is_compatible_with(
                other.properties[prop_name]
            ):
                return False

        return True

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is an object meeting constraints."""
        if not isinstance(value, dict):
            return False, f"Expected object, got {type(value).__name__}"

        # Check required properties
        for prop_name in self.required:
            if prop_name not in value:
                return False, f"Missing required property '{prop_name}'"

        # Check min/max properties
        if self.min_properties is not None and len(value) < self.min_properties:
            return (
                False,
                f"Object has {len(value)} properties, minimum is {self.min_properties}",
            )

        if self.max_properties is not None and len(value) > self.max_properties:
            return (
                False,
                f"Object has {len(value)} properties, maximum is {self.max_properties}",
            )

        # Validate each property
        for prop_name, prop_value in value.items():
            if prop_name in self.properties:
                is_valid, error = self.properties[prop_name].validate_value(prop_value)
                if not is_valid:
                    return False, f"Property '{prop_name}': {error}"
            elif self.additional_properties is False:
                return False, f"Additional property '{prop_name}' not allowed"
            elif isinstance(self.additional_properties, BaseType):
                is_valid, error = self.additional_properties.validate_value(prop_value)
                if not is_valid:
                    return False, f"Additional property '{prop_name}': {error}"

        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        schema = {
            "type": "object",
            "properties": {k: v.to_schema() for k, v in self.properties.items()},
        }
        if self.required:
            schema["required"] = list(self.required)
        if isinstance(self.additional_properties, bool):
            schema["additionalProperties"] = self.additional_properties
        elif isinstance(self.additional_properties, BaseType):
            schema["additionalProperties"] = self.additional_properties.to_schema()
        if self.min_properties is not None:
            schema["minProperties"] = self.min_properties
        if self.max_properties is not None:
            schema["maxProperties"] = self.max_properties
        return schema


@dataclass
class TupleType(BaseType):
    """Tuple type with fixed-size array of specific types."""

    item_types: List[BaseType]

    def is_compatible_with(self, other: BaseType) -> bool:
        """Tuples are compatible if same length and all item types compatible."""
        if isinstance(other, AnyType):
            return True
        if not isinstance(other, TupleType):
            return False
        if len(self.item_types) != len(other.item_types):
            return False
        return all(
            t1.is_compatible_with(t2)
            for t1, t2 in zip(self.item_types, other.item_types)
        )

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value is a tuple with correct types."""
        if not isinstance(value, (list, tuple)):
            return False, f"Expected tuple, got {type(value).__name__}"

        if len(value) != len(self.item_types):
            return (
                False,
                f"Expected tuple of length {len(self.item_types)}, got {len(value)}",
            )

        for i, (item, item_type) in enumerate(zip(value, self.item_types)):
            is_valid, error = item_type.validate_value(item)
            if not is_valid:
                return False, f"Item at index {i}: {error}"

        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        return {
            "type": "array",
            "items": [t.to_schema() for t in self.item_types],
            "minItems": len(self.item_types),
            "maxItems": len(self.item_types),
        }


@dataclass
class UnionType(BaseType):
    """Union type (value can be any of several types)."""

    types: List[BaseType]

    def is_compatible_with(self, other: BaseType) -> bool:
        """Union is compatible if any member type is compatible."""
        if isinstance(other, AnyType):
            return True
        return any(t.is_compatible_with(other) for t in self.types)

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value matches at least one union member."""
        errors = []
        for type_option in self.types:
            is_valid, error = type_option.validate_value(value)
            if is_valid:
                return True, None
            errors.append(error)

        return False, f"Value does not match any union type: {'; '.join(errors)}"

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        return {"anyOf": [t.to_schema() for t in self.types]}


@dataclass
class ReferenceType(BaseType):
    """Reference to a named type definition."""

    name: str

    def is_compatible_with(self, other: BaseType) -> bool:
        """References need to be resolved before compatibility check."""
        if isinstance(other, AnyType):
            return True
        if isinstance(other, ReferenceType):
            return self.name == other.name
        return False

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """References must be resolved before validation."""
        return False, f"Cannot validate unresolved reference '{self.name}'"

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        return {"$ref": f"#/definitions/{self.name}"}


@dataclass
class AnyType(BaseType):
    """Any type (no constraints)."""

    def is_compatible_with(self, other: BaseType) -> bool:
        """Any is compatible with everything."""
        return True

    def validate_value(self, value: Any) -> tuple[bool, Optional[str]]:
        """Any accepts all values."""
        return True, None

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        return {}


def optional(type_: BaseType) -> UnionType:
    """Create an optional type (union with null)."""
    return UnionType([type_, NullType()])


def infer_type_from_value(value: Any) -> BaseType:
    """Infer a type from a runtime value."""
    if value is None:
        return NullType()
    elif isinstance(value, bool):
        return BooleanType()
    elif isinstance(value, int):
        return NumberType(integer_only=True)
    elif isinstance(value, float):
        return NumberType()
    elif isinstance(value, str):
        return StringType()
    elif isinstance(value, list):
        if not value:
            return ArrayType(AnyType())
        # Infer item type from first element
        item_type = infer_type_from_value(value[0])
        return ArrayType(item_type)
    elif isinstance(value, dict):
        properties = {k: infer_type_from_value(v) for k, v in value.items()}
        return ObjectType(properties=properties, required=set(value.keys()))
    else:
        return AnyType()
