"""
temple.compiler.error_formatter
Human-readable error message formatting.

Formats diagnostic messages with source context, suggestions, and styling.
"""

from typing import Optional, List
from temple.diagnostics import Diagnostic, DiagnosticSeverity, SourceRange


class ErrorFormatter:
    """Formats errors as human-readable messages with context."""

    # ANSI color codes for terminal output
    COLORS = {
        "error": "\033[91m",  # Red
        "warning": "\033[93m",  # Yellow
        "info": "\033[94m",  # Blue
        "hint": "\033[92m",  # Green
        "reset": "\033[0m",  # Reset
        "bold": "\033[1m",  # Bold
        "dim": "\033[2m",  # Dim
    }

    def __init__(self, use_colors: bool = True):
        """Initialize formatter.

        Args:
            use_colors: Whether to use ANSI colors in output
        """
        self.use_colors = use_colors

    def format_diagnostic(
        self,
        diagnostic: Diagnostic,
        source_text: Optional[str] = None,
        include_context: bool = True,
        include_code: bool = True,
    ) -> str:
        """Format a single diagnostic with full context.

        Args:
            diagnostic: Diagnostic to format
            source_text: Full source text for context extraction
            include_context: Whether to show source snippet
            include_code: Whether to show error code

        Returns:
            Formatted error message
        """
        lines = []

        # Severity and message
        severity_name = {
            DiagnosticSeverity.ERROR: "error",
            DiagnosticSeverity.WARNING: "warning",
            DiagnosticSeverity.INFORMATION: "info",
            DiagnosticSeverity.HINT: "hint",
        }[diagnostic.severity]

        severity_color = {
            "error": self.COLORS["error"],
            "warning": self.COLORS["warning"],
            "info": self.COLORS["info"],
            "hint": self.COLORS["hint"],
        }[severity_name]

        # Header with color
        if self.use_colors:
            header = f"{severity_color}{diagnostic.source}: {severity_name}{self.COLORS['reset']}: {diagnostic.message}"
        else:
            header = f"{diagnostic.source}: {severity_name}: {diagnostic.message}"

        lines.append(header)

        # Location line
        loc_line = f"  → {diagnostic.source_range.start.line + 1}:{diagnostic.source_range.start.col + 1}"
        lines.append(self._colorize(loc_line, "dim") if self.use_colors else loc_line)

        # Source context
        if include_context and source_text:
            context = self._extract_context(
                source_text, diagnostic.source_range, context_lines=2
            )
            if context:
                lines.append("")
                lines.extend(context)

        # Error code
        if include_code and diagnostic.code:
            code_line = f"  code: {diagnostic.code}"
            lines.append(code_line)

        return "\n".join(lines)

    def format_diagnostics(
        self,
        diagnostics: List[Diagnostic],
        source_text: Optional[str] = None,
        include_context: bool = True,
    ) -> str:
        """Format multiple diagnostics as a report.

        Args:
            diagnostics: List of diagnostics to format
            source_text: Full source text for context extraction
            include_context: Whether to show source snippets

        Returns:
            Formatted report string
        """
        if not diagnostics:
            return "No diagnostics"

        lines = []

        # Group by severity
        by_severity = {}
        for diag in diagnostics:
            key = diag.severity.name
            if key not in by_severity:
                by_severity[key] = []
            by_severity[key].append(diag)

        # Severity order
        severity_order = ["ERROR", "WARNING", "INFORMATION", "HINT"]

        # Format each group
        for severity_name in severity_order:
            if severity_name not in by_severity:
                continue

            group = by_severity[severity_name]

            # Group header
            header = f"\n{len(group)} {severity_name.lower()}{'s' if len(group) != 1 else ''}:"
            lines.append(
                self._colorize(header, severity_name.lower())
                if self.use_colors
                else header
            )
            lines.append("")

            # Format each diagnostic
            for i, diag in enumerate(group, 1):
                formatted = self.format_diagnostic(
                    diag, source_text, include_context, include_code=True
                )

                # Indent
                indented = "\n".join(
                    f"  {line}" if line else "" for line in formatted.split("\n")
                )
                lines.append(indented)
                lines.append("")

        return "\n".join(lines)

    def _extract_context(
        self, source_text: str, source_range: SourceRange, context_lines: int = 2
    ) -> List[str]:
        """Extract source context around error location.

        Args:
            source_text: Full source text
            source_range: Error location
            context_lines: Number of lines before/after to include

        Returns:
            Formatted context lines
        """
        text_lines = source_text.split("\n")
        error_line = source_range.start.line

        # Clamp to valid range
        start_line = max(0, error_line - context_lines)
        end_line = min(len(text_lines), error_line + context_lines + 1)

        context = []

        # Find max line number width for alignment
        max_line_num = end_line
        line_width = len(str(max_line_num))

        for i in range(start_line, end_line):
            if i >= len(text_lines):
                break

            line_num = i + 1
            line_text = text_lines[i]

            # Highlight error line
            if i == error_line:
                prefix = self._colorize("→", "error") if self.use_colors else "→"
            else:
                prefix = " "

            # Line with number
            line_num_str = str(line_num).rjust(line_width)
            context.append(f"  {prefix} {line_num_str} │ {line_text}")

            # Add pointer for error line
            if i == error_line:
                pointer_col = source_range.start.col
                end_col = (
                    source_range.end.col
                    if source_range.end.line == error_line
                    else pointer_col + 1
                )

                # Build pointer line
                pointer_line = " " * (5 + line_width) + "│ " + " " * pointer_col

                # Add caret(s)
                caret_color = self.COLORS["error"] if self.use_colors else ""
                reset_color = self.COLORS["reset"] if self.use_colors else ""

                if end_col > pointer_col:
                    pointer_line += f"{caret_color}^{'~' * (end_col - pointer_col - 1)}{reset_color}"
                else:
                    pointer_line += f"{caret_color}^{reset_color}"

                context.append(pointer_line)

        return context

    def _colorize(self, text: str, color_name: str) -> str:
        """Apply color to text if colors are enabled.

        Args:
            text: Text to colorize
            color_name: Color name (error, warning, info, hint, bold, dim)

        Returns:
            Colorized text or plain text
        """
        if not self.use_colors or color_name not in self.COLORS:
            return text

        color = self.COLORS[color_name]
        reset = self.COLORS["reset"]
        return f"{color}{text}{reset}"

    @staticmethod
    def strip_colors(text: str) -> str:
        """Remove ANSI color codes from text.

        Args:
            text: Text with potential color codes

        Returns:
            Text without color codes
        """
        import re

        return re.sub(r"\033\[[0-9;]*m", "", text)


class ContextRenderer:
    """Renders source context for error messages."""

    @staticmethod
    def render_line_with_pointer(
        line: str, col: int, end_col: Optional[int] = None, highlight: bool = True
    ) -> str:
        """Render a line with a pointer to the error location.

        Args:
            line: Source line text
            col: Column of error start
            end_col: Column of error end (optional)
            highlight: Whether to highlight the problematic text

        Returns:
            Formatted line with pointer
        """
        result = []

        if highlight and end_col and end_col > col:
            # Highlight the range
            result.append(line[:col])
            result.append(">>>")
            result.append(line[col:end_col])
            result.append("<<<")
            result.append(line[end_col:])
            return "".join(result)
        else:
            # Just show the line
            return line

    @staticmethod
    def render_pointer_line(
        col: int, end_col: Optional[int] = None, width: int = 1
    ) -> str:
        """Render a pointer line for an error.

        Args:
            col: Column of error start
            end_col: Column of error end
            width: Width of pointer (for multi-char errors)

        Returns:
            Pointer line string
        """
        if end_col and end_col > col:
            pointer = "^" + "~" * (end_col - col - 1)
        else:
            pointer = "^" * max(1, width)

        return " " * col + pointer

    @staticmethod
    def split_context_lines(
        source_text: str,
        start_line: int,
        end_line: int,
        context_before: int = 2,
        context_after: int = 2,
    ) -> tuple[List[str], int, int]:
        """Extract context lines around an error region.

        Args:
            source_text: Full source text
            start_line: Start line number (0-indexed)
            end_line: End line number (0-indexed)
            context_before: Lines of context before
            context_after: Lines of context after

        Returns:
            Tuple of (lines, first_line_number, last_line_number)
        """
        lines = source_text.split("\n")

        first = max(0, start_line - context_before)
        last = min(len(lines), end_line + context_after + 1)

        context_lines = lines[first:last]

        return context_lines, first, last - 1
