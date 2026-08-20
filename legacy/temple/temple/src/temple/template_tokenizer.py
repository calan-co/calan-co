"""
temple.template_tokenizer
Core template tokenization engine for Temple DSL.

This is the AUTHORITATIVE implementation used by all Temple components.
Supports configurable delimiters and efficient regex pattern caching.
"""

import re
from collections.abc import Iterator
from functools import lru_cache
from typing import Literal

from temple.defaults import DEFAULT_TEMPLATE_DELIMITERS
from temple.whitespace_control import parse_token_trim_markers

TokenType = Literal["text", "statement", "expression", "comment"]


@lru_cache(maxsize=128)
def _compile_token_pattern(delimiters_tuple: tuple) -> re.Pattern:
    """Compile and cache regex pattern for given delimiters.

    Args:
        delimiters_tuple: Frozen representation of delimiters dict as tuple of tuples.
            Format: ((type1, start1, end1), (type2, start2, end2), ...)

    Returns:
        Compiled regex pattern for tokenization.

    Note:
        Patterns are cached with maxsize=128. Cache persists across multiple
        tokenization calls with the same delimiter configuration.
    """
    # Reconstruct delimiters dict from tuple
    delims = {ttype: (start, end) for ttype, start, end in delimiters_tuple}

    # Build regex pattern with capture groups for each token type
    pattern_parts = []
    for ttype, (start, end) in delims.items():
        pattern_parts.append(f"(?P<{ttype}>{re.escape(start)}.*?{re.escape(end)})")
    combined_pattern = "|".join(pattern_parts)
    return re.compile(combined_pattern, re.DOTALL)


class Token:
    def __init__(
        self,
        raw_token: str,
        start: tuple[int, int],
        delimiters: dict[TokenType, tuple[str, str]] | None = None,
    ):
        self.raw_token = raw_token
        self.start = start
        self.delimiters = delimiters or DEFAULT_TEMPLATE_DELIMITERS
        (
            self.type,
            self.value,
            self.delimiter_start,
            self.delimiter_end,
            self.trim_left,
            self.trim_right,
        ) = (
            self._parse_type_and_value()
        )
        self.end = self._compute_end()

    def _parse_type_and_value(self):
        for ttype, (start_delim, end_delim) in self.delimiters.items():
            if self.raw_token.startswith(start_delim) and self.raw_token.endswith(
                end_delim
            ):
                content_start, content_end, trim_left, trim_right = (
                    parse_token_trim_markers(self.raw_token, start_delim, end_delim)
                )

                value = self.raw_token[content_start:content_end].strip()
                return ttype, value, start_delim, end_delim, trim_left, trim_right
        # Default to text
        return "text", self.raw_token, None, None, False, False

    def _compute_end(self):
        line, col = self.start
        for c in self.raw_token:
            if c == "\n":
                line += 1
                col = 0
            else:
                col += 1
        return (line, col)

    def __repr__(self):
        return (
            "Token("
            f"type={self.type!r}, value={self.value!r}, start={self.start}, end={self.end}, "
            f"delimiters=({self.delimiter_start!r},{self.delimiter_end!r}), "
            f"trim_left={self.trim_left}, trim_right={self.trim_right}"
            ")"
        )


def temple_tokenizer(
    text: str,
    delimiters: dict[TokenType, tuple[str, str]] | None = None,
) -> Iterator[Token]:
    """
    Yields Token objects for text, statement, expression, and comment regions.
    Supports custom delimiters.

    Regex patterns are cached using functools.lru_cache for performance.
    Subsequent calls with the same delimiter configuration reuse compiled patterns,
    providing 10x+ speedup for batch processing.

    Args:
        text: The template text to tokenize.
        delimiters: Optional dict specifying delimiters for 'statement', 'expression', 'comment'.
            Defaults to Jinja-like delimiters: {%, {{, {#.

    Yields:
        Token objects representing text, statement, expression, or comment regions.
    """
    # Default delimiters (Jinja-like)
    delims = delimiters or DEFAULT_TEMPLATE_DELIMITERS

    # Convert delimiters dict to frozen tuple for caching
    delims_tuple = tuple(sorted((k, v[0], v[1]) for k, v in delims.items()))

    # Get cached compiled pattern
    token_pattern = _compile_token_pattern(delims_tuple)
    pos = 0
    line = 0
    col = 0
    while pos < len(text):
        m = token_pattern.search(text, pos)
        if not m:
            # Remaining text is plain text
            value = text[pos:]
            if value:
                yield Token(value, (line, col), delimiters)
            break
        # Text before token
        if m.start() > pos:
            value = text[pos : m.start()]
            yield Token(value, (line, col), delimiters)
            line, col = _advance((line, col), value)
        # Token itself
        for ttype in delims:
            if m.group(ttype):
                raw_token = m.group(ttype)
                yield Token(raw_token, (line, col), delimiters)
                line, col = _advance((line, col), raw_token)
                break
        pos = m.end()


def _advance(start: tuple[int, int], value: str) -> tuple[int, int]:
    """Advance (line, col) by value."""
    line, col = start
    for c in value:
        if c == "\n":
            line += 1
            col = 0
        else:
            col += 1
    return (line, col)
