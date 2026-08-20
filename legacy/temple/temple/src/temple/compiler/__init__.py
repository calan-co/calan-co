"""
temple.compiler
Production-grade typed DSL compiler for Temple.

This package implements:
1. Parser (via lark_parser) — item 34 ✅
2. Type system (types, schema, type_checker) — item 35 ✅
3. Diagnostics (via temple.diagnostics, source_map, error_formatter) — item 36 ✅
4. Serializers (serializers/) — item 37 ✅
"""

# AST nodes from typed_ast
from temple.typed_ast import (
    Block,
    Text,
    Expression,
    If,
    For,
    Include,
)

# Diagnostics from temple core
from temple.diagnostics import (
    Position,
    SourceRange,
)

# Parsing from lark_parser
from temple.lark_parser import parse_template, parse_with_diagnostics

# Type system
from temple.compiler.types import (
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
    optional,
    infer_type_from_value,
)
from temple.compiler.schema import (
    Schema,
    SchemaParser,
    SchemaBuilder,
    object_schema,
    array_schema,
)
from temple.compiler.type_checker import TypeChecker, TypeEnvironment
from temple.compiler.type_errors import TypeError, TypeErrorCollector
# NOTE: Avoid importing heavy or unused serializer/formatter symbols here to
# reduce top-level import side-effects and satisfy linter rules. Import these
# on-demand from their modules where they are actually used.

__all__ = [
    # Position & Source Info (from temple.diagnostics)
    "Position",
    "SourceRange",
    # AST Nodes (from temple.typed_ast)
    "Text",
    "Expression",
    "If",
    "For",
    "Include",
    "Block",
    # Parser (from temple.lark_parser)
    "parse_template",
    "parse_with_diagnostics",
    # Type System (Item 35)
    "BaseType",
    "StringType",
    "NumberType",
    "BooleanType",
    "NullType",
    "ArrayType",
    "ObjectType",
    "TupleType",
    "UnionType",
    "ReferenceType",
    "AnyType",
    "optional",
    "infer_type_from_value",
    # Schema
    "Schema",
    "SchemaParser",
    "SchemaBuilder",
    "object_schema",
    "array_schema",
    # Type Checker
    "TypeChecker",
    "TypeEnvironment",
    # Type Errors
    "TypeError",
    "TypeErrorCollector",
]
