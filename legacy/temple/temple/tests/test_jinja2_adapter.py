"""Tests for the Jinja2 adapter prototype."""

import pytest

pytest.importorskip("jinja2")

from temple.adapters.jinja2_adapter import Jinja2Adapter


def test_parse_to_ir_and_list_filters() -> None:
    adapter = Jinja2Adapter()
    result = adapter.parse_to_ir("{{ users | map('name') | join(', ') }}")

    assert result.diagnostics == ()
    assert adapter.list_used_filters(result.ir) == ["map", "join"]
    assert len(result.source_map) >= 1


def test_parse_to_ir_handles_control_flow_and_set() -> None:
    adapter = Jinja2Adapter()
    template = """
{% set is_active = user.active %}
{% if is_active %}
  {% for item in items %}
    {{ item.name }}
  {% endfor %}
{% endif %}
"""
    result = adapter.parse_to_ir(template)
    typed = adapter.to_typed_block(result.ir)

    assert len(typed.nodes) >= 2


def test_parse_to_ir_reports_syntax_errors_with_range() -> None:
    adapter = Jinja2Adapter()
    result = adapter.parse_to_ir("{% if user.active %}hello")

    assert len(result.diagnostics) == 1
    diag = result.diagnostics[0]
    assert diag.code == "jinja2.syntax_error"
    assert diag.source_range.start.line >= 0


def test_semantic_diagnostics_reports_undefined_or_missing_fields() -> None:
    adapter = Jinja2Adapter()
    diagnostics = adapter.semantic_diagnostics(
        "{{ user.missing }}",
        data={"user": {"name": "Ada"}},
    )

    assert diagnostics
    assert diagnostics[0]["code"] in {"missing_property", "undefined_variable"}


def test_compare_operators_translate_to_python_syntax() -> None:
    """Regression test for work item #70: compare ops should emit ==, !=, <, <=, >, >=."""
    adapter = Jinja2Adapter()

    test_cases = [
        ("{% if user.age == 18 %}adult{% endif %}", "=="),
        ("{% if user.age != 18 %}not 18{% endif %}", "!="),
        ("{% if user.age < 18 %}minor{% endif %}", "<"),
        ("{% if user.age <= 18 %}young{% endif %}", "<="),
        ("{% if user.age > 18 %}adult{% endif %}", ">"),
        ("{% if user.age >= 18 %}adult{% endif %}", ">="),
    ]

    for template, expected_op in test_cases:
        result = adapter.parse_to_ir(template)
        assert result.diagnostics == (), f"Unexpected diagnostics for {template}"

        # Convert to typed AST to ensure semantic analysis can parse it
        typed = adapter.to_typed_block(result.ir)
        assert len(typed.nodes) >= 1

        # Verify the condition contains the correct Python operator
        if_node = typed.nodes[0]
        assert hasattr(if_node, "condition"), "Expected If node with condition"
        assert expected_op in if_node.condition, (
            f"Expected operator '{expected_op}' in condition, "
            f"got: {if_node.condition}"
        )


def test_chained_comparisons_preserve_all_operators() -> None:
    """Test that chained comparisons like 'a < b < c' work correctly."""
    adapter = Jinja2Adapter()
    result = adapter.parse_to_ir("{% if 1 < x < 10 %}in range{% endif %}")

    assert result.diagnostics == ()
    typed = adapter.to_typed_block(result.ir)
    if_node = typed.nodes[0]

    # Should have both < operators
    assert if_node.condition.count("<") == 2, (
        f"Expected 2 '<' operators in chained comparison, got: {if_node.condition}"
    )
