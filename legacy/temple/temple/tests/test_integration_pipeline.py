"""
Integration tests for the typed DSL compiler pipeline.

Covers parser → type checker → serializer flows using Markdown output as a
representative end-to-end path.
"""

import pytest

from temple.typed_ast import Block
from temple.compiler.type_checker import TypeChecker
from temple.compiler.serializers.markdown_serializer import MarkdownSerializer
from temple.compiler.serializers.json_serializer import JSONSerializer
from temple.compiler.serializers.html_serializer import HTMLSerializer
from temple.compiler.serializers.yaml_serializer import YAMLSerializer
from temple.compiler.parser import TypedTemplateParser


def _make_block(nodes):
    """Wrap a list of AST nodes in a synthetic root block for serialization."""
    return Block(nodes, "root")


def test_markdown_pipeline_happy_path():
    """Parse, type check, and serialize a simple Markdown template end-to-end."""
    template = (
        "Hello {{ user.name }}\n"
        "{% for job in user.jobs %}- {{ job.title }} at {{ job.company }}\n"
        "{% end %}"
    )
    data = {
        "user": {
            "name": "Alice",
            "jobs": [
                {"title": "Engineer", "company": "Acme"},
                {"title": "Manager", "company": "Beta"},
            ],
        }
    }

    parser = TypedTemplateParser()
    ast_nodes, parse_errors = parser.parse(template)
    assert not parse_errors

    checker = TypeChecker(data=data)
    for node in ast_nodes:
        checker.check(node)
    assert not checker.errors.has_errors()

    root = _make_block(ast_nodes)
    serializer = MarkdownSerializer(pretty=False)
    output = serializer.serialize(root, data)

    expected = "Hello Alice\n- Engineer at Acme\n- Manager at Beta\n"
    assert output == expected


def test_markdown_pipeline_reports_type_errors():
    """Pipeline surfaces type errors when accessing missing data."""
    template = "Hello {{ user.missing }}"
    data = {"user": {"name": "Alice"}}

    parser = TypedTemplateParser()
    ast_nodes, parse_errors = parser.parse(template)
    assert not parse_errors

    checker = TypeChecker(data=data)
    for node in ast_nodes:
        checker.check(node)

    assert checker.errors.has_errors()
    # Verify error kind and message reference the missing property
    error = checker.errors.errors[0]
    assert error.kind == "missing_property"
    assert "missing" in error.message

    # Serialization should respect errors; strict mode raises on undefined variable
    root = _make_block(ast_nodes)
    serializer = MarkdownSerializer(pretty=False, strict=True)
    with pytest.raises(Exception):
        serializer.serialize(root, data)


def test_json_pipeline_happy_path():
    """End-to-end JSON serialization with looped titles."""
    template = "{% for job in user.jobs %}{{ job.title }}{% end %}"
    data = {
        "user": {
            "jobs": [
                {"title": "Engineer"},
                {"title": "Manager"},
            ]
        }
    }

    parser = TypedTemplateParser()
    ast_nodes, parse_errors = parser.parse(template)
    assert not parse_errors

    checker = TypeChecker(data=data)
    for node in ast_nodes:
        checker.check(node)
    assert not checker.errors.has_errors()

    root = _make_block(ast_nodes)
    serializer = JSONSerializer(pretty=False)
    output = serializer.serialize(root, data)

    assert output == '["Engineer","Manager"]'


def test_html_pipeline_happy_path():
    """End-to-end HTML serialization (escaped text)."""
    template = "Hello {{ user.name }}{% for tag in user.tags %} Tag: {{ tag }}{% end %}"
    data = {"user": {"name": "Alice", "tags": ["dev", "ops"]}}

    parser = TypedTemplateParser()
    ast_nodes, parse_errors = parser.parse(template)
    assert not parse_errors

    checker = TypeChecker(data=data)
    for node in ast_nodes:
        checker.check(node)
    assert not checker.errors.has_errors()

    root = _make_block(ast_nodes)
    serializer = HTMLSerializer(pretty=False)
    output = serializer.serialize(root, data)

    # HTML serializer escapes content; compact output with spaces
    expected = "Hello Alice Tag: dev Tag: ops"
    assert output == expected


def test_yaml_pipeline_happy_path():
    """End-to-end YAML serialization for a simple list."""
    template = "{% for job in user.jobs %}{{ job.title }}{% end %}"
    data = {
        "user": {
            "jobs": [
                {"title": "Engineer"},
                {"title": "Manager"},
            ]
        }
    }

    parser = TypedTemplateParser()
    ast_nodes, parse_errors = parser.parse(template)
    assert not parse_errors

    checker = TypeChecker(data=data)
    for node in ast_nodes:
        checker.check(node)
    assert not checker.errors.has_errors()

    root = _make_block(ast_nodes)
    serializer = YAMLSerializer(pretty=True)
    output = serializer.serialize(root, data)

    assert output == "- Engineer\n- Manager"
