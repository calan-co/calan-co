from temple.template_renderer import render_passthrough


def test_render_passthrough_simple():
    """Test simple passthrough rendering."""
    text = "hello world"
    output, errors = render_passthrough(text)
    assert output == "hello world"
    assert errors == []


def test_render_passthrough_strips_expressions():
    """Test that expressions are stripped in passthrough mode."""
    text = "hello {{ name }} world"
    output, errors = render_passthrough(text)
    assert output == "hello  world"
    assert errors == []


def test_render_passthrough_strips_statements():
    """Test that statement blocks are stripped in passthrough mode."""
    text = "before{% if x %}middle{% end %}after"
    output, errors = render_passthrough(text)
    assert output == "beforemiddleafter"
    assert errors == []


def test_render_passthrough_strips_comments():
    """Test that comments are stripped."""
    text = "text{# comment #}more"
    output, errors = render_passthrough(text)
    assert output == "textmore"
    assert errors == []


def test_block_validator_valid_if():
    """Test validation of balanced if/end."""
    text = "{% if x %}content{% end %}"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert errors == []


def test_block_validator_valid_for():
    """Test validation of balanced for/end."""
    text = "{% for item in list %}content{% end %}"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert errors == []


def test_block_validator_valid_nested():
    """Test validation of nested blocks."""
    text = "{% if x %}{% for i in list %}nested{% end %}{% end %}"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert errors == []


def test_block_validator_unclosed_if():
    """Test detection of unclosed if."""
    text = "{% if x %}content"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert len(errors) == 1
    assert "Unclosed block 'if'" in errors[0]


def test_block_validator_unclosed_for():
    """Test detection of unclosed for."""
    text = "{% for i in list %}content"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert len(errors) == 1
    assert "Unclosed block 'for'" in errors[0]


def test_block_validator_unexpected_end():
    """Test detection of unexpected closing block."""
    text = "content{% end %}"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert len(errors) == 1
    assert "Unexpected closing block" in errors[0]


def test_block_validator_mismatched_blocks():
    """Test detection of mismatched open/close."""
    # With canonical single-`end` closers, a mismatch cannot be forced.
    # Omitting an `end` will leave the opener unclosed, so only an Unclosed block
    # diagnostic should be produced.
    text = "{% if x %}content"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert len(errors) == 1
    assert "Unclosed block" in errors[0]


def test_block_validator_function_blocks():
    """Test validation of function/end."""
    # Use canonical 'end' closer for function blocks.
    text = "{% function test() %}content{% end %}"
    output, errors = render_passthrough(text, validate_blocks=True)
    assert errors == []


def test_block_validator_skip_validation():
    """Test that validation can be skipped."""
    text = "{% if x %}content"  # Unclosed
    output, errors = render_passthrough(text, validate_blocks=False)
    assert errors == []  # No errors because validation was skipped


def test_render_passthrough_multiline():
    """Test multiline template rendering."""
    text = """line1
{% if true %}
line2
{% end %}
line3"""
    output, errors = render_passthrough(text)
    assert "line1" in output
    assert "line2" in output
    assert "line3" in output
    assert errors == []


def test_block_validator_custom_delimiters():
    """Test validation with custom delimiters."""
    custom_delims = {
        "statement": ("<<", ">>"),
        "expression": ("<:", ":>"),
        "comment": ("<#", "#>"),
    }
    text = "<< if x >>content<< end >>"
    output, errors = render_passthrough(
        text, delimiters=custom_delims, validate_blocks=True
    )
    assert errors == []
    assert "content" in output
