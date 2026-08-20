"""
temple.compiler.schema
Schema definitions and validation.

Supports JSON Schema subset and custom schema DSL.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
import json
from .types import (
    BaseType,
    StringType,
    NumberType,
    BooleanType,
    NullType,
    ArrayType,
    ObjectType,
    TupleType,
    UnionType,
    ReferenceType,
    AnyType,
)


@dataclass
class Schema:
    """Schema definition for a template output."""

    root_type: BaseType
    definitions: Dict[str, BaseType] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def validate(self, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a value against this schema."""
        # Resolve references in root_type if needed
        resolved_type = self._resolve_references(self.root_type)
        return resolved_type.validate_value(value)

    def _resolve_references(self, type_: BaseType) -> BaseType:
        """Resolve reference types to their definitions."""
        if isinstance(type_, ReferenceType):
            if type_.name not in self.definitions:
                raise ValueError(f"Undefined type reference: {type_.name}")
            return self._resolve_references(self.definitions[type_.name])
        elif isinstance(type_, ArrayType):
            type_.item_type = self._resolve_references(type_.item_type)
        elif isinstance(type_, ObjectType):
            type_.properties = {
                k: self._resolve_references(v) for k, v in type_.properties.items()
            }
            if isinstance(type_.additional_properties, BaseType):
                type_.additional_properties = self._resolve_references(
                    type_.additional_properties
                )
        elif isinstance(type_, TupleType):
            type_.item_types = [self._resolve_references(t) for t in type_.item_types]
        elif isinstance(type_, UnionType):
            type_.types = [self._resolve_references(t) for t in type_.types]

        return type_

    def to_json_schema(self) -> Dict[str, Any]:
        """Convert schema to JSON Schema representation."""
        schema = self.root_type.to_schema()
        if self.definitions:
            schema["definitions"] = {
                name: type_.to_schema() for name, type_ in self.definitions.items()
            }
        if self.metadata:
            schema.update(self.metadata)
        return schema

    def to_json(self) -> str:
        """Convert schema to JSON string."""
        return json.dumps(self.to_json_schema(), indent=2)


class SchemaParser:
    """Parser for schema definitions."""

    @staticmethod
    def from_json_schema(schema_dict: Dict[str, Any]) -> Schema:
        """Parse a JSON Schema into internal schema representation."""
        definitions = {}
        if "definitions" in schema_dict:
            definitions = {
                name: SchemaParser._parse_type(defn)
                for name, defn in schema_dict["definitions"].items()
            }

        # Parse root type
        root_type = SchemaParser._parse_type(schema_dict)

        # Extract metadata
        metadata = {
            k: v
            for k, v in schema_dict.items()
            if k
            not in [
                "type",
                "properties",
                "items",
                "definitions",
                "required",
                "additionalProperties",
                "minItems",
                "maxItems",
                "minLength",
                "maxLength",
                "minimum",
                "maximum",
                "pattern",
                "enum",
            ]
        }

        return Schema(root_type=root_type, definitions=definitions, metadata=metadata)

    @staticmethod
    def _parse_type(schema: Dict[str, Any]) -> BaseType:
        """Parse a type from JSON Schema."""
        # Handle $ref
        if "$ref" in schema:
            ref_path = schema["$ref"]
            if ref_path.startswith("#/definitions/"):
                name = ref_path.replace("#/definitions/", "")
                return ReferenceType(name)
            raise ValueError(f"Unsupported $ref format: {ref_path}")

        # Handle anyOf (union)
        if "anyOf" in schema:
            types = [SchemaParser._parse_type(s) for s in schema["anyOf"]]
            return UnionType(types)

        # Handle oneOf (treated as union)
        if "oneOf" in schema:
            types = [SchemaParser._parse_type(s) for s in schema["oneOf"]]
            return UnionType(types)

        # Handle type
        type_name = schema.get("type")

        if type_name == "string":
            return StringType(
                min_length=schema.get("minLength"),
                max_length=schema.get("maxLength"),
                pattern=schema.get("pattern"),
                enum=schema.get("enum"),
                format=schema.get("format"),
            )

        elif type_name == "number":
            return NumberType(
                integer_only=False,
                minimum=schema.get("minimum"),
                maximum=schema.get("maximum"),
                exclusive_minimum=schema.get("exclusiveMinimum"),
                exclusive_maximum=schema.get("exclusiveMaximum"),
                multiple_of=schema.get("multipleOf"),
            )

        elif type_name == "integer":
            return NumberType(
                integer_only=True,
                minimum=schema.get("minimum"),
                maximum=schema.get("maximum"),
                exclusive_minimum=schema.get("exclusiveMinimum"),
                exclusive_maximum=schema.get("exclusiveMaximum"),
                multiple_of=schema.get("multipleOf"),
            )

        elif type_name == "boolean":
            return BooleanType()

        elif type_name == "null":
            return NullType()

        elif type_name == "array":
            items_schema = schema.get("items", {})

            # Handle tuple (array of specific types)
            if isinstance(items_schema, list):
                item_types = [SchemaParser._parse_type(s) for s in items_schema]
                return TupleType(item_types)

            # Handle regular array
            item_type = (
                SchemaParser._parse_type(items_schema) if items_schema else AnyType()
            )
            return ArrayType(
                item_type=item_type,
                min_items=schema.get("minItems"),
                max_items=schema.get("maxItems"),
                unique_items=schema.get("uniqueItems", False),
            )

        elif type_name == "object":
            properties = {}
            if "properties" in schema:
                properties = {
                    name: SchemaParser._parse_type(prop_schema)
                    for name, prop_schema in schema["properties"].items()
                }

            required = set(schema.get("required", []))

            additional_props = schema.get("additionalProperties", False)
            if isinstance(additional_props, dict):
                additional_props = SchemaParser._parse_type(additional_props)

            return ObjectType(
                properties=properties,
                required=required,
                additional_properties=additional_props,
                min_properties=schema.get("minProperties"),
                max_properties=schema.get("maxProperties"),
            )

        # No type specified - treat as any
        return AnyType()

    @staticmethod
    def from_template_comment(comment_text: str) -> Optional[Schema]:
        """Parse schema from template comment block.

        Expected format:
        {# @schema
        {
          "type": "object",
          "properties": {...}
        }
        #}
        """
        # Strip comment delimiters and @schema marker
        text = comment_text.strip()
        if not text.startswith("@schema"):
            return None

        # Extract JSON after @schema
        schema_text = text.replace("@schema", "", 1).strip()

        try:
            schema_dict = json.loads(schema_text)
            return SchemaParser.from_json_schema(schema_dict)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in schema comment: {e}")

    @staticmethod
    def from_file(file_path: str) -> Schema:
        """Load schema from a .schema or .json file."""
        with open(file_path, "r") as f:
            schema_dict = json.load(f)
        return SchemaParser.from_json_schema(schema_dict)


class SchemaBuilder:
    """Builder for constructing schemas programmatically."""

    def __init__(self):
        self.definitions: Dict[str, BaseType] = {}

    def add_definition(self, name: str, type_: BaseType) -> "SchemaBuilder":
        """Add a named type definition."""
        self.definitions[name] = type_
        return self

    def build(self, root_type: BaseType, **metadata) -> Schema:
        """Build the schema with the given root type."""
        return Schema(
            root_type=root_type, definitions=self.definitions, metadata=metadata
        )


# Common schema patterns
def object_schema(
    properties: Dict[str, BaseType], required: List[str] = None
) -> Schema:
    """Create a simple object schema."""
    return Schema(
        root_type=ObjectType(
            properties=properties, required=set(required or properties.keys())
        )
    )


def array_schema(item_type: BaseType) -> Schema:
    """Create a simple array schema."""
    return Schema(root_type=ArrayType(item_type=item_type))
