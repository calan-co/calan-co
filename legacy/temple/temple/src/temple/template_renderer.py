"""
temple.template_renderer
Minimal rendering engine for Temple templates.

Provides:
- Passthrough token concatenation (text tokens only)
- Statement block validation (if/for/function nesting)
- Placeholder handling for expressions/comments
"""

from temple.template_tokenizer import Token, temple_tokenizer
from temple.whitespace_control import apply_left_trim, trim_leading_whitespace


class RenderError(Exception):
    """Error during template rendering."""

    pass


class BlockValidator:
    """Validates nesting of statement blocks (if/for/function)."""

    # Statement tokens that open blocks. Closers are normalized to a single `end` token.
    BLOCK_OPENS = {"if", "for", "function"}

    def __init__(self):
        self.stack: list[tuple[str, int, int]] = []  # (type, line, col)

    def validate(self, tokens: list[Token]) -> list[str]:
        """
        Validate block balance. Return list of error messages.

        Args:
            tokens: List of template tokens

        Returns:
            List of error messages (empty if valid)
        """
        errors = []

        for token in tokens:
            if token.type != "statement":
                continue

            # Token value (trimmed) and first keyword
            raw_value = token.value.strip() if token.value else ""
            keyword = raw_value.split()[0].lower() if raw_value else ""

            # Opening block
            if keyword in self.BLOCK_OPENS:
                self.stack.append((keyword, token.start[0], token.start[1]))

            # Closing block: only the generic 'end' token (exact match)
            # is treated as a closer. Variants like 'end if' are not
            # considered canonical closers.
            elif raw_value.lower() == "end":
                if not self.stack:
                    errors.append(
                        f"Unexpected closing block '{keyword}' at "
                        f"line {token.start[0] + 1}, col {token.start[1] + 1}"
                    )
                    continue

                # Proper close: pop the matching opener
                self.stack.pop()

            # Note: only the exact 'end' token is treated as a closer.

        # Check for unclosed blocks
        for block_type, line, col in self.stack:
            errors.append(
                f"Unclosed block '{block_type}' at line {line + 1}, col {col + 1}"
            )

        return errors


def render_passthrough(
    text: str,
    delimiters: dict | None = None,
    validate_blocks: bool = True,
) -> tuple[str, list[str]]:
    """
    Render template by concatenating text tokens.

    This is a minimal renderer that:
    - Extracts text tokens (strips DSL)
    - Validates block nesting (if/for/function)
    - Returns rendered output + validation errors

    Args:
        text: Template content
        delimiters: Optional custom delimiters
        validate_blocks: Whether to validate statement block nesting (default: True)

    Returns:
        Tuple of (rendered_output, error_messages)
    """
    tokens = list(temple_tokenizer(text, delimiters))
    errors = []

    # Validate block nesting
    if validate_blocks:
        validator = BlockValidator()
        errors = validator.validate(tokens)

    # Concatenate text tokens only (passthrough), honoring trim markers.
    output_parts = []
    trim_next_text_left = False
    for token in tokens:
        if token.type in {"statement", "expression", "comment"}:
            # Trim-right should apply only to immediately following text; if we
            # encounter another template token first, clear stale intent.
            if trim_next_text_left:
                trim_next_text_left = False
            if token.trim_left:
                apply_left_trim(output_parts)
            if token.trim_right:
                trim_next_text_left = True
            continue

        if token.type == "text":
            text_value = token.value
            if trim_next_text_left:
                text_value = trim_leading_whitespace(text_value)
                trim_next_text_left = False
            output_parts.append(text_value)

    output = "".join(output_parts)
    return output, errors


def render(
    text: str,
    data: dict | None = None,
    delimiters: dict | None = None,
) -> tuple[str, list[str]]:
    """
    Render template with data.

    Currently implements passthrough mode (text extraction + block validation).
    Future: Implement full rendering with expression evaluation, loops, etc.

    Args:
        text: Template content
        data: Input data object (unused in passthrough mode)
        delimiters: Optional custom delimiters

    Returns:
        Tuple of (rendered_output, error_messages)
    """
    # TODO: Implement full rendering with data binding
    # For now: passthrough mode
    return render_passthrough(text, delimiters, validate_blocks=True)
