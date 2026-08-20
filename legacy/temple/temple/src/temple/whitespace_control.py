"""Shared trim-marker and whitespace helpers for template delimiter semantics."""

from __future__ import annotations

import re

TRIM_MARKERS = frozenset({"-", "~"})

LEADING_WHITESPACE_RE = re.compile(r"^[ \t\r\n]+")
TRAILING_WHITESPACE_RE = re.compile(r"[ \t\r\n]+$")


def trim_leading_whitespace(text: str) -> str:
    """Remove leading horizontal/vertical whitespace from text."""
    return LEADING_WHITESPACE_RE.sub("", text)


def trim_trailing_whitespace(text: str) -> str:
    """Remove trailing horizontal/vertical whitespace from text."""
    return TRAILING_WHITESPACE_RE.sub("", text)


def apply_left_trim(chunks: list[str]) -> None:
    """Apply trim-left semantics to the most recent emitted chunk."""
    if not chunks:
        return
    chunks[-1] = trim_trailing_whitespace(chunks[-1])


def is_trim_marker(value: str) -> bool:
    """Return True when the value is one of the supported trim markers."""
    return value in TRIM_MARKERS


def parse_token_trim_markers(
    raw_token: str,
    start_delim: str,
    end_delim: str,
) -> tuple[int, int, bool, bool]:
    """Parse optional trim markers from a raw token.

    Returns:
        Tuple of (content_start, content_end, trim_left, trim_right).
    """
    content_start = len(start_delim)
    content_end = len(raw_token) - len(end_delim)
    trim_left = False
    trim_right = False

    if content_start < content_end and is_trim_marker(raw_token[content_start]):
        trim_left = True
        content_start += 1

    if content_end > content_start and is_trim_marker(raw_token[content_end - 1]):
        trim_right = True
        content_end -= 1

    return content_start, content_end, trim_left, trim_right
