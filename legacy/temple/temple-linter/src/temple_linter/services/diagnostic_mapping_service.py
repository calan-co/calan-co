"""
DiagnosticMappingService - Maps diagnostics from cleaned content to original positions
"""

from __future__ import annotations

import copy
import logging

from lsprotocol.types import Diagnostic, Position, Range

from temple.template_tokenizer import Token

from .projection_snapshot import ProjectionSnapshot


class DiagnosticMappingService:
    """
    Service responsible for mapping diagnostics between cleaned and original content.

    This service:
    - Maps diagnostic positions from cleaned content back to original template
    - Accounts for stripped DSL tokens in position calculations
    - Handles edge cases and errors gracefully
    """

    def __init__(self, logger: logging.Logger = None):
        self.logger = logger or logging.getLogger(__name__)

    def map_diagnostics(
        self,
        diagnostics: list[Diagnostic],
        mapping: ProjectionSnapshot | list[Token],
    ) -> list[Diagnostic]:
        """
        Map diagnostics from cleaned content to original template positions.

        Args:
            diagnostics: Diagnostics with positions in cleaned content
            mapping: Projection snapshot (preferred) or legacy text token list

        Returns:
            Diagnostics with positions mapped to original template
        """
        if isinstance(mapping, ProjectionSnapshot):
            return self._map_diagnostics_with_projection(diagnostics, mapping)

        mapped_diagnostics: list[Diagnostic] = []
        for diag in diagnostics:
            mapped_diag = self._map_diagnostic_legacy(diag, mapping)
            if mapped_diag:
                mapped_diagnostics.append(mapped_diag)
        return mapped_diagnostics

    def _map_diagnostics_with_projection(
        self,
        diagnostics: list[Diagnostic],
        projection: ProjectionSnapshot,
    ) -> list[Diagnostic]:
        mapped_diagnostics: list[Diagnostic] = []
        for diagnostic in diagnostics:
            try:
                diag = copy.deepcopy(diagnostic)
                start_line, start_char = projection.map_cleaned_position_to_source(
                    int(diag.range.start.line),
                    int(diag.range.start.character),
                )
                end_line, end_char = projection.map_cleaned_position_to_source(
                    int(diag.range.end.line),
                    int(diag.range.end.character),
                )
                diag.range = Range(
                    start=Position(line=start_line, character=start_char),
                    end=Position(line=end_line, character=end_char),
                )
                mapped_diagnostics.append(diag)
            except Exception as exc:
                self.logger.error(
                    "Failed to map projection diagnostic: %s; error: %s",
                    diagnostic,
                    exc,
                )
        return mapped_diagnostics

    def _map_diagnostic_legacy(
        self,
        diagnostic: Diagnostic,
        text_tokens: list[Token],
    ) -> Diagnostic | None:
        """Legacy token-based mapping fallback."""
        try:
            diag = copy.deepcopy(diagnostic)
            start = diag.range.start
            end = diag.range.end

            orig_start = self._map_position_legacy(start, text_tokens)
            orig_end = self._map_position_legacy(end, text_tokens)

            diag.range = Range(start=orig_start, end=orig_end)
            return diag
        except Exception as exc:
            self.logger.error("Failed to map diagnostic: %s, error: %s", diagnostic, exc)
            return None

    def _map_position_legacy(self, pos: Position, text_tokens: list[Token]) -> Position:
        """Map a position from cleaned content to original template (legacy path)."""
        cleaned_offset = self._position_to_offset_legacy(pos, text_tokens)

        offset = 0
        for token in text_tokens:
            token_len = len(token.value)
            if offset <= cleaned_offset < offset + token_len:
                offset_in_token = cleaned_offset - offset
                orig_line, orig_col = self._advance_by_offset(
                    token.start, token.value, offset_in_token
                )
                return Position(line=orig_line, character=orig_col)
            offset += token_len

        return pos

    @staticmethod
    def _position_to_offset_legacy(pos: Position, text_tokens: list[Token]) -> int:
        cleaned_text = "".join(token.value for token in text_tokens)
        lines = cleaned_text.splitlines(keepends=True)
        offset = sum(len(lines[i]) for i in range(min(pos.line, len(lines))))
        offset += pos.character
        return offset

    @staticmethod
    def _advance_by_offset(
        start: tuple[int, int],
        value: str,
        offset: int,
    ) -> tuple[int, int]:
        line, col = start
        substr = value[:offset]

        lines = substr.splitlines(keepends=True)
        if not lines:
            return (line, col)
        if len(lines) == 1:
            return (line, col + len(lines[0]))

        line += len(lines) - 1
        last_line = lines[-1]
        col = 0 if last_line.endswith("\n") or last_line.endswith("\r") else len(last_line)
        return (line, col)
