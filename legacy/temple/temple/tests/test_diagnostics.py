"""
Tests for the diagnostic system (ported from compiler tests).
"""

from temple.diagnostics import (
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticCollector,
    Position,
    SourceRange,
)


class TestPosition:
    """Test Position class."""

    def test_create_position(self):
        pos = Position(5, 10)
        assert pos.line == 5
        assert pos.column == 10

    def test_position_to_lsp(self):
        pos = Position(5, 10)
        lsp = pos.to_lsp()
        assert lsp == {"line": 5, "character": 10}

    def test_position_to_string(self):
        pos = Position(5, 10)
        # Human-readable format is 1-indexed
        assert str(pos) == "6:11"


class TestSourceRange:
    """Test SourceRange class."""

    def test_create_range(self):
        range = SourceRange(Position(0, 5), Position(0, 10))
        assert range.start.line == 0
        assert range.start.column == 5
        assert range.end.line == 0
        assert range.end.column == 10

    def test_range_to_lsp(self):
        range = SourceRange(Position(0, 5), Position(0, 10))
        lsp = range.to_lsp()
        assert lsp == {
            "start": {"line": 0, "character": 5},
            "end": {"line": 0, "character": 10},
        }


class TestDiagnostic:
    """Test Diagnostic class."""

    def test_create_diagnostic(self):
        diag = Diagnostic(
            message="Test error",
            source_range=SourceRange(Position(0, 0), Position(0, 5)),
        )
        assert diag.message == "Test error"
        assert diag.severity == DiagnosticSeverity.ERROR

    def test_diagnostic_to_lsp(self):
        diag = Diagnostic(
            message="Test error",
            source_range=SourceRange(Position(0, 5), Position(0, 10)),
            code="TEST_001",
        )
        lsp = diag.to_lsp()

        assert lsp["message"] == "Test error"
        assert lsp["severity"] == DiagnosticSeverity.ERROR.value
        assert lsp["code"] == "TEST_001"
        assert "range" in lsp

    def test_diagnostic_to_string_without_context(self):
        diag = Diagnostic(
            message="Test error",
            source_range=SourceRange(Position(0, 0), Position(0, 5)),
            code="TEST_001",
        )
        output = diag.to_string(include_context=False)

        assert "Test error" in output
        assert "error" in output
        assert "1:1" in output  # Position is displayed as 1-indexed

    def test_diagnostic_with_context(self):
        source = "hello world"
        diag = Diagnostic(
            message="Test error",
            source_range=SourceRange(Position(0, 0), Position(0, 5)),
        )
        output = diag.to_string(source_text=source, include_context=True)

        assert "hello world" in output
        assert "^" in output  # Pointer

    def test_diagnostic_severity_levels(self):
        """Test different severity levels."""
        error = Diagnostic(
            message="Error",
            source_range=SourceRange(Position(0, 0), Position(0, 1)),
            severity=DiagnosticSeverity.ERROR,
        )
        warning = Diagnostic(
            message="Warning",
            source_range=SourceRange(Position(0, 0), Position(0, 1)),
            severity=DiagnosticSeverity.WARNING,
        )

        assert error.severity == DiagnosticSeverity.ERROR
        assert warning.severity == DiagnosticSeverity.WARNING
        assert error.to_lsp()["severity"] == 1
        assert warning.to_lsp()["severity"] == 2


class TestDiagnosticCollector:
    """Test DiagnosticCollector class."""

    def test_add_diagnostic(self):
        collector = DiagnosticCollector()
        collector.add_error(
            "Test error", SourceRange(Position(0, 0), Position(0, 5)), "TEST_001"
        )

        assert len(collector.diagnostics) == 1
        assert collector.diagnostics[0].message == "Test error"
        assert collector.diagnostics[0].code == "TEST_001"

    def test_add_multiple_diagnostics(self):
        collector = DiagnosticCollector()
        collector.add_error("Error 1", SourceRange(Position(0, 0), Position(0, 5)))
        collector.add_warning("Warning 1", SourceRange(Position(1, 0), Position(1, 5)))

        assert len(collector.diagnostics) == 2
        assert collector.has_errors()

    def test_has_errors(self):
        collector = DiagnosticCollector()
        assert not collector.has_errors()

        collector.add_warning("Warning", SourceRange(Position(0, 0), Position(0, 5)))
        assert not collector.has_errors()

        collector.add_error("Error", SourceRange(Position(0, 0), Position(0, 5)))
        assert collector.has_errors()

    def test_clear(self):
        collector = DiagnosticCollector()
        collector.add_error("Error", SourceRange(Position(0, 0), Position(0, 5)))
        assert len(collector.diagnostics) == 1

        collector.clear()
        assert len(collector.diagnostics) == 0
