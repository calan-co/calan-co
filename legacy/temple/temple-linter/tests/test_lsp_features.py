"""Unit tests for Temple Language Server language feature providers."""

from pathlib import Path

from lsprotocol.types import Position

from temple.compiler.schema import SchemaParser
from temple_linter.lsp_features import (
    TemplateCompletionProvider,
    TemplateDefinitionProvider,
    TemplateHoverProvider,
    TemplateReferenceProvider,
    TemplateRenameProvider,
)


def _semantic_schema() -> tuple[object, dict]:
    raw = {
        "type": "object",
        "properties": {
            "user": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Display name",
                    },
                    "email": {"type": "string"},
                },
            }
        },
    }
    return SchemaParser.from_json_schema(raw), raw


def test_completion_returns_schema_properties() -> None:
    schema, _ = _semantic_schema()
    provider = TemplateCompletionProvider()

    completions = provider.get_completions(
        "{{ user.na }}",
        Position(line=0, character=10),
        schema=schema,
    )

    labels = {item.label for item in completions.items}
    assert "name" in labels


def test_completion_handles_unclosed_expression_while_typing() -> None:
    schema, _ = _semantic_schema()
    provider = TemplateCompletionProvider()

    completions = provider.get_completions(
        "{{ user.na",
        Position(line=0, character=10),
        schema=schema,
    )

    labels = {item.label for item in completions.items}
    assert "name" in labels


def test_completion_returns_statement_keywords() -> None:
    provider = TemplateCompletionProvider()

    completions = provider.get_completions(
        "{% in %}",
        Position(line=0, character=5),
        schema=None,
    )

    labels = {item.label for item in completions.items}
    assert "include" in labels


def test_completion_handles_trimmed_statement_while_typing() -> None:
    provider = TemplateCompletionProvider()

    completions = provider.get_completions(
        "{%- inc",
        Position(line=0, character=7),
        schema=None,
    )

    labels = {item.label for item in completions.items}
    assert "include" in labels


def test_completion_uses_semantic_context_without_schema() -> None:
    provider = TemplateCompletionProvider()

    completions = provider.get_completions(
        "{{ user.na }}",
        Position(line=0, character=10),
        schema=None,
        semantic_context={"user": {"name": "Alice", "nickname": "Al"}},
    )

    labels = {item.label for item in completions.items}
    assert "name" in labels


def test_hover_shows_type_and_description() -> None:
    schema, raw_schema = _semantic_schema()
    provider = TemplateHoverProvider()

    hover = provider.get_hover(
        "{{ user.name }}",
        Position(line=0, character=8),
        schema=schema,
        raw_schema=raw_schema,
    )

    assert hover is not None
    assert "string" in hover.contents.value
    assert "Display name" in hover.contents.value


def test_definition_resolves_include_file(tmp_path: Path) -> None:
    main_file = tmp_path / "templates" / "main.html.tmpl"
    include_file = tmp_path / "templates" / "includes" / "header.html.tmpl"
    include_file.parent.mkdir(parents=True, exist_ok=True)
    main_file.parent.mkdir(parents=True, exist_ok=True)
    main_file.write_text("{% include 'includes/header.html' %}", encoding="utf-8")
    include_file.write_text("<header>Hello</header>", encoding="utf-8")

    provider = TemplateDefinitionProvider()
    locations = provider.get_definition(
        text=main_file.read_text(encoding="utf-8"),
        position=Position(line=0, character=23),
        current_uri=main_file.as_uri(),
        workspace_root=tmp_path,
        temple_extensions=[".tmpl", ".template"],
    )

    assert locations
    assert locations[0].uri == include_file.as_uri()


def test_definition_resolves_trimmed_include_file(tmp_path: Path) -> None:
    main_file = tmp_path / "templates" / "main.html.tmpl"
    include_file = tmp_path / "templates" / "includes" / "header.html.tmpl"
    include_file.parent.mkdir(parents=True, exist_ok=True)
    main_file.parent.mkdir(parents=True, exist_ok=True)
    main_file.write_text("{%- include 'includes/header.html' -%}", encoding="utf-8")
    include_file.write_text("<header>Hello</header>", encoding="utf-8")

    provider = TemplateDefinitionProvider()
    locations = provider.get_definition(
        text=main_file.read_text(encoding="utf-8"),
        position=Position(line=0, character=24),
        current_uri=main_file.as_uri(),
        workspace_root=tmp_path,
        temple_extensions=[".tmpl", ".template"],
    )

    assert locations
    assert locations[0].uri == include_file.as_uri()


def test_references_find_all_matching_variable_paths() -> None:
    provider = TemplateReferenceProvider()
    uri = "file:///tmp/example.tmpl"
    text = "{{ user.name }} {{ user.name }} {{ user.email }}"

    references = provider.find_references(text, Position(line=0, character=8), uri)

    assert len(references) == 2
    assert all(ref.uri == uri for ref in references)


def test_rename_produces_workspace_edits_for_all_references() -> None:
    provider = TemplateRenameProvider()
    uri = "file:///tmp/example.tmpl"
    text = "{{ user.name }} {{ user.name }}"

    edit = provider.rename(
        text=text,
        position=Position(line=0, character=8),
        new_name="user.full_name",
        current_uri=uri,
    )

    assert edit is not None
    assert uri in edit.changes
    assert len(edit.changes[uri]) == 2
    assert all(change.new_text == "user.full_name" for change in edit.changes[uri])
