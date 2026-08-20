from __future__ import annotations

import pathlib
import sys

from lsprotocol.types import Diagnostic, Position, Range

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

try:
    from temple_linter.services.base_cleaning_policies import (
        MARKDOWN_EXPRESSION_PLACEHOLDER,
    )
    from temple_linter.services.diagnostic_mapping_service import (
        DiagnosticMappingService,
    )
    from temple_linter.services.token_cleaning_service import TokenCleaningService
except Exception:
    ROOT = pathlib.Path(__file__).resolve().parents[1]
    SRC = ROOT / "src"
    if str(SRC) not in sys.path:
        sys.path.insert(0, str(SRC))

    from temple_linter.services.base_cleaning_policies import (
        MARKDOWN_EXPRESSION_PLACEHOLDER,
    )
    from temple_linter.services.diagnostic_mapping_service import (
        DiagnosticMappingService,
    )
    from temple_linter.services.token_cleaning_service import TokenCleaningService


def test_markdown_projection_handles_trimmed_trailing_newline_case() -> None:
    service = TokenCleaningService()
    template = """# {{ user.name }}

{%- if user.website %}
- Website: {{ user.website }}
{% end %}

*Last updated: {{ metadata.updated_at -}}*
"""

    projection = service.project_for_base_lint(template, format_hint="markdown")

    assert len(projection.cleaned_to_source_offsets) == len(projection.cleaned_text)
    assert MARKDOWN_EXPRESSION_PLACEHOLDER in projection.cleaned_text
    for line in projection.cleaned_text.splitlines():
        assert line == line.rstrip(" \t")


def test_projection_maps_placeholder_back_to_expression_content() -> None:
    service = TokenCleaningService()
    template = "Hello {{ user.name }} world\n"
    projection = service.project_for_base_lint(template, format_hint="markdown")

    cleaned_index = projection.cleaned_text.index(MARKDOWN_EXPRESSION_PLACEHOLDER)
    mapped_line, mapped_char = projection.map_cleaned_position_to_source(
        0,
        cleaned_index,
    )
    assert mapped_line == 0
    assert mapped_char == template.index("user")


def test_diagnostic_mapping_uses_projection_snapshot() -> None:
    service = TokenCleaningService()
    mapper = DiagnosticMappingService()
    template = "### {{ project.name }}\n"
    projection = service.project_for_base_lint(template, format_hint="markdown")

    placeholder_col = projection.cleaned_text.splitlines()[0].index(
        MARKDOWN_EXPRESSION_PLACEHOLDER
    )
    placeholder_len = len(MARKDOWN_EXPRESSION_PLACEHOLDER)
    diagnostics = [
        Diagnostic(
            range=Range(
                start=Position(line=0, character=placeholder_col),
                end=Position(line=0, character=placeholder_col + placeholder_len),
            ),
            message="example",
            source="markdownlint",
        )
    ]

    mapped = mapper.map_diagnostics(diagnostics, projection)
    assert len(mapped) == 1
    assert mapped[0].range.start.line == 0
    assert mapped[0].range.start.character == template.index("project")
