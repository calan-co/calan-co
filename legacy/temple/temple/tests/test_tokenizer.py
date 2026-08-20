from temple.template_tokenizer import Token, _compile_token_pattern, temple_tokenizer


def tokens_to_tuples(
    tokens: list[Token],
) -> list[tuple[str, str, tuple[int, int], tuple[int, int]]]:
    """Helper to convert tokens to tuples for easier comparison in tests."""
    return [(t.type, t.value, t.start, t.end) for t in tokens]


def test_simple_text():
    text = "hello world"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [("text", "hello world", (0, 0), (0, 11))]


def test_expression_token():
    text = "foo {{ bar }} baz"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [
        ("text", "foo ", (0, 0), (0, 4)),
        ("expression", "bar", (0, 4), (0, 13)),
        ("text", " baz", (0, 13), (0, 17)),
    ]


def test_statement_token():
    text = "{% if x %}42{% end %}"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [
        ("statement", "if x", (0, 0), (0, 10)),
        ("text", "42", (0, 10), (0, 12)),
        ("statement", "end", (0, 12), (0, 21)),
    ]


def test_comment_token():
    text = "foo {# comment #} bar"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [
        ("text", "foo ", (0, 0), (0, 4)),
        ("comment", "comment", (0, 4), (0, 17)),
        ("text", " bar", (0, 17), (0, 21)),
    ]


def test_mixed_tokens():
    text = "a{{x}}b{%y%}c{#z#}d"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [
        ("text", "a", (0, 0), (0, 1)),
        ("expression", "x", (0, 1), (0, 6)),
        ("text", "b", (0, 6), (0, 7)),
        ("statement", "y", (0, 7), (0, 12)),
        ("text", "c", (0, 12), (0, 13)),
        ("comment", "z", (0, 13), (0, 18)),
        ("text", "d", (0, 18), (0, 19)),
    ]


def test_multiline_tokens():
    text = "foo\n{{\nbar\n}}\nbaz"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [
        ("text", "foo\n", (0, 0), (1, 0)),
        ("expression", "bar", (1, 0), (3, 2)),
        ("text", "\nbaz", (3, 2), (4, 3)),
    ]


def test_unclosed_token():
    text = "foo {{ bar "
    tokens = list(temple_tokenizer(text))
    # Should treat the whole as text since no closing '}}'
    assert tokens_to_tuples(tokens) == [("text", "foo {{ bar ", (0, 0), (0, 11))]


def test_empty_string():
    tokens = list(temple_tokenizer(""))
    assert tokens == []


def test_only_token():
    text = "{{foo}}"
    tokens = list(temple_tokenizer(text))
    assert tokens_to_tuples(tokens) == [("expression", "foo", (0, 0), (0, 7))]


def test_trim_markers_set_flags_and_strip_marker_characters():
    text = "{{- user.name -}}{% -ignored %}{%- if x -%}{{~ account.id ~}}"
    tokens = list(temple_tokenizer(text))

    assert tokens[0].type == "expression"
    assert tokens[0].value == "user.name"
    assert tokens[0].trim_left is True
    assert tokens[0].trim_right is True

    assert tokens[1].type == "statement"
    assert tokens[1].trim_left is False
    assert tokens[1].trim_right is False

    assert tokens[2].type == "statement"
    assert tokens[2].value == "if x"
    assert tokens[2].trim_left is True
    assert tokens[2].trim_right is True

    assert tokens[3].type == "expression"
    assert tokens[3].value == "account.id"
    assert tokens[3].trim_left is True
    assert tokens[3].trim_right is True


def test_pattern_caching():
    """Test that regex patterns are cached for same delimiter configuration."""
    # Clear cache to start fresh
    _compile_token_pattern.cache_clear()
    assert _compile_token_pattern.cache_info().hits == 0
    assert _compile_token_pattern.cache_info().misses == 0

    # First call with default delimiters - cache miss
    text1 = "{{ x }}"
    tokens1 = list(temple_tokenizer(text1))
    assert len(tokens1) == 1
    assert _compile_token_pattern.cache_info().misses == 1
    assert _compile_token_pattern.cache_info().hits == 0

    # Second call with same delimiters - cache hit
    text2 = "{% if y %}z{% end %}"
    tokens2 = list(temple_tokenizer(text2))
    assert len(tokens2) == 3
    assert _compile_token_pattern.cache_info().hits == 1
    assert _compile_token_pattern.cache_info().misses == 1

    # Third call with custom delimiters - cache miss
    custom_delims = {
        "statement": ("<<", ">>"),
        "expression": ("<:", ":>"),
        "comment": ("<#", "#>"),
    }
    text3 = "<: foo :>"
    tokens3 = list(temple_tokenizer(text3, custom_delims))
    assert len(tokens3) == 1
    assert tokens3[0].type == "expression"
    assert tokens3[0].value == "foo"
    assert _compile_token_pattern.cache_info().misses == 2
    assert _compile_token_pattern.cache_info().hits == 1

    # Fourth call with custom delimiters again - cache hit
    text4 = "<< bar >>"
    tokens4 = list(temple_tokenizer(text4, custom_delims))
    assert len(tokens4) == 1
    assert tokens4[0].type == "statement"
    assert tokens4[0].value == "bar"
    assert _compile_token_pattern.cache_info().hits == 2
    assert _compile_token_pattern.cache_info().misses == 2

    # Fifth call back to default delimiters - cache hit (pattern still cached)
    text5 = "{{ x }}"
    tokens5 = list(temple_tokenizer(text5))
    assert len(tokens5) == 1
    assert _compile_token_pattern.cache_info().hits == 3
    assert _compile_token_pattern.cache_info().misses == 2
