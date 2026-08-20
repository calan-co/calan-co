from __future__ import annotations

from typing import Optional, Tuple, Protocol, TYPE_CHECKING
import warnings

# Import diagnostics types lazily to avoid circular imports


if TYPE_CHECKING:
    from .diagnostics import Position, SourceRange


class RangeLike(Protocol):
    start: "Position"
    end: "Position"


def make_source_range(
    source_range: Optional[object] = None,
    start: Optional[Tuple[int, int]] = None,
    end: Optional[Tuple[int, int]] = None,
    allow_duck: bool = True,
) -> "SourceRange":
    """Normalize various range-like inputs into a canonical SourceRange.

    Accepts either a SourceRange, a (start,) or (start,end) tuple pair, or
    a duck-typed object with `.start`/`.end` Position-like attributes when
    `allow_duck` is True.

    Raises:
        TypeError or ValueError on invalid inputs.
    """
    # Import types here to avoid circular import at module import time
    from .diagnostics import Position, SourceRange  # local import

    # If already a SourceRange
    if isinstance(source_range, SourceRange):
        return source_range

    # If start tuple provided, use it (end optional)
    if start is not None:
        if not (
            isinstance(start, (tuple, list))
            and len(start) == 2
            and isinstance(start[0], int)
            and isinstance(start[1], int)
        ):
            raise TypeError("start must be a tuple of two ints")
        s = Position(start[0], start[1])
        if end is None:
            e = s
        else:
            if not (
                isinstance(end, (tuple, list))
                and len(end) == 2
                and isinstance(end[0], int)
                and isinstance(end[1], int)
            ):
                raise TypeError("end must be a tuple of two ints")
            e = Position(end[0], end[1])
        return SourceRange(s, e)

    # Allow duck-typed source_range-like objects for backward compatibility
    if allow_duck and source_range is not None:
        # try .start/.end attributes
        if hasattr(source_range, "start") and hasattr(source_range, "end"):
            s = getattr(source_range, "start")
            e = getattr(source_range, "end")
            if isinstance(s, Position) and isinstance(e, Position):
                warnings.warn(
                    "Passing Range-like objects is deprecated; provide a SourceRange or start/end tuples",
                    DeprecationWarning,
                    stacklevel=3,
                )
                return SourceRange(s, e)
            # support objects where start has .line/.column or .line/.col
            try:
                s_line = getattr(s, "line")
                s_col = getattr(s, "column", getattr(s, "col", None))
                e_line = getattr(e, "line")
                e_col = getattr(e, "column", getattr(e, "col", None))
                if all(isinstance(x, int) for x in (s_line, s_col, e_line, e_col)):
                    warnings.warn(
                        "Passing duck-typed range objects is deprecated; provide a SourceRange or start/end tuples",
                        DeprecationWarning,
                        stacklevel=3,
                    )
                    return SourceRange(Position(s_line, s_col), Position(e_line, e_col))
            except Exception:
                pass

    raise ValueError(
        "No valid source position provided; pass `source_range` or `start`/`end` tuples"
    )
