"""
temple.diagnostics
Parser-agnostic diagnostic types for error reporting.

Provides error, warning, and info diagnostics with source positions
and LSP format conversion. Used by both lark_parser and temple-linter.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import (
    List,
    Optional,
    Dict,
    Any,
    Tuple,
    Sequence,
    overload,
    Union,
)
from enum import Enum

from .range_utils import make_source_range


@dataclass(frozen=True)
class Position(Sequence[int]):
    """Position in source text (0-indexed).

    Implements a minimal `Sequence` interface so `Position` can be
    unpacked/indexed like a `(line, column)` tuple while remaining
    immutable.
    """

    line: int
    column: int

    # Backwards-compatible alias used in source_map and tests
    @property
    def col(self) -> int:
        return self.column

    def to_lsp(self) -> Dict[str, int]:
        """Convert to LSP Position format (0-indexed)."""
        return {"line": self.line, "character": self.column}

    def __str__(self) -> str:
        return f"{self.line + 1}:{self.column + 1}"  # Human-readable (1-indexed)

    # Sequence protocol (tuple-like behavior)
    def __len__(self) -> int:  # type: ignore[override]
        return 2

    @overload
    def __getitem__(self, index: int) -> int:  # pragma: no cover - typing only
        ...

    @overload
    def __getitem__(
        self, index: slice
    ) -> Tuple[int, ...]:  # pragma: no cover - typing only
        ...

    def __getitem__(self, index: Union[int, slice]):
        if isinstance(index, int):
            if index == 0:
                return self.line
            if index == 1:
                return self.column
            raise IndexError("Position index out of range")
        # slice -> return tuple of ints
        start = 0 if index.start is None else index.start
        stop = 2 if index.stop is None else index.stop
        step = 1 if index.step is None else index.step
        vals = (self.line, self.column)
        return tuple(vals[start:stop:step])


@dataclass(frozen=True)
class SourceRange(Sequence["Position"]):
    """Range in source text.

    Sequence-like (start, end) for convenient unpacking/indexing while
    remaining immutable.
    """

    start: Position
    end: Position

    def to_lsp(self) -> Dict[str, Dict[str, int]]:
        """Convert to LSP Range format."""
        return {"start": self.start.to_lsp(), "end": self.end.to_lsp()}

    def __str__(self) -> str:
        return f"{self.start}-{self.end}"

    @classmethod
    def from_any(cls, value: Any = None, *, allow_duck: bool = True) -> "SourceRange":
        """Construct a canonical SourceRange from several accepted shapes.

        Accepts a single argument `value` which may be:
        - a `SourceRange` (returned as-is)
        - a `(line, col)` tuple or list -> treated as start tuple
        - any other object (duck-typed) with `.start`/`.end` attributes

        This centralizes duck-typing so callers can pass a single value
        without worrying about tuple vs. SourceRange vs. duck-typed objects.
        """
        # If caller passed a SourceRange, return it
        from .diagnostics import SourceRange as _SourceRange  # local alias for clarity

        if isinstance(value, _SourceRange):
            return value

        # If tuple/list of two ints, treat as start tuple
        if isinstance(value, (tuple, list)) and len(value) == 2:
            return make_source_range(start=(int(value[0]), int(value[1])))

        # Fallback: delegate to make_source_range which supports duck-typed objects
        return make_source_range(source_range=value, allow_duck=allow_duck)

    # Sequence protocol
    def __len__(self) -> int:  # type: ignore[override]
        return 2

    @overload
    def __getitem__(self, index: int) -> "Position":  # pragma: no cover - typing only
        ...

    @overload
    def __getitem__(
        self, index: slice
    ) -> Tuple["Position", ...]:  # pragma: no cover - typing only
        ...

    def __getitem__(self, index: Union[int, slice]):
        if isinstance(index, int):
            if index == 0:
                return self.start
            if index == 1:
                return self.end
            raise IndexError("SourceRange index out of range")
        # slice -> return tuple of Positions
        start = 0 if index.start is None else index.start
        stop = 2 if index.stop is None else index.stop
        step = 1 if index.step is None else index.step
        vals = (self.start, self.end)
        return tuple(vals[start:stop:step])


class DiagnosticSeverity(Enum):
    """Diagnostic severity levels matching LSP specification."""

    ERROR = 1
    WARNING = 2
    INFORMATION = 3
    HINT = 4


class DiagnosticTag(Enum):
    """Optional tags for diagnostics."""

    UNNECESSARY = 1
    DEPRECATED = 2


@dataclass
class DiagnosticRelatedInformation:
    """Related information for a diagnostic."""

    message: str
    location_uri: str
    location_range: SourceRange


@dataclass
class Diagnostic:
    """Represents a single diagnostic message (error, warning, etc.)."""

    message: str
    source_range: SourceRange
    severity: DiagnosticSeverity = DiagnosticSeverity.ERROR
    code: Optional[str] = None
    source: str = "temple-compiler"
    related_information: List[DiagnosticRelatedInformation] = field(
        default_factory=list
    )
    tags: List[DiagnosticTag] = field(default_factory=list)
    data: Dict[str, Any] = field(default_factory=dict)
    # Backwards-compatible convenience fields: allow callers to pass `start`/`end` tuples
    start: Optional[Tuple[int, int]] = None
    end: Optional[Tuple[int, int]] = None

    def __post_init__(self):
        # Normalize and validate source_range/start/end into a canonical SourceRange.
        try:
            self.source_range = make_source_range(
                source_range=self.source_range, start=self.start, end=self.end
            )
        except Exception as e:
            # Fail fast: Diagnostics must have a valid source range.
            raise ValueError(
                f"Diagnostic missing or invalid source position: {e}. Provide `source_range` or `start`/`end` tuples."
            )

        # Canonical tuples for convenience
        self.start = (self.source_range.start.line, self.source_range.start.column)
        self.end = (self.source_range.end.line, self.source_range.end.column)

    def to_lsp(self) -> Dict[str, Any]:
        """Convert to LSP Diagnostic format.

        Returns:
            Dict with LSP diagnostic fields (range, message, severity, etc.)
        """
        diagnostic: Dict[str, Any] = {
            "range": self.source_range.to_lsp(),
            "message": self.message,
            "severity": self.severity.value,
            "source": self.source,
        }

        if self.code:
            diagnostic["code"] = self.code

        if self.related_information:
            related_list: List[Dict[str, Any]] = []
            for ri in self.related_information:
                related_list.append(
                    {
                        "message": ri.message,
                        "location": {
                            "uri": ri.location_uri,
                            "range": ri.location_range.to_lsp(),
                        },
                    }
                )
            diagnostic["relatedInformation"] = related_list

        if self.tags:
            diagnostic["tags"] = [tag.value for tag in self.tags]

        if self.data:
            diagnostic["data"] = self.data

        return diagnostic

    def to_string(
        self, source_text: Optional[str] = None, include_context: bool = True
    ) -> str:
        """Format diagnostic as human-readable string.

        Args:
            source_text: Full source text for context extraction
            include_context: Whether to include source snippet

        Returns:
            Formatted diagnostic string
        """
        severity_str = {
            DiagnosticSeverity.ERROR: "error",
            DiagnosticSeverity.WARNING: "warning",
            DiagnosticSeverity.INFORMATION: "info",
            DiagnosticSeverity.HINT: "hint",
        }[self.severity]

        code_str = f"[{self.code}] " if self.code else ""
        result = f"{severity_str}: {code_str}{self.message} at {self.source_range}"

        if include_context and source_text:
            lines = source_text.split("\n")
            start_line = self.source_range.start.line
            if 0 <= start_line < len(lines):
                line_content = lines[start_line]
                result += f"\n  {start_line + 1} | {line_content}"
                # Add caret indicator
                col = self.source_range.start.column
                result += f"\n    | {' ' * col}^"

        return result


class DiagnosticCollector:
    """Simple collector for diagnostics (parsing/analysis errors and warnings).

    Aggregates all diagnostics in a single list with convenient methods
    for adding errors and warnings.
    """

    def __init__(self):
        self._diagnostics: List[Diagnostic] = []

    def add(self, diagnostic: Diagnostic) -> None:
        """Add a diagnostic.

        Args:
            diagnostic: The diagnostic to add
        """
        self._diagnostics.append(diagnostic)

    def add_error(
        self,
        message: str,
        source_range: SourceRange,
        code: Optional[str] = None,
    ) -> None:
        """Add an error diagnostic.

        Args:
            message: Error message
            source_range: Source location
            code: Optional error code
        """
        self.add(
            Diagnostic(
                message=message,
                source_range=source_range,
                severity=DiagnosticSeverity.ERROR,
                code=code,
            )
        )

    def add_warning(
        self,
        message: str,
        source_range: SourceRange,
        code: Optional[str] = None,
    ) -> None:
        """Add a warning diagnostic.

        Args:
            message: Warning message
            source_range: Source location
            code: Optional warning code
        """
        self.add(
            Diagnostic(
                message=message,
                source_range=source_range,
                severity=DiagnosticSeverity.WARNING,
                code=code,
            )
        )

    def has_errors(self) -> bool:
        """Check if any errors were collected."""
        return any(d.severity == DiagnosticSeverity.ERROR for d in self._diagnostics)

    @property
    def diagnostics(self) -> Tuple[Diagnostic, ...]:
        """Get all diagnostics as an immutable tuple.

        Returns:
            Immutable tuple of diagnostics (prevents accidental mutations)
        """
        return tuple(self._diagnostics)

    def clear(self):
        """Clear all diagnostics."""
        self._diagnostics.clear()

    def serialize(self) -> List[Dict[str, Any]]:
        """Serialize all diagnostics to LSP-like dicts."""
        return [{"diagnostic": d.to_lsp()} for d in self._diagnostics]


__all__ = [
    "Position",
    "SourceRange",
    "Diagnostic",
    "DiagnosticSeverity",
    "DiagnosticTag",
    "DiagnosticRelatedInformation",
    "DiagnosticCollector",
]
