from temple.template_spans import (
    build_template_metadata,
    build_unclosed_span,
    find_token_span_at_offset,
)


def test_build_template_metadata_marks_template_only_lines() -> None:
    text = "{% if user.active %}\n- {{ user.name }}\n{% end %}\n"
    token_spans, line_metadata = build_template_metadata(text)

    assert any(span.token.type == "statement" for span in token_spans)
    assert line_metadata[0].is_template_only is True
    assert line_metadata[1].is_template_only is False
    assert line_metadata[2].is_template_only is True


def test_expression_span_content_offsets_respect_trim_markers() -> None:
    text = "alpha {{- user.name -}} omega"
    token_spans, _ = build_template_metadata(text)
    expr_span = next(span for span in token_spans if span.token.type == "expression")

    assert text[expr_span.content_start_offset : expr_span.content_end_offset] == " user.name "


def test_find_unclosed_expression_span_is_trim_aware() -> None:
    text = "{{- user.na"
    span = build_unclosed_span(text, offset=len(text), token_type="expression")

    assert span is not None
    _, _, content_start, content_end = span
    assert text[content_start:content_end] == " user.na"


def test_find_token_span_at_offset_uses_content_range() -> None:
    text = "{{ user.name }}"
    token_spans, _ = build_template_metadata(text)
    offset = text.index("name")

    span = find_token_span_at_offset(token_spans, offset, "expression")

    assert span is not None
    assert span.token.type == "expression"
