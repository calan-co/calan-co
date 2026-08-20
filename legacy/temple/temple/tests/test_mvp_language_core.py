"""MVP language-core coverage for Temple-native templates."""

from temple.compiler.type_checker import TypeChecker
from temple.lark_parser import parse_template
from temple.typed_ast import If, Set
from temple.typed_renderer import evaluate_ast


def _render(template: str, context: dict) -> str:
    root = parse_template(template)
    result = evaluate_ast(root, context)
    ir = result.ir
    if isinstance(ir, list):
        return "".join(str(item) for item in ir)
    return str(ir)


def test_parser_supports_canonical_elif() -> None:
    root = parse_template("{% if x %}a{% elif y %}b{% else %}c{% end %}")

    assert len(root.nodes) == 1
    if_node = root.nodes[0]
    assert isinstance(if_node, If)
    assert len(if_node.else_if_parts) == 1
    assert if_node.else_if_parts[0][0] == "y"


def test_set_statement_assigns_variable_for_following_nodes() -> None:
    template = "{% set greeting = user.name %}Hello {{ greeting }}"
    root = parse_template(template)

    assert isinstance(root.nodes[0], Set)
    rendered = _render(template, {"user": {"name": "Alice"}})
    assert rendered == "Hello Alice"


def test_boolean_and_comparison_expression_in_if() -> None:
    template = "{% if user.age >= 18 and user.active %}ok{% else %}no{% end %}"
    rendered = _render(template, {"user": {"age": 21, "active": True}})
    assert rendered == "ok"


def test_list_literals_work_in_for_iterable_expression() -> None:
    template = (
        "{% for name in [user.first, user.second] %}"
        "{{ name }}{% if not loop.last %}, {% end %}"
        "{% end %}"
    )
    rendered = _render(template, {"user": {"first": "Ada", "second": "Grace"}})
    assert rendered == "Ada, Grace"


def test_type_checker_handles_set_and_expression_operators() -> None:
    template = (
        "{% set ready = user.age >= 18 and user.active %}"
        "{% if ready %}approved{% else %}rejected{% end %}"
    )
    root = parse_template(template)
    checker = TypeChecker(data={"user": {"age": 30, "active": True}})

    assert checker.check(root)
    assert not checker.errors.has_errors()


def test_filter_pipeline_supports_map_and_join() -> None:
    template = "{{ users | map('name') | join(', ') }}"
    rendered = _render(template, {"users": [{"name": "Ada"}, {"name": "Grace"}]})

    assert rendered == "Ada, Grace"


def test_parser_supports_trim_delimiters_in_control_and_expression() -> None:
    template = "{%- if user.active -%}{{- user.name -}}{%- end -%}"
    rendered = _render(template, {"user": {"active": True, "name": "Ada"}})

    assert rendered == "Ada"
