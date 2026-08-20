"""LSP feature providers for Temple templates.

This module contains lightweight providers for completion, hover,
go-to-definition, references, and rename that operate on raw template text.
The implementations intentionally avoid hard dependencies on a full AST walk
so they remain responsive for partially typed templates.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from lsprotocol.types import (
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    Hover,
    Location,
    MarkupContent,
    MarkupKind,
    Position,
    Range,
    TextEdit,
    WorkspaceEdit,
)

from temple.compiler.schema import Schema
from temple.compiler.types import (
    AnyType,
    ArrayType,
    BaseType,
    BooleanType,
    NullType,
    NumberType,
    ObjectType,
    ReferenceType,
    StringType,
    TupleType,
    UnionType,
)
from temple.template_spans import (
    build_template_metadata,
    build_unclosed_span,
)

_INCLUDE_CONTENT_RE = re.compile(r"^\s*include\s+['\"](?P<name>[^'\"]+)['\"]\s*$")
_VAR_PATH_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*")


@dataclass(frozen=True)
class _TemplateSpan:
    start: int
    end: int
    content_start: int
    content_end: int
    content: str


@dataclass(frozen=True)
class VariableReference:
    path: str
    range: Range


@dataclass(frozen=True)
class IncludeReference:
    name: str
    range: Range


def _position_to_offset(text: str, position: Position) -> int:
    line = max(0, position.line)
    character = max(0, position.character)

    offset = 0
    lines_seen = 0
    for segment in text.splitlines(keepends=True):
        if lines_seen == line:
            return min(offset + character, offset + len(segment))
        offset += len(segment)
        lines_seen += 1

    if lines_seen == line:
        return min(offset + character, len(text))
    return len(text)


def _offset_to_position(text: str, offset: int) -> Position:
    bounded = max(0, min(offset, len(text)))
    line = text.count("\n", 0, bounded)
    line_start = text.rfind("\n", 0, bounded)
    col = bounded if line_start == -1 else bounded - line_start - 1
    return Position(line=line, character=col)


def _range_from_offsets(text: str, start: int, end: int) -> Range:
    return Range(
        start=_offset_to_position(text, start),
        end=_offset_to_position(text, end),
    )


def _build_spans_by_type(text: str) -> dict[str, list[_TemplateSpan]]:
    spans_by_type: dict[str, list[_TemplateSpan]] = {
        "expression": [],
        "statement": [],
    }
    token_spans, _ = build_template_metadata(text)
    for token_span in token_spans:
        token_type = token_span.token.type
        if token_type not in spans_by_type:
            continue
        spans_by_type[token_type].append(
            _TemplateSpan(
                start=token_span.start_offset,
                end=token_span.end_offset,
                content_start=token_span.content_start_offset,
                content_end=token_span.content_end_offset,
                content=text[
                    token_span.content_start_offset : token_span.content_end_offset
                ],
            )
        )
    return spans_by_type


def _find_span_at_offset(spans: list[_TemplateSpan], offset: int) -> _TemplateSpan | None:
    for span in spans:
        if span.content_start <= offset <= span.content_end:
            return span
    return None


def _find_active_span_with_unclosed_support(
    text: str,
    offset: int,
    token_type: str,
    spans: list[_TemplateSpan],
) -> _TemplateSpan | None:
    """Find a closed or active-unclosed token span at the given offset."""
    closed_span = _find_span_at_offset(spans, offset)
    if closed_span is not None:
        return closed_span

    raw = build_unclosed_span(text, offset, token_type)
    if raw is None:
        return None
    start, end, content_start, content_end = raw
    return _TemplateSpan(
        start=start,
        end=end,
        content_start=content_start,
        content_end=content_end,
        content=text[content_start:content_end],
    )


def _resolve_object_type(base_type: BaseType | None, segments: list[str]) -> BaseType | None:
    current = base_type
    for segment in segments:
        if current is None:
            return None
        if isinstance(current, ObjectType):
            current = current.properties.get(segment)
            continue
        if isinstance(current, ArrayType):
            item_type = current.item_type
            if isinstance(item_type, ObjectType):
                current = item_type.properties.get(segment)
                continue
            return None
        return None
    return current


def _type_name(value: BaseType | None) -> str:
    if value is None:
        return "unknown"
    if isinstance(value, StringType):
        return "string"
    if isinstance(value, NumberType):
        return "number"
    if isinstance(value, BooleanType):
        return "boolean"
    if isinstance(value, NullType):
        return "null"
    if isinstance(value, ArrayType):
        return "array"
    if isinstance(value, ObjectType):
        return "object"
    if isinstance(value, TupleType):
        return "tuple"
    if isinstance(value, UnionType):
        return "union"
    if isinstance(value, ReferenceType):
        return f"ref:{value.name}"
    if isinstance(value, AnyType):
        return "any"
    return value.__class__.__name__.lower()


def _resolve_schema_fragment(raw_schema: dict | None, path: str) -> dict | None:
    if raw_schema is None:
        return None

    current: object = raw_schema
    for segment in [part for part in path.split(".") if part]:
        if not isinstance(current, dict):
            return None

        if current.get("type") == "array":
            current = current.get("items")
            if not isinstance(current, dict):
                return None

        if current.get("type") != "object":
            return None

        properties = current.get("properties")
        if not isinstance(properties, dict):
            return None

        current = properties.get(segment)

    return current if isinstance(current, dict) else None


def _resolve_context_value(context: Any, segments: list[str]) -> Any:
    current = context
    for segment in segments:
        if isinstance(current, dict):
            current = current.get(segment)
            continue
        if isinstance(current, list):
            if not current:
                return None
            current = current[0]
            if isinstance(current, dict):
                current = current.get(segment)
                continue
            return None
        return None
    return current


def _context_type_name(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    if isinstance(value, str):
        return "string"
    if value is None:
        return "null"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _extract_variable_reference(text: str, position: Position) -> VariableReference | None:
    offset = _position_to_offset(text, position)
    spans_by_type = _build_spans_by_type(text)
    expr_span = _find_span_at_offset(spans_by_type["expression"], offset)
    if expr_span is None:
        return None

    local_offset = offset - expr_span.content_start
    for match in _VAR_PATH_RE.finditer(expr_span.content):
        if match.start() <= local_offset <= match.end():
            start = expr_span.content_start + match.start()
            end = expr_span.content_start + match.end()
            return VariableReference(
                path=match.group(0),
                range=_range_from_offsets(text, start, end),
            )
    return None


def _extract_include_reference(text: str, position: Position) -> IncludeReference | None:
    offset = _position_to_offset(text, position)
    spans_by_type = _build_spans_by_type(text)
    for span in spans_by_type["statement"]:
        match = _INCLUDE_CONTENT_RE.match(span.content)
        if not match:
            continue
        name_start = span.content_start + match.start("name")
        name_end = span.content_start + match.end("name")
        if name_start <= offset <= name_end:
            return IncludeReference(
                name=match.group("name"),
                range=_range_from_offsets(text, name_start, name_end),
            )
    return None


def _uri_to_path(uri: str) -> Path | None:
    parsed = urlparse(uri)
    if parsed.scheme != "file":
        return None
    return Path(unquote(parsed.path))


def _expand_candidates(path: Path, temple_extensions: list[str]) -> list[Path]:
    candidates: list[Path] = [path]
    for ext in temple_extensions:
        if not str(path).endswith(ext):
            candidates.append(Path(f"{path}{ext}"))
    return candidates


class TemplateCompletionProvider:
    """Provide completion items for template keywords and schema properties."""

    KEYWORDS = ("if", "elif", "else", "for", "include", "set", "end")

    def get_completions(
        self,
        text: str,
        position: Position,
        schema: Schema | None = None,
        semantic_context: dict[str, Any] | None = None,
    ) -> CompletionList:
        items: dict[str, CompletionItem] = {}
        offset = _position_to_offset(text, position)
        spans_by_type = _build_spans_by_type(text)

        expr_span = _find_active_span_with_unclosed_support(
            text,
            offset,
            "expression",
            spans_by_type["expression"],
        )

        if expr_span is not None:
            expr_prefix = expr_span.content[: max(0, offset - expr_span.content_start)]
            token_match = re.search(r"([A-Za-z_][A-Za-z0-9_\.]*)$", expr_prefix)
            path_expr = token_match.group(1) if token_match else ""

            segments = [seg for seg in path_expr.split(".") if seg]
            parent_segments = segments[:-1] if path_expr else []
            property_prefix = segments[-1] if segments else ""

            if schema is not None:
                parent_type = _resolve_object_type(schema.root_type, parent_segments)
                if isinstance(parent_type, ObjectType):
                    for prop_name, prop_type in parent_type.properties.items():
                        if prop_name.startswith(property_prefix):
                            items[prop_name] = CompletionItem(
                                label=prop_name,
                                kind=CompletionItemKind.Property,
                                detail=_type_name(prop_type),
                            )

            if semantic_context is not None:
                parent_value = _resolve_context_value(semantic_context, parent_segments)
                if isinstance(parent_value, dict):
                    for key, value in parent_value.items():
                        if key.startswith(property_prefix):
                            items.setdefault(
                                key,
                                CompletionItem(
                                    label=key,
                                    kind=CompletionItemKind.Property,
                                    detail=_context_type_name(value),
                                ),
                            )

        stmt_span = _find_active_span_with_unclosed_support(
            text,
            offset,
            "statement",
            spans_by_type["statement"],
        )
        if stmt_span is not None:
            stmt_prefix = stmt_span.content[: max(0, offset - stmt_span.content_start)].strip()
            stmt_token_match = re.search(r"([A-Za-z_]*)$", stmt_prefix)
            keyword_prefix = stmt_token_match.group(1) if stmt_token_match else ""

            for keyword in self.KEYWORDS:
                if keyword.startswith(keyword_prefix):
                    items[keyword] = CompletionItem(
                        label=keyword,
                        kind=CompletionItemKind.Keyword,
                    )

        return CompletionList(is_incomplete=False, items=list(items.values()))


class TemplateHoverProvider:
    """Provide hover metadata for variable references."""

    def get_hover(
        self,
        text: str,
        position: Position,
        schema: Schema | None = None,
        raw_schema: dict | None = None,
    ) -> Hover | None:
        if schema is None:
            return None

        variable = _extract_variable_reference(text, position)
        if variable is None:
            return None

        variable_type = _resolve_object_type(schema.root_type, variable.path.split("."))
        if variable_type is None:
            return None

        lines = [f"**Type:** `{_type_name(variable_type)}`"]
        schema_fragment = _resolve_schema_fragment(raw_schema, variable.path)
        if isinstance(schema_fragment, dict):
            description = schema_fragment.get("description")
            if isinstance(description, str) and description.strip():
                lines.append("")
                lines.append(description.strip())

        return Hover(
            contents=MarkupContent(kind=MarkupKind.Markdown, value="\n".join(lines)),
            range=variable.range,
        )


class TemplateDefinitionProvider:
    """Resolve include statements to local workspace files."""

    def get_definition(
        self,
        text: str,
        position: Position,
        current_uri: str,
        workspace_root: Path | None,
        temple_extensions: list[str],
    ) -> list[Location]:
        include_ref = _extract_include_reference(text, position)
        if include_ref is None:
            return []

        current_file = _uri_to_path(current_uri)
        search_roots = [
            root
            for root in (
                current_file.parent if current_file is not None else None,
                workspace_root,
            )
            if root is not None
        ]

        for root in search_roots:
            for candidate in _expand_candidates(root / include_ref.name, temple_extensions):
                if candidate.exists():
                    return [
                        Location(
                            uri=candidate.as_uri(),
                            range=Range(
                                start=Position(line=0, character=0),
                                end=Position(line=0, character=0),
                            ),
                        )
                    ]

        return []


class TemplateReferenceProvider:
    """Find in-document references for a variable path."""

    def find_references(
        self,
        text: str,
        position: Position,
        current_uri: str,
    ) -> list[Location]:
        target = _extract_variable_reference(text, position)
        if target is None:
            return []

        results: list[Location] = []
        spans_by_type = _build_spans_by_type(text)
        for expr_span in spans_by_type["expression"]:
            for match in _VAR_PATH_RE.finditer(expr_span.content):
                if match.group(0) != target.path:
                    continue

                start = expr_span.content_start + match.start()
                end = expr_span.content_start + match.end()
                results.append(
                    Location(uri=current_uri, range=_range_from_offsets(text, start, end))
                )

        return results


class TemplateRenameProvider:
    """Provide rename operations for in-document variable references."""

    def __init__(self):
        self._references = TemplateReferenceProvider()

    def prepare_rename(self, text: str, position: Position) -> Range | None:
        variable = _extract_variable_reference(text, position)
        if variable is None:
            return None
        return variable.range

    def rename(
        self,
        text: str,
        position: Position,
        new_name: str,
        current_uri: str,
    ) -> WorkspaceEdit | None:
        references = self._references.find_references(text, position, current_uri)
        if not references:
            return None

        edits = [TextEdit(range=location.range, new_text=new_name) for location in references]
        return WorkspaceEdit(changes={current_uri: edits})
