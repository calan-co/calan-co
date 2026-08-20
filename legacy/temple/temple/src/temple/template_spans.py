"""Template token/span utilities shared across runtime integrations."""

from __future__ import annotations

from dataclasses import dataclass

from temple.defaults import DEFAULT_TEMPLATE_DELIMITERS
from temple.template_tokenizer import Token, temple_tokenizer
from temple.whitespace_control import TRIM_MARKERS


@dataclass(frozen=True)
class TemplateTokenSpan:
    """Token plus absolute offsets for token and inner content."""

    token: Token
    start_offset: int
    end_offset: int
    content_start_offset: int
    content_end_offset: int


@dataclass(frozen=True)
class TemplateLineMetadata:
    """Per-line classification for template-aware base-cleaning logic."""

    line_index: int
    start_offset: int
    end_offset: int
    line_ending: str
    has_template_token: bool
    has_non_whitespace_text: bool

    @property
    def is_template_only(self) -> bool:
        return self.has_template_token and not self.has_non_whitespace_text


def _line_start_offsets(text: str) -> list[int]:
    starts = [0]
    for index, char in enumerate(text):
        if char == "\n":
            starts.append(index + 1)
    return starts


def _offset_for_position(line_starts: list[int], line: int, column: int, text_len: int) -> int:
    if line < 0:
        return 0
    if line >= len(line_starts):
        return text_len
    return min(line_starts[line] + max(column, 0), text_len)


def _line_ranges(text: str) -> list[tuple[int, int, str]]:
    ranges: list[tuple[int, int, str]] = []
    cursor = 0
    for line in text.splitlines(keepends=True):
        line_ending = ""
        core = line
        if core.endswith("\r\n"):
            core = core[:-2]
            line_ending = "\r\n"
        elif core.endswith("\n"):
            core = core[:-1]
            line_ending = "\n"
        elif core.endswith("\r"):
            core = core[:-1]
            line_ending = "\r"
        start = cursor
        end = start + len(core)
        ranges.append((start, end, line_ending))
        cursor += len(line)

    if not ranges and text == "":
        return []
    return ranges


def _content_offsets_for_token(token: Token, start_offset: int, end_offset: int) -> tuple[int, int]:
    if token.type == "text":
        return start_offset, end_offset

    content_start = start_offset + len(token.delimiter_start or "")
    content_end = end_offset - len(token.delimiter_end or "")

    if token.trim_left and content_start < content_end:
        content_start += 1
    if token.trim_right and content_end > content_start:
        content_end -= 1

    return content_start, content_end


def _token_end_line_for_marking(token: Token) -> int:
    end_line, end_col = token.end
    if end_line > token.start[0] and end_col == 0:
        return end_line - 1
    return end_line


def build_template_metadata(
    text: str,
    delimiters: dict[str, tuple[str, str]] | None = None,
) -> tuple[list[TemplateTokenSpan], list[TemplateLineMetadata]]:
    """Return token spans and line classifications for template text."""
    effective_delimiters = delimiters or DEFAULT_TEMPLATE_DELIMITERS
    tokens = list(temple_tokenizer(text, effective_delimiters))
    line_starts = _line_start_offsets(text)
    line_ranges = _line_ranges(text)
    text_len = len(text)

    token_spans: list[TemplateTokenSpan] = []
    for token in tokens:
        start_offset = _offset_for_position(
            line_starts, token.start[0], token.start[1], text_len
        )
        end_offset = _offset_for_position(
            line_starts, token.end[0], token.end[1], text_len
        )
        content_start, content_end = _content_offsets_for_token(
            token, start_offset, end_offset
        )
        token_spans.append(
            TemplateTokenSpan(
                token=token,
                start_offset=start_offset,
                end_offset=end_offset,
                content_start_offset=content_start,
                content_end_offset=content_end,
            )
        )

    has_template_token = [False] * len(line_ranges)
    has_non_whitespace_text = [False] * len(line_ranges)

    for span in token_spans:
        token = span.token
        if token.type == "text":
            line = token.start[0]
            for char in token.raw_token:
                if (
                    line < len(has_non_whitespace_text)
                    and char not in {" ", "\t", "\r", "\n"}
                ):
                    has_non_whitespace_text[line] = True
                if char == "\n":
                    line += 1
            continue

        start_line = max(token.start[0], 0)
        end_line = min(_token_end_line_for_marking(token), len(line_ranges) - 1)
        for line_index in range(start_line, end_line + 1):
            has_template_token[line_index] = True

    lines: list[TemplateLineMetadata] = []
    for index, (start, end, line_ending) in enumerate(line_ranges):
        lines.append(
            TemplateLineMetadata(
                line_index=index,
                start_offset=start,
                end_offset=end,
                line_ending=line_ending,
                has_template_token=has_template_token[index],
                has_non_whitespace_text=has_non_whitespace_text[index],
            )
        )

    return token_spans, lines


def find_token_span_at_offset(
    spans: list[TemplateTokenSpan],
    offset: int,
    token_type: str,
) -> TemplateTokenSpan | None:
    """Find token span by token type where the offset is inside token content."""
    for span in spans:
        if span.token.type != token_type:
            continue
        if span.content_start_offset <= offset <= span.content_end_offset:
            return span
    return None


def build_unclosed_span(
    text: str,
    offset: int,
    token_type: str,
) -> tuple[int, int, int, int] | None:
    """Return raw span tuple for an active unclosed expression/statement region."""
    if token_type == "expression":
        open_token = "{{"
        close_token = "}}"
    elif token_type == "statement":
        open_token = "{%"
        close_token = "%}"
    else:
        return None

    open_start = text.rfind(open_token, 0, offset + 1)
    if open_start < 0:
        return None

    last_close_before = text.rfind(close_token, 0, offset + 1)
    if last_close_before > open_start:
        return None

    content_start = open_start + len(open_token)
    if content_start < len(text) and text[content_start] in TRIM_MARKERS:
        content_start += 1

    close_start = text.find(close_token, content_start)
    if close_start >= 0:
        content_end = close_start
        if content_end > content_start and text[content_end - 1] in TRIM_MARKERS:
            content_end -= 1
        span_end = close_start + len(close_token)
    else:
        content_end = len(text)
        span_end = len(text)

    if offset < content_start or offset > content_end:
        return None

    return open_start, span_end, content_start, content_end
