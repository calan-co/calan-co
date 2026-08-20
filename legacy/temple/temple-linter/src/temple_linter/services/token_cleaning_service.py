"""TokenCleaningService - Strips template tokens for base format linting."""

from __future__ import annotations

import re

from temple.template_spans import TemplateLineMetadata, build_template_metadata
from temple.template_tokenizer import Token
from temple.whitespace_control import trim_leading_whitespace

from .base_cleaning_contract import BaseCleaningContract
from .base_cleaning_policies import apply_markdown_policy
from .projection_snapshot import ProjectionSnapshot

_LEADING_HORIZONTAL_WHITESPACE_RE = re.compile(r"^[ \t]+")


class TokenCleaningService:
    """
    Service responsible for stripping template tokens and tracking text positions.

    This service:
    - Tokenizes template content
    - Replaces DSL tokens with whitespace placeholders
    - Preserves line/column offsets for base-linter diagnostics
    """

    def clean_text_and_tokens(
        self,
        text: str,
        format_hint: str | None = None,
        delimiters: dict[str, tuple[str, str]] | None = None,
    ) -> tuple[str, list[Token]]:
        """
        Strip template tokens and return cleaned text with position tracking.

        Args:
            text: Original template content

        Returns:
            Tuple of (cleaned_text, text_tokens)
            - cleaned_text: Content with all DSL tokens removed
            - text_tokens: List of text Token objects for position mapping
        """
        contract = self.clean_for_base_lint(text, format_hint, delimiters)
        return contract.cleaned_text, []

    def project_for_base_lint(
        self,
        text: str,
        format_hint: str | None = None,
        delimiters: dict[str, tuple[str, str]] | None = None,
    ) -> ProjectionSnapshot:
        """Return full projection snapshot for cleaned base-lint transport."""
        contract = self.clean_for_base_lint(text, format_hint, delimiters)
        return ProjectionSnapshot.from_contract(contract, format_hint=format_hint)

    def clean_for_base_lint(
        self,
        text: str,
        format_hint: str | None = None,
        delimiters: dict[str, tuple[str, str]] | None = None,
    ) -> BaseCleaningContract:
        """Produce canonical base-cleaning contract for adapter-specific policies."""
        token_spans, line_metadata = build_template_metadata(
            text,
            delimiters=delimiters,
        )
        normalized_hint = (format_hint or "").strip().lower()
        preserve_line_structure = normalized_hint in {"md", "markdown"}

        cleaned_chars: list[str] = []
        cleaned_offsets: list[int] = []
        trim_next_text_left = False
        for token_span in token_spans:
            token = token_span.token
            if token.type == "text":
                text_value = token.raw_token
                text_start = token_span.start_offset
                if trim_next_text_left:
                    if preserve_line_structure:
                        trimmed = _LEADING_HORIZONTAL_WHITESPACE_RE.sub("", text_value)
                    else:
                        trimmed = trim_leading_whitespace(text_value)
                    removed = len(text_value) - len(trimmed)
                    text_value = trimmed
                    text_start += removed
                    trim_next_text_left = False
                self._append_with_offsets(
                    cleaned_chars,
                    cleaned_offsets,
                    text_value,
                    text_start,
                )
                continue

            if token.trim_left:
                self._apply_left_trim(
                    cleaned_chars,
                    cleaned_offsets,
                    preserve_line_structure=preserve_line_structure,
                )

            # Keep offsets stable by masking template DSL lexemes with spaces while
            # preserving line breaks. This allows native linters to report positions
            # that map directly to the original template.
            if token.trim_left or token.trim_right:
                masked = ""
            else:
                masked = "".join(
                    ch if ch in ("\n", "\r") else " " for ch in token.raw_token
                )
            self._append_with_offsets(
                cleaned_chars,
                cleaned_offsets,
                masked,
                token_span.start_offset,
            )
            if token.trim_right:
                trim_next_text_left = True

        cleaned_text, cleaned_offsets = self._normalize_template_only_lines(
            "".join(cleaned_chars),
            cleaned_offsets,
            line_metadata,
        )
        contract = BaseCleaningContract(
            original_text=text,
            cleaned_text=cleaned_text,
            cleaned_to_original_offsets=tuple(cleaned_offsets),
            token_spans=tuple(token_spans),
            line_metadata=tuple(line_metadata),
        )

        if normalized_hint in {"md", "markdown"}:
            contract = apply_markdown_policy(contract)
        return contract

    @staticmethod
    def _append_with_offsets(
        chars: list[str],
        offsets: list[int],
        text: str,
        start_offset: int,
    ) -> None:
        if not text:
            return
        chars.append(text)
        offsets.extend(start_offset + index for index in range(len(text)))

    @staticmethod
    def _apply_left_trim(
        chars: list[str],
        offsets: list[int],
        preserve_line_structure: bool,
    ) -> None:
        if not chars:
            return
        # Flatten only the tail chunk as needed to preserve existing chunking cost.
        tail = chars[-1]
        if not tail:
            return
        if preserve_line_structure:
            trimmed_len = len(tail.rstrip(" \t"))
        else:
            trimmed_len = len(tail.rstrip(" \t\r\n"))
        if trimmed_len == len(tail):
            return
        chars[-1] = tail[:trimmed_len]
        if trimmed_len == 0:
            chars.pop()
        del offsets[-(len(tail) - trimmed_len) :]

    @staticmethod
    def _split_lines_with_offsets(
        cleaned_text: str, cleaned_offsets: list[int]
    ) -> tuple[list[str], list[list[int]]]:
        if not cleaned_text:
            return [], []
        lines = cleaned_text.splitlines(keepends=True)
        per_line_offsets: list[list[int]] = []
        cursor = 0
        for line in lines:
            line_len = len(line)
            per_line_offsets.append(cleaned_offsets[cursor : cursor + line_len])
            cursor += line_len
        return lines, per_line_offsets

    @staticmethod
    def _normalize_template_only_lines(
        cleaned_text: str,
        cleaned_offsets: list[int],
        line_metadata: list[TemplateLineMetadata],
    ) -> tuple[str, list[int]]:
        """Convert template-only lines to truly blank lines for base linters.

        Masking keeps offsets useful for mixed-content lines, but markdown linters in
        particular treat whitespace-only lines as non-blank. For lines that consist of
        only template tags and whitespace, collapse content to just the original line
        ending so base linting sees an actual blank separator.
        """
        cleaned_lines, cleaned_offsets_by_line = TokenCleaningService._split_lines_with_offsets(
            cleaned_text, cleaned_offsets
        )
        normalized_offsets: list[int] = []
        normalized: list[str] = []
        for line_index, meta in enumerate(line_metadata):
            cleaned_line = cleaned_lines[line_index] if line_index < len(cleaned_lines) else ""
            cleaned_line_offsets = (
                cleaned_offsets_by_line[line_index]
                if line_index < len(cleaned_offsets_by_line)
                else []
            )
            if not meta.is_template_only:
                normalized.append(cleaned_line)
                normalized_offsets.extend(cleaned_line_offsets)
                continue
            normalized.append(meta.line_ending)
            normalized_offsets.extend(
                meta.end_offset + index for index in range(len(meta.line_ending))
            )

        if len(cleaned_lines) > len(line_metadata):
            for line_index in range(len(line_metadata), len(cleaned_lines)):
                normalized.append(cleaned_lines[line_index])
                normalized_offsets.extend(cleaned_offsets_by_line[line_index])

        return "".join(normalized), normalized_offsets
