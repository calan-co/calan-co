"""Projection snapshot model for cleaned-text base-lint bridges."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass

from .base_cleaning_contract import BaseCleaningContract


def _line_starts(text: str) -> tuple[int, ...]:
    starts = [0]
    for index, char in enumerate(text):
        if char == "\n":
            starts.append(index + 1)
    return tuple(starts)


def _offset_for_position(
    line_starts: tuple[int, ...], line: int, character: int, text_length: int
) -> int:
    if line < 0:
        return 0
    if line >= len(line_starts):
        return text_length
    return min(line_starts[line] + max(character, 0), text_length)


def _position_for_offset(line_starts: tuple[int, ...], offset: int) -> tuple[int, int]:
    if offset <= 0:
        return (0, 0)
    line = bisect_right(line_starts, offset) - 1
    if line < 0:
        return (0, 0)
    return (line, offset - line_starts[line])


def _build_source_to_cleaned_offsets(
    source_length: int, cleaned_to_source: tuple[int, ...], cleaned_length: int
) -> tuple[int, ...]:
    # Map each source offset to the earliest cleaned offset that still points at it.
    mapped = [-1] * (source_length + 1)
    for cleaned_index, source_offset in enumerate(cleaned_to_source):
        if 0 <= source_offset <= source_length and mapped[source_offset] == -1:
            mapped[source_offset] = cleaned_index

    previous = 0
    for index, value in enumerate(mapped):
        if value == -1:
            mapped[index] = previous
            continue
        previous = value

    mapped[source_length] = cleaned_length
    return tuple(mapped)


@dataclass(frozen=True)
class ProjectionSnapshot:
    """Projection contract with bidirectional source<->cleaned mapping."""

    original_text: str
    cleaned_text: str
    cleaned_to_source_offsets: tuple[int, ...]
    source_to_cleaned_offsets: tuple[int, ...]
    line_starts_original: tuple[int, ...]
    line_starts_cleaned: tuple[int, ...]
    format_hint: str | None

    @classmethod
    def from_contract(
        cls,
        contract: BaseCleaningContract,
        format_hint: str | None = None,
    ) -> ProjectionSnapshot:
        cleaned_to_source = contract.cleaned_to_original_offsets
        source_to_cleaned = _build_source_to_cleaned_offsets(
            len(contract.original_text),
            cleaned_to_source,
            len(contract.cleaned_text),
        )
        return cls(
            original_text=contract.original_text,
            cleaned_text=contract.cleaned_text,
            cleaned_to_source_offsets=cleaned_to_source,
            source_to_cleaned_offsets=source_to_cleaned,
            line_starts_original=_line_starts(contract.original_text),
            line_starts_cleaned=_line_starts(contract.cleaned_text),
            format_hint=format_hint,
        )

    def map_cleaned_offset_to_source(self, offset: int) -> int:
        if not self.cleaned_to_source_offsets:
            return 0
        if offset <= 0:
            return self.cleaned_to_source_offsets[0]
        if offset >= len(self.cleaned_to_source_offsets):
            last = self.cleaned_to_source_offsets[-1]
            return min(last + 1, len(self.original_text))
        return self.cleaned_to_source_offsets[offset]

    def map_source_offset_to_cleaned(self, offset: int) -> int:
        if not self.source_to_cleaned_offsets:
            return 0
        if offset <= 0:
            return 0
        if offset >= len(self.source_to_cleaned_offsets):
            return len(self.cleaned_text)
        return self.source_to_cleaned_offsets[offset]

    def map_cleaned_position_to_source(
        self, line: int, character: int
    ) -> tuple[int, int]:
        cleaned_offset = _offset_for_position(
            self.line_starts_cleaned,
            line,
            character,
            len(self.cleaned_text),
        )
        source_offset = self.map_cleaned_offset_to_source(cleaned_offset)
        return _position_for_offset(self.line_starts_original, source_offset)

    def map_source_position_to_cleaned(
        self, line: int, character: int
    ) -> tuple[int, int]:
        source_offset = _offset_for_position(
            self.line_starts_original,
            line,
            character,
            len(self.original_text),
        )
        cleaned_offset = self.map_source_offset_to_cleaned(source_offset)
        return _position_for_offset(self.line_starts_cleaned, cleaned_offset)
