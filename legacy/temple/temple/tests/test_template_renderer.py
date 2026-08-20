from temple.template_renderer import render_passthrough


def test_render_passthrough_expression_trim_markers_strip_surrounding_whitespace():
    template = "alpha {{- user.name -}} beta"

    rendered, errors = render_passthrough(template)

    assert errors == []
    assert rendered == "alphabeta"


def test_render_passthrough_statement_trim_markers_strip_newlines():
    template = "start \n{%- if cond %}middle{% end -%}\n finish"

    rendered, errors = render_passthrough(template)

    assert errors == []
    assert rendered == "startmiddlefinish"


def test_render_passthrough_supports_tilde_trim_markers():
    template = "left {{~ value ~}} right"

    rendered, errors = render_passthrough(template)

    assert errors == []
    assert rendered == "leftright"


def test_render_passthrough_does_not_leak_trim_right_across_template_tokens():
    template = "A{{ value -}}{% if cond %}{% end %}   B"

    rendered, errors = render_passthrough(template)

    assert errors == []
    assert rendered == "A   B"
