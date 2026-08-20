"""Base-cleaning policy adapters for language-specific lint compatibility."""

from __future__ import annotations

from temple.template_spans import TemplateTokenSpan

from .base_cleaning_contract import BaseCleaningContract

MARKDOWN_EXPRESSION_PLACEHOLDER = "lorem"
_MARKDOWN_EXPRESSION_PLACEHOLDER_PADDED = f" {MARKDOWN_EXPRESSION_PLACEHOLDER} "


def apply_markdown_policy(contract: BaseCleaningContract) -> BaseCleaningContract:
    """Apply markdown-specific post-processing on top of base-cleaning contract."""
    line_metadata = contract.line_metadata
    if not line_metadata:
        return contract

    template_tokens_by_line = _group_template_tokens_by_line(
        contract.token_spans,
        len(line_metadata),
    )
    cleaned_lines, cleaned_offsets_by_line = _split_lines_with_offsets(
        contract.cleaned_text,
        contract.cleaned_to_original_offsets,
    )

    rewritten: list[str] = []
    rewritten_offsets: list[int] = []
    for line, line_info in enumerate(line_metadata):
        masked_line = cleaned_lines[line] if line < len(cleaned_lines) else ""
        masked_offsets = (
            cleaned_offsets_by_line[line] if line < len(cleaned_offsets_by_line) else []
        )

        if not line_info.has_template_token:
            rewritten.append(masked_line)
            rewritten_offsets.extend(masked_offsets)
            continue
        if line_info.is_template_only:
            rewritten.append(line_info.line_ending)
            rewritten_offsets.extend(
                line_info.end_offset + index
                for index in range(len(line_info.line_ending))
            )
            continue

        core_rewritten, core_offsets = _rewrite_markdown_mixed_line(
            contract.original_text,
            line_info.start_offset,
            line_info.end_offset,
            template_tokens_by_line.get(line, []),
        )
        core_rewritten, core_offsets = _normalize_markdown_core(
            core_rewritten,
            core_offsets,
        )

        if core_rewritten.strip() == "":
            rewritten.append(line_info.line_ending)
            rewritten_offsets.extend(
                line_info.end_offset + index
                for index in range(len(line_info.line_ending))
            )
        else:
            rewritten.append(core_rewritten + line_info.line_ending)
            rewritten_offsets.extend(core_offsets)
            rewritten_offsets.extend(
                line_info.end_offset + index
                for index in range(len(line_info.line_ending))
            )

    if len(cleaned_lines) > len(line_metadata):
        for line in range(len(line_metadata), len(cleaned_lines)):
            rewritten.append(cleaned_lines[line])
            rewritten_offsets.extend(cleaned_offsets_by_line[line])

    return BaseCleaningContract(
        original_text=contract.original_text,
        cleaned_text="".join(rewritten),
        cleaned_to_original_offsets=tuple(rewritten_offsets),
        token_spans=contract.token_spans,
        line_metadata=contract.line_metadata,
    )


def _group_template_tokens_by_line(
    token_spans: tuple[TemplateTokenSpan, ...],
    line_count: int,
) -> dict[int, list[TemplateTokenSpan]]:
    grouped: dict[int, list[TemplateTokenSpan]] = {}
    for span in token_spans:
        if span.token.type == "text":
            continue
        start_line = max(span.token.start[0], 0)
        end_line = min(span.token.end[0], line_count - 1)
        if span.token.end[0] > span.token.start[0] and span.token.end[1] == 0:
            end_line = max(start_line, end_line - 1)
        for line in range(start_line, end_line + 1):
            grouped.setdefault(line, []).append(span)

    for spans in grouped.values():
        spans.sort(key=lambda item: item.start_offset)
    return grouped


def _rewrite_markdown_mixed_line(
    original_text: str,
    line_start: int,
    line_end: int,
    template_spans: list[TemplateTokenSpan],
) -> tuple[str, list[int]]:
    if not template_spans:
        slice_text = original_text[line_start:line_end]
        return slice_text, list(range(line_start, line_end))

    parts: list[str] = []
    offsets: list[int] = []
    cursor = line_start
    for span in template_spans:
        token_start = max(span.start_offset, line_start)
        token_end = min(span.end_offset, line_end)
        if token_end <= token_start:
            continue

        if cursor < token_start:
            parts.append(original_text[cursor:token_start])
            offsets.extend(range(cursor, token_start))

        if span.token.type == "expression":
            placeholder = _MARKDOWN_EXPRESSION_PLACEHOLDER_PADDED
            anchor_offset = max(span.content_start_offset, span.start_offset)
            while (
                anchor_offset < span.content_end_offset
                and original_text[anchor_offset] in {" ", "\t", "\r", "\n"}
            ):
                anchor_offset += 1
            if anchor_offset >= span.content_end_offset:
                anchor_offset = max(span.content_start_offset, span.start_offset)
            parts.append(placeholder)
            offsets.extend(anchor_offset for _ in placeholder)
        cursor = max(cursor, token_end)

    if cursor < line_end:
        parts.append(original_text[cursor:line_end])
        offsets.extend(range(cursor, line_end))
    return "".join(parts), offsets


def _normalize_markdown_core(
    text: str,
    offsets: list[int],
) -> tuple[str, list[int]]:
    if not text:
        return text, offsets

    # Collapse contiguous runs of spaces/tabs into one space to reduce
    # markdownlint whitespace noise while preserving a deterministic anchor.
    collapsed_chars: list[str] = []
    collapsed_offsets: list[int] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char in {" ", "\t"}:
            run_start = index
            while index < len(text) and text[index] in {" ", "\t"}:
                index += 1
            run_length = index - run_start
            if run_length == 1:
                collapsed_chars.append(text[run_start])
                collapsed_offsets.append(offsets[run_start])
            else:
                collapsed_chars.append(" ")
                collapsed_offsets.append(offsets[run_start])
            continue
        collapsed_chars.append(char)
        collapsed_offsets.append(offsets[index])
        index += 1

    # Right-trim horizontal whitespace.
    while collapsed_chars and collapsed_chars[-1] in {" ", "\t"}:
        collapsed_chars.pop()
        collapsed_offsets.pop()

    # Normalize ATX header spacing ("##  title" -> "## title").
    hash_count = 0
    while (
        hash_count < len(collapsed_chars)
        and hash_count < 6
        and collapsed_chars[hash_count] == "#"
    ):
        hash_count += 1
    if 1 <= hash_count <= 6:
        space_start = hash_count
        space_end = space_start
        while space_end < len(collapsed_chars) and collapsed_chars[space_end] == " ":
            space_end += 1
        if (space_end - space_start) >= 2:
            del collapsed_chars[space_start + 1 : space_end]
            del collapsed_offsets[space_start + 1 : space_end]

    return "".join(collapsed_chars), collapsed_offsets


def _split_lines_with_offsets(
    cleaned_text: str,
    cleaned_offsets: tuple[int, ...],
) -> tuple[list[str], list[list[int]]]:
    if not cleaned_text:
        return [], []
    lines = cleaned_text.splitlines(keepends=True)
    offset_lines: list[list[int]] = []
    cursor = 0
    for line in lines:
        line_len = len(line)
        offset_lines.append(list(cleaned_offsets[cursor : cursor + line_len]))
        cursor += line_len
    return lines, offset_lines
