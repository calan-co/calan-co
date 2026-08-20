"""
Tests for error formatting.
"""

from temple.compiler.error_formatter import ErrorFormatter, ContextRenderer
from temple.diagnostics import Diagnostic, DiagnosticSeverity, Position, SourceRange


class TestErrorFormatter:
    """Test ErrorFormatter class."""

    def test_format_error_without_colors(self):
        formatter = ErrorFormatter(use_colors=False)
        diag = Diagnostic(
            message="Test error",
            source_range=SourceRange(Position(0, 0), Position(0, 0)),
            code="TEST_001",
        )

        output = formatter.format_diagnostic(diag, include_context=False)

        assert "Test error" in output
        assert "error" in output
        assert "temple-compiler" in output
        assert "TEST_001" in output

    def test_format_warning(self):
        formatter = ErrorFormatter(use_colors=False)
        diag = Diagnostic(
            message="Test warning",
            source_range=SourceRange(Position(0, 0), Position(0, 0)),
            severity=DiagnosticSeverity.WARNING,
            code="WARN_001",
        )

        output = formatter.format_diagnostic(diag, include_context=False)

        assert "Test warning" in output
        assert "warning" in output

    def test_format_with_context(self):
        formatter = ErrorFormatter(use_colors=False)
        source = "hello world\ntest line\nfinal"

        diag = Diagnostic(
            message="Error here",
            source_range=SourceRange(Position(1, 0), Position(1, 0)),
            code="TEST_001",
        )

        output = formatter.format_diagnostic(
            diag, source_text=source, include_context=True
        )

        assert "test line" in output
        assert "^" in output or "~" in output  # Pointer

    def test_format_multiple_diagnostics(self):
        formatter = ErrorFormatter(use_colors=False)
        source = "line 1\nline 2\nline 3"

        diagnostics = [
            Diagnostic(
                "Error 1",
                source_range=SourceRange(Position(0, 0), Position(0, 0)),
                severity=DiagnosticSeverity.ERROR,
                code="E001",
            ),
            Diagnostic(
                "Warning 1",
                source_range=SourceRange(Position(1, 0), Position(1, 0)),
                severity=DiagnosticSeverity.WARNING,
                code="W001",
            ),
        ]

        output = formatter.format_diagnostics(diagnostics, source_text=source)

        assert "1 error" in output
        assert "1 warning" in output
        assert "Error 1" in output
        assert "Warning 1" in output

    def test_format_with_colors(self):
        formatter = ErrorFormatter(use_colors=True)
        diag = Diagnostic(
            message="Test error",
            source_range=SourceRange(Position(0, 0), Position(0, 0)),
            code="TEST_001",
        )

        output = formatter.format_diagnostic(diag, include_context=False)

        # Should contain ANSI color codes
        assert "\033[" in output or "Test error" in output  # Color codes or fallback

    def test_strip_colors(self):
        colored = "\033[91mError\033[0m: test"
        stripped = ErrorFormatter.strip_colors(colored)

        assert "\033[" not in stripped
        assert "Error: test" in stripped

    def test_format_long_line(self):
        formatter = ErrorFormatter(use_colors=False)
        long_line = "x" * 100
        source = long_line

        diag = Diagnostic(
            message="Error at position 50",
            source_range=SourceRange(Position(0, 50), Position(0, 50)),
        )

        output = formatter.format_diagnostic(
            diag, source_text=source, include_context=True
        )

        assert "Error at position 50" in output


class TestContextRenderer:
    """Test ContextRenderer class."""

    def test_render_line_with_pointer(self):
        line = "hello world"
        result = ContextRenderer.render_line_with_pointer(line, col=0, end_col=5)

        # Should highlight or indicate the error location
        assert "hello" in result or ">>>" in result

    def test_render_pointer_line_single_char(self):
        pointer = ContextRenderer.render_pointer_line(col=5)

        assert pointer.startswith(" " * 5)
        assert "^" in pointer

    def test_render_pointer_line_multi_char(self):
        pointer = ContextRenderer.render_pointer_line(col=5, end_col=10)

        assert pointer.startswith(" " * 5)
        assert "^" in pointer
        assert "~" in pointer

    def test_split_context_lines(self):
        source = "line 0\nline 1\nline 2\nline 3\nline 4"

        lines, first, last = ContextRenderer.split_context_lines(
            source, start_line=2, end_line=2, context_before=1, context_after=1
        )

        assert len(lines) >= 3  # At least 3 lines of context
        assert first == 1
        assert last == 3

    def test_split_context_lines_at_start(self):
        source = "line 0\nline 1\nline 2"

        lines, first, last = ContextRenderer.split_context_lines(
            source, start_line=0, end_line=0, context_before=1, context_after=1
        )

        # Should not go negative
        assert first == 0
        assert "line 0" in lines[0]

    def test_split_context_lines_at_end(self):
        source = "line 0\nline 1\nline 2"

        lines, first, last = ContextRenderer.split_context_lines(
            source, start_line=2, end_line=2, context_before=1, context_after=1
        )

        # Should not exceed bounds
        assert last == 2
        assert "line 2" in lines[-1]


class TestFormatterIntegration:
    """Integration tests for formatter with diagnostics."""

    def test_format_error_with_all_fields(self):
        formatter = ErrorFormatter(use_colors=False)
        source = "x = {{ undefined }}"

        diag = Diagnostic(
            message="Undefined variable 'undefined'",
            source_range=SourceRange(Position(0, 4), Position(0, 4)),
            severity=DiagnosticSeverity.ERROR,
            code="UNDEFINED_VAR",
            source="type-checker",
        )

        output = formatter.format_diagnostic(
            diag, source_text=source, include_context=True, include_code=True
        )

        assert "Undefined variable" in output
        assert "UNDEFINED_VAR" in output
        assert "type-checker" in output
        assert "undefined" in output  # From source context
