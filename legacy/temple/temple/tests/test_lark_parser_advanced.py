"""
Advanced tests for lark_parser with error handling (ported from compiler tests).
"""

from temple.diagnostics import DiagnosticSeverity
from temple.lark_parser import parse_template, parse_with_diagnostics
from temple.typed_ast import Block, Expression, For, If, Include, Text


class TestParseTemplate:
    """Test parse_template function."""

    def test_parse_plain_text(self):
        """Parse plain text (no DSL)."""
        ast = parse_template("hello world")
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        assert isinstance(ast.nodes[0], Text)
        assert ast.nodes[0].text == "hello world"

    def test_parse_expression(self):
        """Parse {{ expression }}."""
        ast = parse_template("value: {{ user.name }}")
        assert isinstance(ast, Block)
        assert len(ast.nodes) >= 2
        assert isinstance(ast.nodes[0], Text)
        assert isinstance(ast.nodes[1], Expression)
        assert ast.nodes[1].expr == "user.name"

    def test_parse_if_statement(self):
        """Parse {% if %} ... {% end %}."""
        ast = parse_template("{% if x %}yes{% end %}")
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        assert isinstance(ast.nodes[0], If)
        assert ast.nodes[0].condition == "x"
        assert len(ast.nodes[0].body.nodes) == 1
        assert isinstance(ast.nodes[0].body.nodes[0], Text)
        assert ast.nodes[0].body.nodes[0].text == "yes"

    def test_parse_if_else_if_else(self):
        """Parse {% if %} ... {% else if %} ... {% else %} ... {% end %}."""
        template = "{% if x %}a{% else if y %}b{% else %}c{% end %}"
        ast = parse_template(template)
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        if_node = ast.nodes[0]
        assert isinstance(if_node, If)
        assert if_node.condition == "x"
        assert len(if_node.else_if_parts) == 1
        assert if_node.else_if_parts[0][0] == "y"  # else if condition
        assert if_node.else_body is not None

    def test_parse_if_else_if_allows_flexible_whitespace(self):
        """Parse else-if with tabs/multiple spaces between `else` and `if`."""
        template = "{% if x %}a{% else\t  if y %}b{% end %}"
        ast = parse_template(template)
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        if_node = ast.nodes[0]
        assert isinstance(if_node, If)
        assert len(if_node.else_if_parts) == 1
        assert if_node.else_if_parts[0][0] == "y"

    def test_parse_for_loop(self):
        """Parse {% for %} ... {% end %}."""
        template = "{% for item in items %}{{ item }}{% end %}"
        ast = parse_template(template)
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        for_node = ast.nodes[0]
        assert isinstance(for_node, For)
        assert for_node.var_name == "item"
        assert for_node.iterable_expr == "items"
        assert len(for_node.body.nodes) == 1
        assert isinstance(for_node.body.nodes[0], Expression)

    def test_parse_include(self):
        """Parse {% include "path" %}."""
        template = '{% include "header.tmpl" %}'
        ast = parse_template(template)
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        include_node = ast.nodes[0]
        assert isinstance(include_node, Include)
        assert include_node.name == "header.tmpl"

    def test_parse_nested_structures(self):
        """Parse nested if/for."""
        template = "{% if show %}{% for item in list %}{{ item }}{% end %}{% end %}"
        ast = parse_template(template)
        assert isinstance(ast, Block)
        assert len(ast.nodes) == 1
        if_node = ast.nodes[0]
        assert isinstance(if_node, If)
        assert len(if_node.body.nodes) == 1
        for_node = if_node.body.nodes[0]
        assert isinstance(for_node, For)


class TestParseWithDiagnostics:
    """Test parse_with_diagnostics function."""

    def test_valid_template_no_diagnostics(self):
        """Valid template should return empty diagnostics."""
        template = "{% if x %}{{ y }}{% end %}"
        ast, diagnostics = parse_with_diagnostics(template)

        assert isinstance(ast, Block)
        assert len(diagnostics) == 0

    def test_unclosed_if_block(self):
        """Unclosed if block should generate diagnostic."""
        template = "{% if x %}{{ y }}"
        ast, diagnostics = parse_with_diagnostics(template)

        # Should return partial AST and error diagnostic
        assert len(diagnostics) > 0
        # At least one error diagnostic
        errors = [d for d in diagnostics if d.severity == DiagnosticSeverity.ERROR]
        assert len(errors) > 0

    def test_unclosed_for_block(self):
        """Unclosed for block should generate diagnostic."""
        template = "{% for x in items %}{{ x }}"
        ast, diagnostics = parse_with_diagnostics(template)

        assert len(diagnostics) > 0
        errors = [d for d in diagnostics if d.severity == DiagnosticSeverity.ERROR]
        assert len(errors) > 0

    def test_invalid_syntax(self):
        """Invalid syntax should generate diagnostic."""
        template = "{% if %}"  # Missing condition
        ast, diagnostics = parse_with_diagnostics(template)

        assert len(diagnostics) > 0

    def test_diagnostic_has_position(self):
        """Diagnostics should include source position."""
        template = "{% if x %}{{ y }}"
        ast, diagnostics = parse_with_diagnostics(template)

        if len(diagnostics) > 0:
            diag = diagnostics[0]
            assert diag.source_range is not None
            assert diag.source_range.start is not None
            assert diag.source_range.end is not None

    def test_diagnostic_has_message(self):
        """Diagnostics should include clear error message."""
        template = "{% if x %}{{ y }}"
        ast, diagnostics = parse_with_diagnostics(template)

        if len(diagnostics) > 0:
            diag = diagnostics[0]
            assert diag.message is not None
            assert len(diag.message) > 0

    def test_multiple_errors(self):
        """Multiple syntax errors should generate multiple diagnostics."""
        # This template has at least one clear error
        template = "{% if x %}{% for y in z %}"
        ast, diagnostics = parse_with_diagnostics(template)

        # Should have at least one error
        assert len(diagnostics) > 0

    def test_valid_complex_template(self):
        """Complex but valid template should parse cleanly."""
        template = """
        {% if user.active %}
            <h1>{{ user.name }}</h1>
            {% for item in user.items %}
                <li>{{ item }}</li>
            {% end %}
        {% else %}
            <p>Inactive</p>
        {% end %}
        """
        ast, diagnostics = parse_with_diagnostics(template)

        assert isinstance(ast, Block)
        assert len(diagnostics) == 0


class TestErrorRecovery:
    """Test error recovery and partial AST generation."""

    def test_returns_partial_ast_on_error(self):
        """Parser should return partial AST even on errors."""
        template = "{% if x %}"
        ast, diagnostics = parse_with_diagnostics(template)

        # Should return some AST (at minimum empty Block)
        assert ast is not None
        assert isinstance(ast, Block)

    def test_can_parse_after_error(self):
        """Parser should continue working after encountering errors."""
        template1 = "{% if x %}"
        template2 = "{% if x %}valid{% end %}"

        ast1, diag1 = parse_with_diagnostics(template1)
        ast2, diag2 = parse_with_diagnostics(template2)

        # First should have errors, second should be clean
        assert len(diag1) > 0
        assert len(diag2) == 0
        assert isinstance(ast2, Block)
