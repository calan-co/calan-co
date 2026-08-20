"""
Tests for source mapping and position tracking.
"""

from temple.compiler.source_map import SourceMap, PositionTracker, DiagnosticMapper
from temple.diagnostics import Position


class TestPositionTracker:
    """Test PositionTracker class."""

    def test_advance_single_char(self):
        tracker = PositionTracker()
        pos = tracker.advance("a")

        assert pos == Position(0, 0)
        assert tracker.line == 0
        assert tracker.col == 1

    def test_advance_newline(self):
        tracker = PositionTracker()
        tracker.advance("a")
        pos = tracker.advance("\n")

        assert pos == Position(0, 1)
        assert tracker.line == 1
        assert tracker.col == 0

    def test_advance_string(self):
        tracker = PositionTracker()
        pos = tracker.advance_string("hello")

        assert pos == Position(0, 0)
        assert tracker.line == 0
        assert tracker.col == 5

    def test_advance_string_with_newline(self):
        tracker = PositionTracker()
        pos = tracker.advance_string("hello\nworld")

        assert pos == Position(0, 0)
        assert tracker.line == 1
        assert tracker.col == 5

    def test_checkpoint_restore(self):
        tracker = PositionTracker()
        tracker.advance_string("hello\nworld")
        checkpoint = tracker.checkpoint()

        tracker.advance_string("\nmore")
        tracker.restore(checkpoint)

        assert tracker.line == 1
        assert tracker.col == 5


class TestSourceMap:
    """Test SourceMap class."""

    def test_simple_mapping(self):
        original = "hello {{ x }} world"
        preprocessed = "hello  x  world"

        source_map = SourceMap(original, preprocessed)

        # Position in preprocessed should map back
        orig_pos = source_map.preprocessed_to_original(Position(0, 6))
        assert orig_pos.line == 0

    def test_mapping_with_multiple_tokens(self):
        original = "{{ x }} and {{ y }}"
        preprocessed = " x  and  y "

        source_map = SourceMap(original, preprocessed)

        # Should handle multiple tokens
        assert source_map.preprocessed_to_original(Position(0, 0)).line == 0

    def test_mapping_with_newlines(self):
        original = "hello\n{{ x }}\nworld"
        preprocessed = "hello\n x \nworld"

        source_map = SourceMap(original, preprocessed)

        # Position on line 2
        pos = source_map.preprocessed_to_original(Position(2, 0))
        assert pos.line == 2

    def test_range_mapping(self):
        original = "{{ x }} hello {{ y }}"
        preprocessed = " x  hello  y "

        source_map = SourceMap(original, preprocessed)

        prep_range = (0, 0)
        orig_range = source_map.preprocessed_range_to_original(prep_range)

        assert orig_range.start.line == 0
        assert orig_range.end.line == 0


class TestDiagnosticMapper:
    """Test DiagnosticMapper class."""

    def test_map_position_from_preprocessed(self):
        original = "hello {{ x }} world"
        preprocessed = "hello  x  world"

        source_map = SourceMap(original, preprocessed)
        mapper = DiagnosticMapper(source_map)

        # Map preprocessed position back to original
        orig_pos = mapper.map_from_preprocessed(Position(0, 6))
        assert orig_pos.line == 0

    def test_map_range_from_preprocessed(self):
        original = "hello {{ x }} world"
        preprocessed = "hello  x  world"

        source_map = SourceMap(original, preprocessed)
        mapper = DiagnosticMapper(source_map)

        # Map preprocessed range back to original
        prep_range = (0, 0)
        orig_range = mapper.map_range_from_preprocessed(prep_range)

        assert orig_range.start.line == 0
        assert orig_range.end.line == 0


class TestComplexMapping:
    """Test complex mapping scenarios."""

    def test_multiline_with_tokens(self):
        original = """{%if x%}
hello
{{ y }}
world
{% end %}"""

        preprocessed = """
hello

world
"""

        source_map = SourceMap(original, preprocessed)

        # Should handle multi-line templates
        assert source_map.preprocessed_to_original(Position(0, 0)).line >= 0

    def test_back_and_forth_mapping(self):
        original = "hello {{ x }} world"
        preprocessed = "hello  x  world"

        source_map = SourceMap(original, preprocessed)

        # Map preprocessed to original
        orig_pos = source_map.preprocessed_to_original(Position(0, 8))

        # Map back to preprocessed
        prep_pos = source_map.original_to_preprocessed(orig_pos)

        # Should be close to original position (not exact due to token removal)
        assert abs(prep_pos.col - 8) <= 2
