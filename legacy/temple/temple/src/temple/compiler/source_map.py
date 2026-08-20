"""
temple.compiler.source_map
Source position tracking and error mapping.

Maps between original template positions, preprocessed positions,
and AST node positions for accurate error reporting.
"""

from dataclasses import dataclass
from typing import List, Tuple
from temple.diagnostics import Position, SourceRange


@dataclass
class PositionMapping:
    """Maps a position in preprocessed text to original text."""

    original_pos: Position
    preprocessed_pos: Position


class SourceMap:
    """Maps positions between original and preprocessed versions of source."""

    def __init__(self, original_text: str, preprocessed_text: str):
        """Initialize source map from original and preprocessed text.

        Args:
            original_text: Original template text
            preprocessed_text: Text with DSL tokens removed
        """
        self.original_text = original_text
        self.preprocessed_text = preprocessed_text
        self._build_mapping()

    def _build_mapping(self):
        """Build character-level mapping between original and preprocessed."""
        self.mappings: List[PositionMapping] = []

        orig_idx = 0
        prep_idx = 0
        orig_line, orig_col = 0, 0
        prep_line, prep_col = 0, 0

        while prep_idx < len(self.preprocessed_text) and orig_idx < len(
            self.original_text
        ):
            prep_char = self.preprocessed_text[prep_idx]

            # Find next matching character in original
            while orig_idx < len(self.original_text):
                orig_char = self.original_text[orig_idx]

                if orig_char == prep_char:
                    # Found match
                    self.mappings.append(
                        PositionMapping(
                            original_pos=Position(orig_line, orig_col),
                            preprocessed_pos=Position(prep_line, prep_col),
                        )
                    )

                    # Advance both
                    orig_idx += 1
                    prep_idx += 1

                    # Update positions
                    if prep_char == "\n":
                        prep_line += 1
                        prep_col = 0
                        orig_line += 1
                        orig_col = 0
                    else:
                        prep_col += 1
                        orig_col += 1

                    break
                else:
                    # Skip non-matching in original (likely DSL token)
                    orig_idx += 1
                    if orig_char == "\n":
                        orig_line += 1
                        orig_col = 0
                    else:
                        orig_col += 1

    def preprocessed_to_original(self, prep_pos: Position) -> Position:
        """Map position in preprocessed text to original text.

        Args:
            prep_pos: Position in preprocessed text

        Returns:
            Corresponding position in original text
        """
        # Find closest mapping
        best_mapping = None
        min_distance = float("inf")

        for mapping in self.mappings:
            # Support prep_pos as tuple or Position
            prep_line = getattr(prep_pos, "line", None)
            prep_col = getattr(prep_pos, "col", None) or getattr(
                prep_pos, "column", None
            )
            if prep_line is None or prep_col is None:
                # If a tuple like (line, col) was passed
                try:
                    prep_line, prep_col = prep_pos
                except Exception:
                    prep_line, prep_col = 0, 0
            # Simple distance metric
            distance = abs(mapping.preprocessed_pos.line - prep_line) * 1000 + abs(
                mapping.preprocessed_pos.column - prep_col
            )

            if distance < min_distance:
                min_distance = distance
                best_mapping = mapping

        if best_mapping:
            return best_mapping.original_pos

        # Fallback: return as-is
        return prep_pos

    def original_to_preprocessed(self, orig_pos: Position) -> Position:
        """Map position in original text to preprocessed text.

        Args:
            orig_pos: Position in original text

        Returns:
            Corresponding position in preprocessed text
        """
        # Find closest mapping
        best_mapping = None
        min_distance = float("inf")

        for mapping in self.mappings:
            orig_line = getattr(orig_pos, "line", None)
            orig_col = getattr(orig_pos, "col", None) or getattr(
                orig_pos, "column", None
            )
            if orig_line is None or orig_col is None:
                try:
                    orig_line, orig_col = orig_pos
                except Exception:
                    orig_line, orig_col = 0, 0
            distance = abs(mapping.original_pos.line - orig_line) * 1000 + abs(
                mapping.original_pos.column - orig_col
            )

            if distance < min_distance:
                min_distance = distance
                best_mapping = mapping

        if best_mapping:
            return best_mapping.preprocessed_pos

        return orig_pos

    def preprocessed_range_to_original(self, prep_range: SourceRange) -> SourceRange:
        """Map a range in preprocessed text to original text.

        Args:
            prep_range: Range in preprocessed text

        Returns:
            Corresponding range in original text
        """
        # Accept either SourceRange or tuple((start),(end))
        if isinstance(prep_range, tuple) and len(prep_range) == 2:
            prep_start, prep_end = prep_range
        else:
            prep_start = getattr(prep_range, "start", None)
            prep_end = getattr(prep_range, "end", None)
        orig_start = self.preprocessed_to_original(prep_start)
        orig_end = self.preprocessed_to_original(prep_end)
        return SourceRange(orig_start, orig_end)

    def original_range_to_preprocessed(self, orig_range: SourceRange) -> SourceRange:
        """Map a range in original text to preprocessed text.

        Args:
            orig_range: Range in original text

        Returns:
            Corresponding range in preprocessed text
        """
        prep_start = self.original_to_preprocessed(orig_range.start)
        prep_end = self.original_to_preprocessed(orig_range.end)
        return SourceRange(prep_start, prep_end)


class DiagnosticMapper:
    """Maps diagnostics between preprocessed and original text."""

    def __init__(self, source_map: SourceMap):
        """Initialize mapper with source map.

        Args:
            source_map: SourceMap for position mapping
        """
        self.source_map = source_map

    def map_from_preprocessed(self, diag_position: Position) -> Position:
        """Map diagnostic position from preprocessed back to original.

        Args:
            diag_position: Position in preprocessed text

        Returns:
            Position in original text
        """
        return self.source_map.preprocessed_to_original(diag_position)

    def map_range_from_preprocessed(self, diag_range: SourceRange) -> SourceRange:
        """Map diagnostic range from preprocessed back to original.

        Args:
            diag_range: Range in preprocessed text

        Returns:
            Range in original text
        """
        return self.source_map.preprocessed_range_to_original(diag_range)


class PositionTracker:
    """Tracks current position while walking source text."""

    def __init__(self):
        self.line = 0
        self.col = 0
        self.char_index = 0

    def advance(self, char: str) -> Position:
        """Advance position by one character.

        Args:
            char: Character being consumed

        Returns:
            Position before advancing
        """
        pos = Position(self.line, self.col)

        if char == "\n":
            self.line += 1
            self.col = 0
        else:
            self.col += 1

        self.char_index += 1
        return pos

    def advance_string(self, text: str) -> Position:
        """Advance position by multiple characters.

        Args:
            text: Text being consumed

        Returns:
            Position before advancing
        """
        pos = Position(self.line, self.col)

        for char in text:
            self.advance(char)

        return pos

    def checkpoint(self) -> Tuple[int, int, int]:
        """Get current position as checkpoint tuple."""
        return (self.line, self.col, self.char_index)

    def restore(self, checkpoint: Tuple[int, int, int]):
        """Restore position from checkpoint.

        Args:
            checkpoint: Tuple from checkpoint()
        """
        self.line, self.col, self.char_index = checkpoint
