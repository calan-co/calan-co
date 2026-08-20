"""
temple.compiler.type_errors
Type error definitions and reporting.

Maps type errors to source positions with actionable suggestions.
"""

from dataclasses import dataclass
from typing import Optional, List
from temple.diagnostics import SourceRange


class TypeErrorKind:
    """Type error categories."""

    TYPE_MISMATCH = "type_mismatch"
    UNDEFINED_VARIABLE = "undefined_variable"
    MISSING_PROPERTY = "missing_property"
    INVALID_CONSTRAINT = "invalid_constraint"
    SCHEMA_VIOLATION = "schema_violation"
    CIRCULAR_REFERENCE = "circular_reference"
    INCOMPATIBLE_TYPES = "incompatible_types"


@dataclass
class TypeError:
    """Represents a type error with source location."""

    kind: str
    message: str
    source_range: SourceRange
    expected_type: Optional[str] = None
    actual_type: Optional[str] = None
    suggestion: Optional[str] = None

    def to_diagnostic(self) -> dict:
        """Convert to LSP diagnostic format."""
        return {
            "range": self.source_range.to_lsp(),
            "severity": 1,  # Error
            "message": self.message,
            "source": "temple-type-checker",
            "code": self.kind,
            "relatedInformation": self._get_related_info(),
        }

    def _get_related_info(self) -> List[dict]:
        """Get related information for the error."""
        info = []

        if self.expected_type:
            info.append({"message": f"Expected type: {self.expected_type}"})

        if self.actual_type:
            info.append({"message": f"Actual type: {self.actual_type}"})

        if self.suggestion:
            info.append({"message": f"Suggestion: {self.suggestion}"})

        return info

    def format_error(self, source_text: Optional[str] = None) -> str:
        """Format error with source context for CLI output."""
        lines = [f"TypeError ({self.kind}): {self.message}"]
        lines.append(
            f"  at line {self.source_range.start.line + 1}, column {self.source_range.start.col + 1}"
        )

        if source_text:
            context = self._extract_context(source_text)
            if context:
                lines.append("")
                lines.extend(context)

        if self.expected_type:
            lines.append(f"  Expected: {self.expected_type}")

        if self.actual_type:
            lines.append(f"  Actual: {self.actual_type}")

        if self.suggestion:
            lines.append(f"  💡 {self.suggestion}")

        return "\n".join(lines)

    def _extract_context(self, source_text: str, context_lines: int = 2) -> List[str]:
        """Extract source context around the error."""
        lines = source_text.split("\n")
        error_line = self.source_range.start.line

        # Clamp to valid range
        start_line = max(0, error_line - context_lines)
        end_line = min(len(lines), error_line + context_lines + 1)

        context = []
        for i in range(start_line, end_line):
            line_num = i + 1
            prefix = "→ " if i == error_line else "  "
            context.append(f"{prefix}{line_num:4d} | {lines[i]}")

            # Add pointer to error column
            if i == error_line:
                pointer_line = " " * 8 + " " * self.source_range.start.col + "^"
                if self.source_range.end.line == error_line:
                    width = self.source_range.end.col - self.source_range.start.col
                    if width > 1:
                        pointer_line += "~" * (width - 1)
                context.append(pointer_line)

        return context


class TypeErrorCollector:
    """Collects type errors during type checking."""

    def __init__(self):
        self.errors: List[TypeError] = []

    def add_error(
        self,
        kind: str,
        message: str,
        source_range: SourceRange,
        expected_type: Optional[str] = None,
        actual_type: Optional[str] = None,
        suggestion: Optional[str] = None,
    ):
        """Add a type error."""
        error = TypeError(
            kind=kind,
            message=message,
            source_range=source_range,
            expected_type=expected_type,
            actual_type=actual_type,
            suggestion=suggestion,
        )
        self.errors.append(error)

    def add_type_mismatch(
        self, source_range: SourceRange, expected: str, actual: str, context: str = ""
    ):
        """Add a type mismatch error."""
        message = f"Type mismatch{': ' + context if context else ''}"
        suggestion = self._suggest_type_fix(expected, actual)

        self.add_error(
            kind=TypeErrorKind.TYPE_MISMATCH,
            message=message,
            source_range=source_range,
            expected_type=expected,
            actual_type=actual,
            suggestion=suggestion,
        )

    def add_undefined_variable(
        self, source_range: SourceRange, var_name: str, available_vars: List[str] = None
    ):
        """Add an undefined variable error."""
        message = f"Undefined variable '{var_name}'"
        suggestion = None

        if available_vars:
            # Find closest match
            closest = self._find_closest_match(var_name, available_vars)
            if closest:
                suggestion = f"Did you mean '{closest}'?"

        self.add_error(
            kind=TypeErrorKind.UNDEFINED_VARIABLE,
            message=message,
            source_range=source_range,
            suggestion=suggestion,
        )

    def add_missing_property(
        self,
        source_range: SourceRange,
        property_name: str,
        object_type: str,
        available_properties: List[str] = None,
    ):
        """Add a missing property error."""
        message = f"Property '{property_name}' does not exist on type '{object_type}'"
        suggestion = None

        if available_properties:
            closest = self._find_closest_match(property_name, available_properties)
            if closest:
                suggestion = f"Did you mean '{closest}'?"

        self.add_error(
            kind=TypeErrorKind.MISSING_PROPERTY,
            message=message,
            source_range=source_range,
            suggestion=suggestion,
        )

    def add_schema_violation(self, source_range: SourceRange, schema_error: str):
        """Add a schema violation error."""
        self.add_error(
            kind=TypeErrorKind.SCHEMA_VIOLATION,
            message=f"Schema violation: {schema_error}",
            source_range=source_range,
        )

    def has_errors(self) -> bool:
        """Check if any errors were collected."""
        return len(self.errors) > 0

    def format_all(self, source_text: Optional[str] = None) -> str:
        """Format all errors as a single string."""
        if not self.errors:
            return "No type errors"

        lines = [f"Found {len(self.errors)} type error(s):\n"]
        for i, error in enumerate(self.errors, 1):
            lines.append(f"{i}. {error.format_error(source_text)}")
            lines.append("")

        return "\n".join(lines)

    def to_diagnostics(self) -> List[dict]:
        """Convert all errors to LSP diagnostic format."""
        return [error.to_diagnostic() for error in self.errors]

    @staticmethod
    def _suggest_type_fix(expected: str, actual: str) -> Optional[str]:
        """Suggest a fix for type mismatch."""
        # String/number conversions
        if expected == "string" and actual == "number":
            return "Use string conversion or format the number"
        if expected == "number" and actual == "string":
            return "Parse the string to a number"

        # Array/object confusion
        if expected == "array" and actual == "object":
            return "Wrap the object in an array or change schema to expect object"
        if expected == "object" and actual == "array":
            return "Access array element or change schema to expect array"

        # Optional/null handling
        if expected.startswith("optional") and actual == "null":
            return "Value is null but required; provide a default value"

        return None

    @staticmethod
    def _find_closest_match(target: str, candidates: List[str]) -> Optional[str]:
        """Find closest matching string using simple distance metric."""
        if not candidates:
            return None

        # Simple Levenshtein-like distance
        def distance(s1: str, s2: str) -> int:
            if len(s1) > len(s2):
                s1, s2 = s2, s1
            distances = range(len(s1) + 1)
            for i2, c2 in enumerate(s2):
                new_distances = [i2 + 1]
                for i1, c1 in enumerate(s1):
                    if c1 == c2:
                        new_distances.append(distances[i1])
                    else:
                        new_distances.append(
                            1 + min(distances[i1], distances[i1 + 1], new_distances[-1])
                        )
                distances = new_distances
            return distances[-1]

        # Find candidate with minimum distance
        closest = min(candidates, key=lambda c: distance(target.lower(), c.lower()))

        # Only suggest if distance is reasonable
        if distance(target.lower(), closest.lower()) <= 3:
            return closest

        return None
