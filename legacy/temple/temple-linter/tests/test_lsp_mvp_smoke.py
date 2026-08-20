"""MVP smoke tests for LSP initialization and language-feature flow."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from lsprotocol.types import (
    CompletionParams,
    DefinitionParams,
    DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams,
    DidOpenTextDocumentParams,
    FileChangeType,
    FileEvent,
    HoverParams,
    InitializeParams,
    Position,
    PrepareRenameParams,
    ReferenceContext,
    ReferenceParams,
    RenameParams,
    TextDocumentIdentifier,
    TextDocumentItem,
    VersionedTextDocumentIdentifier,
)

from temple.defaults import DEFAULT_TEMPLATE_DELIMITERS, DEFAULT_TEMPLE_EXTENSIONS
from temple_linter import lsp_server
from temple_linter.lsp_server import TempleLinterServer


@dataclass
class _Doc:
    uri: str
    source: str


class _Workspace:
    def __init__(self, docs: dict[str, _Doc], root_path: Path):
        self._docs = docs
        self.root_path = str(root_path)

    def get_text_document(self, uri: str) -> _Doc:
        return self._docs[uri]


def _semantic_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "user": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Display name",
                    }
                },
            }
        },
    }


def test_lsp_server_exposes_runtime_defaults() -> None:
    server = TempleLinterServer()
    defaults = lsp_server.get_defaults(server)

    assert defaults["templeExtensions"] == list(DEFAULT_TEMPLE_EXTENSIONS)
    assert defaults["templateDelimiters"] == {
        token_type: [start, end] for token_type, (start, end) in DEFAULT_TEMPLATE_DELIMITERS.items()
    }


def test_lsp_server_initialize_and_did_open_with_semantic_settings() -> None:
    server = TempleLinterServer()
    init_result = lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={
                "templeExtensions": [".tmpl", ".template"],
                "semanticSchema": _semantic_schema(),
                "semanticContext": {"user": {"name": "Alice"}},
            },
        ),
    )

    assert init_result.capabilities.completion_provider is not None
    assert init_result.capabilities.hover_provider is True
    assert init_result.capabilities.definition_provider is True
    assert init_result.capabilities.references_provider is True
    assert init_result.capabilities.rename_provider is not None

    published = {}

    def _capture(params):
        published["params"] = params

    server.text_document_publish_diagnostics = _capture  # type: ignore[method-assign]
    server.orchestrator.base_linting_service.request_base_diagnostics = lambda *_args, **_kwargs: []
    lsp_server.did_open(
        server,
        DidOpenTextDocumentParams(
            text_document=TextDocumentItem(
                uri="file:///tmp/template.tmpl",
                language_id="templ-any",
                version=1,
                text="{{ user.id }}",
            )
        ),
    )

    diagnostics = published["params"].diagnostics
    assert any(str(getattr(diag, "code", "")) == "missing_property" for diag in diagnostics)


def test_lsp_server_ignores_empty_semantic_context() -> None:
    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"semanticContext": {}},
        ),
    )

    assert server.semantic_context is None


def test_lsp_server_empty_semantic_context_does_not_emit_undefined_variable() -> None:
    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"semanticContext": {}},
        ),
    )

    published = {}

    def _capture(params):
        published["params"] = params

    server.text_document_publish_diagnostics = _capture  # type: ignore[method-assign]
    server.orchestrator.base_linting_service.request_base_diagnostics = lambda *_args, **_kwargs: []
    lsp_server.did_open(
        server,
        DidOpenTextDocumentParams(
            text_document=TextDocumentItem(
                uri="file:///tmp/template.tmpl",
                language_id="templ-any",
                version=1,
                text="{{ user.name }}",
            )
        ),
    )

    diagnostics = published["params"].diagnostics
    assert diagnostics == []


def test_lsp_server_did_open_publishes_syntax_diagnostics() -> None:
    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"templeExtensions": [".tmpl", ".template"]},
        ),
    )

    published = {}

    def _capture(params):
        published["params"] = params

    server.text_document_publish_diagnostics = _capture  # type: ignore[method-assign]
    server.orchestrator.base_linting_service.request_base_diagnostics = lambda *_args, **_kwargs: []

    lsp_server.did_open(
        server,
        DidOpenTextDocumentParams(
            text_document=TextDocumentItem(
                uri="file:///tmp/template.tmpl",
                language_id="templ-any",
                version=1,
                text="{{ user. }}",
            )
        ),
    )

    diagnostics = published["params"].diagnostics
    assert diagnostics
    assert any(diag.severity == 1 for diag in diagnostics)


def test_lsp_server_did_change_publishes_syntax_diagnostics(tmp_path: Path) -> None:
    template_path = tmp_path / "edit.tmpl"
    template_path.write_text("{{ user. }}", encoding="utf-8")
    template_uri = template_path.as_uri()

    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"templeExtensions": [".tmpl", ".template"]},
        ),
    )
    server.protocol._workspace = _Workspace(  # type: ignore[attr-defined]
        docs={template_uri: _Doc(uri=template_uri, source="{{ user. }}")},
        root_path=tmp_path,
    )

    published = {}

    def _capture(params):
        published["params"] = params

    server.text_document_publish_diagnostics = _capture  # type: ignore[method-assign]
    server.orchestrator.base_linting_service.request_base_diagnostics = lambda *_args, **_kwargs: []

    lsp_server.did_change(
        server,
        DidChangeTextDocumentParams(
            text_document=VersionedTextDocumentIdentifier(uri=template_uri, version=2),
            content_changes=[{"text": "{{ user. }}"}],
        ),
    )

    diagnostics = published["params"].diagnostics
    assert diagnostics
    assert any(diag.severity == 1 for diag in diagnostics)


def test_lsp_server_did_change_debounces_base_lint(tmp_path: Path) -> None:
    template_path = tmp_path / "debounce.tmpl"
    template_path.write_text("{{ user.name }}", encoding="utf-8")
    template_uri = template_path.as_uri()

    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"templeExtensions": [".tmpl", ".template"]},
        ),
    )
    server.protocol._workspace = _Workspace(  # type: ignore[attr-defined]
        docs={template_uri: _Doc(uri=template_uri, source="{{ user.name }}")},
        root_path=tmp_path,
    )
    server.base_lint_debounce_seconds = 60.0

    include_base_lint_calls: list[bool] = []

    def _lint_stub(
        text: str,
        uri: str,
        _transport,
        _temple_extensions,
        semantic_context=None,
        semantic_schema=None,
        include_base_lint: bool = True,
    ):
        include_base_lint_calls.append(include_base_lint)
        return []

    server.orchestrator.lint_template = _lint_stub  # type: ignore[method-assign]
    server.text_document_publish_diagnostics = lambda _params: None  # type: ignore[method-assign]

    lsp_server.did_change(
        server,
        DidChangeTextDocumentParams(
            text_document=VersionedTextDocumentIdentifier(uri=template_uri, version=2),
            content_changes=[{"text": "{{ user.name }}"}],
        ),
    )
    lsp_server.did_change(
        server,
        DidChangeTextDocumentParams(
            text_document=VersionedTextDocumentIdentifier(uri=template_uri, version=3),
            content_changes=[{"text": "{{ user.name }}"}],
        ),
    )

    assert include_base_lint_calls == [True, False]


def test_lsp_server_language_features_smoke(tmp_path: Path) -> None:
    includes_dir = tmp_path / "includes"
    includes_dir.mkdir(parents=True, exist_ok=True)
    include_file = includes_dir / "header.html.tmpl"
    include_file.write_text("<header>Hello</header>", encoding="utf-8")

    template_path = tmp_path / "main.html.tmpl"
    template_text = "\n".join(
        [
            "{% include 'includes/header.html' %}",
            "{{ user.na }}",
            "{{ user.name }} {{ user.name }}",
        ]
    )
    template_path.write_text(template_text, encoding="utf-8")
    template_uri = template_path.as_uri()

    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"semanticSchema": _semantic_schema()},
        ),
    )
    server.protocol._workspace = _Workspace(  # type: ignore[attr-defined]
        docs={template_uri: _Doc(uri=template_uri, source=template_text)},
        root_path=tmp_path,
    )

    completion_list = lsp_server.completion(
        server,
        CompletionParams(
            text_document=TextDocumentIdentifier(uri=template_uri),
            position=Position(line=1, character=10),
        ),
    )
    assert completion_list is not None
    assert "name" in {item.label for item in completion_list.items}

    hover = lsp_server.hover(
        server,
        HoverParams(
            text_document=TextDocumentIdentifier(uri=template_uri),
            position=Position(line=2, character=8),
        ),
    )
    assert hover is not None
    assert "Display name" in hover.contents.value

    definitions = lsp_server.definition(
        server,
        DefinitionParams(
            text_document=TextDocumentIdentifier(uri=template_uri),
            position=Position(line=0, character=23),
        ),
    )
    assert definitions
    assert definitions[0].uri == include_file.as_uri()

    refs = lsp_server.references(
        server,
        ReferenceParams(
            text_document=TextDocumentIdentifier(uri=template_uri),
            position=Position(line=2, character=8),
            context=ReferenceContext(include_declaration=False),
        ),
    )
    assert refs is not None
    assert len(refs) == 2

    rename_range = lsp_server.prepare_rename(
        server,
        PrepareRenameParams(
            text_document=TextDocumentIdentifier(uri=template_uri),
            position=Position(line=2, character=8),
        ),
    )
    assert rename_range is not None

    rename_edit = lsp_server.rename(
        server,
        RenameParams(
            text_document=TextDocumentIdentifier(uri=template_uri),
            position=Position(line=2, character=8),
            new_name="user.full_name",
        ),
    )
    assert rename_edit is not None
    assert template_uri in rename_edit.changes
    assert len(rename_edit.changes[template_uri]) == 2


def test_lsp_server_loads_semantic_schema_from_path(tmp_path: Path) -> None:
    schema_path = tmp_path / "template.schema.json"
    schema_path.write_text(json.dumps(_semantic_schema()), encoding="utf-8")

    server = TempleLinterServer()
    lsp_server.on_initialize(
        server,
        InitializeParams(
            capabilities={},
            initialization_options={"semanticSchemaPath": str(schema_path)},
        ),
    )

    assert server.semantic_schema is not None
    assert server.semantic_schema_raw is not None
    assert "user" in server.semantic_schema_raw.get("properties", {})


def test_lsp_server_handles_did_change_watched_files_notification() -> None:
    server = TempleLinterServer()
    params = DidChangeWatchedFilesParams(
        changes=[
            FileEvent(
                uri="file:///tmp/example.md.tmpl",
                type=FileChangeType.Created,
            )
        ]
    )

    assert lsp_server.did_change_watched_files(server, params) is None


def test_lsp_server_returns_base_projection_snapshot() -> None:
    server = TempleLinterServer()
    result = lsp_server.get_base_projection(
        server,
        {
            "content": "# {{ user.name }}\n",
            "detectedFormat": "markdown",
        },
    )

    assert isinstance(result, dict)
    assert "lorem" in result["cleanedText"]
    assert len(result["cleanedToSourceOffsets"]) == len(result["cleanedText"])
    assert len(result["sourceToCleanedOffsets"]) == len("# {{ user.name }}\n") + 1
    assert any(
        span.get("tokenType") == "expression"
        for span in result.get("templateTokenSpans", [])
    )
