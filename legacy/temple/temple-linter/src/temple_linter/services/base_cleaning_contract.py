"""Contracts for base-language cleaning and adapter policy processing."""

from __future__ import annotations

from dataclasses import dataclass

from temple.template_spans import TemplateLineMetadata, TemplateTokenSpan


@dataclass(frozen=True)
class BaseCleaningContract:
    """Immutable contract shared by base-cleaning core and policy adapters."""

    original_text: str
    cleaned_text: str
    cleaned_to_original_offsets: tuple[int, ...]
    token_spans: tuple[TemplateTokenSpan, ...]
    line_metadata: tuple[TemplateLineMetadata, ...]
