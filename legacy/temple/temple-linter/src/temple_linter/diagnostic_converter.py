"""
diagnostic_converter.py
Convert temple core diagnostics to LSP format.
"""

import re

from lsprotocol.types import (
    Diagnostic as LspDiagnostic,
)
from lsprotocol.types import (
    DiagnosticSeverity as LspSeverity,
)
from lsprotocol.types import (
    Position,
    Range,
)

from temple.diagnostics import Diagnostic, DiagnosticSeverity, SourceRange

_TOKEN_LABELS = {
    "$END": "end of template",
    "END_TAG": "`{% end %}`",
    "ELSE_TAG": "`{% else %}`",
    "ELSE_IF_TAG": "`{% elif ... %}`",
    "IF": "`if`",
    "FOR": "`for`",
    "INCLUDE": "`include`",
    "SET": "`set`",
    "_EXPR_CLOSE": "`}}`",
    "_STMT_CLOSE": "`%}`",
    "_COMMENT_CLOSE": "`#}`",
}
EOF_TOKEN_VARIANTS = {"''", '""', "", "<EOF>", "$END"}


def _humanize_token_name(token: str) -> str:
    stripped = token.replace("\r", "").replace("\n", "").strip()
    if stripped in EOF_TOKEN_VARIANTS:
        return "end of template"
    known = _TOKEN_LABELS.get(stripped)
    if known is not None:
        return known
    return f"`{stripped}`"


def _humanize_expected_list(expected: str) -> str:
    tokens = [part.strip() for part in expected.split(",") if part.strip()]
    readable = [_humanize_token_name(token) for token in tokens]
    if not readable:
        return expected
    if len(readable) == 1:
        return readable[0]
    return ", ".join(readable[:-1]) + f" or {readable[-1]}"


def _humanize_parser_message(message: str) -> str:
    if not message:
        return message

    unexpected_match = re.match(
        r"Unexpected token '(.*?)'\. Expected (.+)$",
        message,
        flags=re.DOTALL,
    )
    if unexpected_match:
        raw_token = unexpected_match.group(1)
        expected = unexpected_match.group(2)
        token = _humanize_token_name(raw_token)
        expected_readable = _humanize_expected_list(expected)
        if token == "end of template":
            return f"Unexpected end of template. Expected {expected_readable}."
        return f"Unexpected token {token}. Expected {expected_readable}."

    # Fallback: best-effort token-label replacements.
    updated = message
    for token_name, label in _TOKEN_LABELS.items():
        # Use lookarounds so tokens with non-word chars (e.g. "$END") still match.
        pattern = rf"(?<![A-Za-z0-9_]){re.escape(token_name)}(?![A-Za-z0-9_])"
        updated = re.sub(pattern, label, updated)
    return updated


def temple_to_lsp_diagnostic(diag: Diagnostic) -> LspDiagnostic:
    """
    Convert temple Diagnostic to LSP Diagnostic.

    Args:
        diag: Temple core Diagnostic object

    Returns:
        LSP Diagnostic for editor display

    Example:
        >>> from temple.diagnostics import Diagnostic, DiagnosticSeverity, SourceRange, Position as TemplePosition
        >>> temple_diag = Diagnostic(
        ...     message="Unclosed block",
        ...     severity=DiagnosticSeverity.ERROR,
        ...     source_range=SourceRange(TemplePosition(0, 0), TemplePosition(0, 10)),
        ...     code="UNCLOSED_BLOCK"
        ... )
        >>> lsp_diag = temple_to_lsp_diagnostic(temple_diag)
        >>> lsp_diag.severity == LspSeverity.Error
        True
    """
    severity_map = {
        DiagnosticSeverity.ERROR: LspSeverity.Error,
        DiagnosticSeverity.WARNING: LspSeverity.Warning,
        DiagnosticSeverity.INFORMATION: LspSeverity.Information,
        DiagnosticSeverity.HINT: LspSeverity.Hint,
    }

    # Convert source range to LSP range
    lsp_range = source_range_to_lsp_range(diag.source_range)

    return LspDiagnostic(
        range=lsp_range,
        severity=severity_map.get(diag.severity, LspSeverity.Error),
        code=diag.code,
        source=diag.source or "temple",
        message=_humanize_parser_message(diag.message),
    )


def source_range_to_lsp_range(source_range: SourceRange | None) -> Range:
    """
    Convert temple SourceRange to LSP Range.

    Args:
        source_range: Temple SourceRange or None

    Returns:
        LSP Range (defaults to 0,0 if source_range is None)
    """
    if source_range is None:
        return Range(
            start=Position(line=0, character=0),
            end=Position(line=0, character=0),
        )

    return Range(
        start=Position(
            line=source_range.start.line,
            character=source_range.start.column,
        ),
        end=Position(
            line=source_range.end.line,
            character=source_range.end.column,
        ),
    )
