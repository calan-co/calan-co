from temple.lark_parser import parse_template


def test_parse_simple_expression_and_text():
    tpl = "Hello {{ user.name }}!"
    root = parse_template(tpl)
    # root should be a Block with text, expression, text
    assert len(root.nodes) == 3
    assert hasattr(root.nodes[0], "text")
    assert hasattr(root.nodes[1], "expr") or hasattr(root.nodes[1], "expr")


def test_parse_for_and_if():
    tpl = """
{% if user.active %}
Active
{% else %}
Inactive
{% end %}
{% for x in items %}
- {{ x }}
{% end %}
"""
    root = parse_template(tpl)
    # ensure parsing succeeds and returns a block
    assert root is not None
    assert len(root.nodes) >= 2
