"""
Temple Language Server Server - Thin adapter for Language Server Protocol

This server delegates all linting logic to service classes following
Single Responsibility Principle. See services/ directory for implementation.
"""

import json
import logging
import time
from pathlib import Path
from typing import Any

from lsprotocol.types import (
    INITIALIZE,
    TEXT_DOCUMENT_COMPLETION,
    TEXT_DOCUMENT_DEFINITION,
    TEXT_DOCUMENT_DID_CHANGE,
    TEXT_DOCUMENT_DID_OPEN,
    TEXT_DOCUMENT_DID_SAVE,
    TEXT_DOCUMENT_HOVER,
    TEXT_DOCUMENT_PREPARE_RENAME,
    TEXT_DOCUMENT_REFERENCES,
    TEXT_DOCUMENT_RENAME,
    WORKSPACE_DID_CHANGE_WATCHED_FILES,
    CompletionOptions,
    CompletionParams,
    DefinitionParams,
    DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams,
    DidOpenTextDocumentParams,
    DidSaveTextDocumentParams,
    HoverParams,
    InitializeParams,
    InitializeResult,
    PrepareRenameParams,
    PublishDiagnosticsParams,
    ReferenceParams,
    RenameOptions,
    RenameParams,
    ServerCapabilities,
    TextDocumentSyncKind,
)
from pygls.lsp.server import LanguageServer

from temple.compiler.schema import SchemaParser
from temple.defaults import DEFAULT_TEMPLATE_DELIMITERS, DEFAULT_TEMPLE_EXTENSIONS

from .lsp_features import (
    TemplateCompletionProvider,
    TemplateDefinitionProvider,
    TemplateHoverProvider,
    TemplateReferenceProvider,
    TemplateRenameProvider,
)
from .services.lint_orchestrator import LintOrchestrator
from .services.projection_snapshot import ProjectionSnapshot


class TempleLinterServer(LanguageServer):
    """LSP server for temple template linting."""

    def __init__(self) -> None:
        super().__init__("temple-linter", "v1")
        self.logger = logging.getLogger(__name__)
        self.temple_extensions = list(DEFAULT_TEMPLE_EXTENSIONS)
        self.semantic_context: dict[str, Any] | None = None
        self.semantic_schema = None
        self.semantic_schema_raw: dict[str, Any] | None = None
        self.orchestrator = LintOrchestrator(logger=self.logger)
        # Avoid blocking on expensive base-lint requests for every keystroke.
        self.base_lint_debounce_seconds = 0.8
        self._last_base_lint_at: dict[str, float] = {}
        self.completion_provider = TemplateCompletionProvider()
        self.hover_provider = TemplateHoverProvider()
        self.definition_provider = TemplateDefinitionProvider()
        self.reference_provider = TemplateReferenceProvider()
        self.rename_provider = TemplateRenameProvider()


ls = TempleLinterServer()
TEMPLE_GET_DEFAULTS_METHOD = "temple/getDefaults"
TEMPLE_GET_BASE_PROJECTION_METHOD = "temple/getBaseProjection"


def _normalize_projection_delimiters(
    raw: Any,
) -> dict[str, tuple[str, str]] | None:
    if not isinstance(raw, dict):
        return None
    normalized: dict[str, tuple[str, str]] = {}
    for token_type, value in raw.items():
        if not isinstance(token_type, str):
            continue
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            continue
        start, end = value
        if not isinstance(start, str) or not isinstance(end, str):
            continue
        normalized[token_type] = (start, end)
    return normalized or None


@ls.feature(INITIALIZE)
def on_initialize(ls: TempleLinterServer, params: InitializeParams):
    # Extract temple extensions from initialization options if provided
    if params.initialization_options:
        init_options = params.initialization_options
        temple_exts = init_options.get("templeExtensions")
        if temple_exts and isinstance(temple_exts, list):
            ls.temple_extensions = temple_exts
            ls.logger.info(f"Temple extensions configured: {temple_exts}")

        semantic_context = init_options.get("semanticContext")
        if isinstance(semantic_context, dict):
            ls.semantic_context = semantic_context or None

        semantic_schema = init_options.get("semanticSchema")
        if isinstance(semantic_schema, dict):
            try:
                ls.semantic_schema = SchemaParser.from_json_schema(semantic_schema)
                ls.semantic_schema_raw = semantic_schema
            except Exception as exc:
                ls.logger.warning("Failed to parse semanticSchema init option: %s", exc)

        schema_path_option = init_options.get("semanticSchemaPath")
        if not isinstance(schema_path_option, str) or not schema_path_option:
            schema_path_option = init_options.get("schemaPath")
        if (
            ls.semantic_schema is None
            and isinstance(schema_path_option, str)
            and schema_path_option
        ):
            try:
                schema_path = Path(schema_path_option).expanduser()
                ls.semantic_schema = SchemaParser.from_file(str(schema_path))
                ls.semantic_schema_raw = json.loads(schema_path.read_text())
            except Exception as exc:
                ls.logger.warning("Failed to load semantic schema path init option: %s", exc)

        debounce_seconds = init_options.get("baseLintDebounceSeconds")
        if isinstance(debounce_seconds, (int, float)) and debounce_seconds >= 0:
            ls.base_lint_debounce_seconds = float(debounce_seconds)

    return InitializeResult(
        capabilities=ServerCapabilities(
            text_document_sync=TextDocumentSyncKind.Incremental,
            completion_provider=CompletionOptions(trigger_characters=[".", "{", "%"]),
            hover_provider=True,
            definition_provider=True,
            references_provider=True,
            rename_provider=RenameOptions(prepare_provider=True),
            experimental={"temple/baseLint": True, "temple/getDefaults": True},
        )
    )


@ls.feature(TEMPLE_GET_DEFAULTS_METHOD)
def get_defaults(_ls: TempleLinterServer, *_args):
    return {
        "templeExtensions": list(DEFAULT_TEMPLE_EXTENSIONS),
        "templateDelimiters": {
            token_type: [start, end]
            for token_type, (start, end) in DEFAULT_TEMPLATE_DELIMITERS.items()
        },
    }


@ls.feature(TEMPLE_GET_BASE_PROJECTION_METHOD)
def get_base_projection(ls: TempleLinterServer, params: Any):
    payload = params if isinstance(params, dict) else {}
    content = payload.get("content")
    detected_format = payload.get("detectedFormat")
    delimiters = _normalize_projection_delimiters(payload.get("templateDelimiters"))

    if not isinstance(content, str):
        content = ""
    if not isinstance(detected_format, str):
        detected_format = None

    contract = ls.orchestrator.token_cleaning_service.clean_for_base_lint(
        content,
        format_hint=detected_format,
        delimiters=delimiters,
    )
    projection = ProjectionSnapshot.from_contract(
        contract,
        format_hint=detected_format,
    )
    spans = [
        {
            "startOffset": span.start_offset,
            "endOffset": span.end_offset,
            "tokenType": span.token.type,
        }
        for span in contract.token_spans
        if span.token.type != "text"
    ]
    return {
        "cleanedText": projection.cleaned_text,
        "cleanedToSourceOffsets": list(projection.cleaned_to_source_offsets),
        "sourceToCleanedOffsets": list(projection.source_to_cleaned_offsets),
        "templateTokenSpans": spans,
    }


@ls.feature(TEXT_DOCUMENT_DID_OPEN)
def did_open(ls: TempleLinterServer, params: DidOpenTextDocumentParams):
    """Handle document open event."""
    text_doc = params.text_document
    diagnostics = ls.orchestrator.lint_template(
        text_doc.text,
        text_doc.uri,
        ls,
        ls.temple_extensions,
        semantic_context=ls.semantic_context,
        semantic_schema=ls.semantic_schema,
    )
    ls.text_document_publish_diagnostics(
        PublishDiagnosticsParams(
            uri=text_doc.uri,
            diagnostics=diagnostics,
        )
    )
    ls._last_base_lint_at[text_doc.uri] = time.monotonic()


@ls.feature(TEXT_DOCUMENT_DID_CHANGE)
def did_change(ls: TempleLinterServer, params: DidChangeTextDocumentParams):
    """Handle document change event."""
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    now = time.monotonic()
    last_base_lint = ls._last_base_lint_at.get(text_doc.uri)
    include_base_lint = (
        last_base_lint is None
        or (now - last_base_lint) >= ls.base_lint_debounce_seconds
    )
    if include_base_lint:
        ls._last_base_lint_at[text_doc.uri] = now

    diagnostics = ls.orchestrator.lint_template(
        text_doc.source,
        text_doc.uri,
        ls,
        ls.temple_extensions,
        semantic_context=ls.semantic_context,
        semantic_schema=ls.semantic_schema,
        include_base_lint=include_base_lint,
    )
    ls.text_document_publish_diagnostics(
        PublishDiagnosticsParams(
            uri=text_doc.uri,
            diagnostics=diagnostics,
        )
    )


@ls.feature(TEXT_DOCUMENT_DID_SAVE)
def did_save(ls: TempleLinterServer, params: DidSaveTextDocumentParams):
    """Handle document save event."""
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    diagnostics = ls.orchestrator.lint_template(
        text_doc.source,
        text_doc.uri,
        ls,
        ls.temple_extensions,
        semantic_context=ls.semantic_context,
        semantic_schema=ls.semantic_schema,
        include_base_lint=True,
    )
    ls._last_base_lint_at[text_doc.uri] = time.monotonic()
    ls.text_document_publish_diagnostics(
        PublishDiagnosticsParams(
            uri=text_doc.uri,
            diagnostics=diagnostics,
        )
    )


@ls.feature(WORKSPACE_DID_CHANGE_WATCHED_FILES)
def did_change_watched_files(
    _ls: TempleLinterServer,
    _params: DidChangeWatchedFilesParams,
):
    """No-op handler to avoid unknown-method noise from client file watchers."""
    return None


def main() -> int:
    """Start the Temple Language Server server over stdio."""
    ls.start_io()
    return 0


@ls.feature(TEXT_DOCUMENT_COMPLETION)
def completion(ls: TempleLinterServer, params: CompletionParams):
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    return ls.completion_provider.get_completions(
        text_doc.source,
        params.position,
        schema=ls.semantic_schema,
        semantic_context=ls.semantic_context,
    )


@ls.feature(TEXT_DOCUMENT_HOVER)
def hover(ls: TempleLinterServer, params: HoverParams):
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    return ls.hover_provider.get_hover(
        text_doc.source,
        params.position,
        schema=ls.semantic_schema,
        raw_schema=ls.semantic_schema_raw,
    )


@ls.feature(TEXT_DOCUMENT_DEFINITION)
def definition(ls: TempleLinterServer, params: DefinitionParams):
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    workspace_root = getattr(ls.workspace, "root_path", None)
    root_path = Path(workspace_root) if isinstance(workspace_root, str) else None
    return ls.definition_provider.get_definition(
        text_doc.source,
        params.position,
        params.text_document.uri,
        root_path,
        ls.temple_extensions,
    )


@ls.feature(TEXT_DOCUMENT_REFERENCES)
def references(ls: TempleLinterServer, params: ReferenceParams):
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    return ls.reference_provider.find_references(
        text_doc.source,
        params.position,
        params.text_document.uri,
    )


@ls.feature(TEXT_DOCUMENT_PREPARE_RENAME)
def prepare_rename(ls: TempleLinterServer, params: PrepareRenameParams):
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    return ls.rename_provider.prepare_rename(text_doc.source, params.position)


@ls.feature(TEXT_DOCUMENT_RENAME)
def rename(ls: TempleLinterServer, params: RenameParams):
    text_doc = ls.workspace.get_text_document(params.text_document.uri)
    return ls.rename_provider.rename(
        text_doc.source,
        params.position,
        params.new_name,
        params.text_document.uri,
    )


if __name__ == "__main__":
    raise SystemExit(main())
