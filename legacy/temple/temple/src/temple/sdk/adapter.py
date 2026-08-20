"""Adapter SDK interfaces and shared helpers for external template engines."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from temple.diagnostics import SourceRange

_FILTER_NAME_RE = re.compile(r"\|\s*([A-Za-z_]\w*)")


@dataclass(frozen=True)
class AdapterDiagnostic:
    """Engine diagnostic normalized to Temple's diagnostic model."""

    message: str
    severity: int
    source_range: SourceRange
    code: str | None = None
    related: tuple[str, ...] = ()


@dataclass(frozen=True)
class IRText:
    value: str
    source_range: SourceRange


@dataclass(frozen=True)
class IRExpression:
    expr: str
    source_range: SourceRange


@dataclass(frozen=True)
class IRStatement:
    kind: str
    args: dict[str, Any]
    source_range: SourceRange


IRNode = IRText | IRExpression | IRStatement


@dataclass(frozen=True)
class IRBlock:
    nodes: tuple[IRNode, ...]
    source_range: SourceRange


@dataclass(frozen=True)
class AdapterParseResult:
    """Result object returned by adapter parse calls."""

    ir: IRBlock
    source_map: dict[Any, SourceRange] = field(default_factory=dict)
    diagnostics: tuple[AdapterDiagnostic, ...] = ()
    warnings: tuple[str, ...] = ()


class AdapterBase(ABC):
    """Base adapter contract for third-party template engines."""

    @abstractmethod
    def parse_to_ir(self, source: str, filename: str = "<memory>") -> AdapterParseResult:
        raise NotImplementedError

    def map_engine_locations_to_source(
        self,
        engine_location: Any,
        source_map: dict[Any, SourceRange],
    ) -> SourceRange | None:
        return source_map.get(engine_location)

    def list_used_filters(self, ir: IRBlock) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for node in collect_ir_nodes(ir):
            if isinstance(node, IRExpression):
                for filter_name in _FILTER_NAME_RE.findall(node.expr):
                    if filter_name not in seen:
                        seen.add(filter_name)
                        ordered.append(filter_name)
        return ordered


def collect_ir_nodes(block: IRBlock) -> tuple[IRNode, ...]:
    """Walk IR depth-first and return all nodes in visit order."""
    out: list[IRNode] = []

    def _walk_value(value: Any) -> None:
        if isinstance(value, IRBlock):
            for child in value.nodes:
                _walk_value(child)
            return
        if isinstance(value, (IRText, IRExpression, IRStatement)):
            out.append(value)
            if isinstance(value, IRStatement):
                for arg_value in value.args.values():
                    _walk_value(arg_value)
            return
        if isinstance(value, dict):
            for nested in value.values():
                _walk_value(nested)
            return
        if isinstance(value, (list, tuple)):
            for nested in value:
                _walk_value(nested)
            return

    _walk_value(block)
    return tuple(out)


def iter_ir_nodes(block: IRBlock) -> tuple[IRNode, ...]:
    """Backward-compatible alias for collect_ir_nodes."""
    return collect_ir_nodes(block)


__all__ = [
    "AdapterBase",
    "AdapterDiagnostic",
    "AdapterParseResult",
    "IRBlock",
    "IRExpression",
    "IRNode",
    "IRStatement",
    "IRText",
    "collect_ir_nodes",
    "iter_ir_nodes",
]
