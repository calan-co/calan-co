"""Unit tests for diagnostic message normalization/humanization."""

from temple.diagnostics import (
    Diagnostic,
    DiagnosticSeverity,
    SourceRange,
)
from temple.diagnostics import (
    Position as TemplePosition,
)
from temple_linter.diagnostic_converter import temple_to_lsp_diagnostic


def _range() -> SourceRange:
    return SourceRange(
        start=TemplePosition(0, 0),
        end=TemplePosition(0, 1),
    )


def test_humanizes_expected_end_of_template_token() -> None:
    diag = Diagnostic(
        message="Unexpected token '{% end %}'. Expected $END",
        source_range=_range(),
        severity=DiagnosticSeverity.ERROR,
        code="UNEXPECTED_TOKEN",
    )

    converted = temple_to_lsp_diagnostic(diag)
    assert "$END" not in converted.message
    assert "end of template" in converted.message


def test_humanizes_internal_expected_token_names() -> None:
    diag = Diagnostic(
        message="Unexpected token ''. Expected END_TAG, ELSE_IF_TAG, ELSE_TAG",
        source_range=_range(),
        severity=DiagnosticSeverity.ERROR,
        code="UNEXPECTED_TOKEN",
    )

    converted = temple_to_lsp_diagnostic(diag)
    assert "END_TAG" not in converted.message
    assert "ELSE_IF_TAG" not in converted.message
    assert "`{% end %}`" in converted.message
    assert "`{% else %}`" in converted.message
    assert "`{% elif ... %}`" in converted.message


def test_humanizes_unexpected_fragment_with_newline() -> None:
    diag = Diagnostic(
        message="Unexpected token 'en %}\n'. Expected IF, INCLUDE, FOR, SET",
        source_range=_range(),
        severity=DiagnosticSeverity.ERROR,
        code="UNEXPECTED_TOKEN",
    )

    converted = temple_to_lsp_diagnostic(diag)
    assert "\n" not in converted.message
    assert "`en %}`" in converted.message
    assert "`if`" in converted.message
    assert "`include`" in converted.message
