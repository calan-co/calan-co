from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from .typed_ast import Block


class RenderResult:
    def __init__(self, ir: Any, mapping: List[Tuple[str, Tuple[int, int]]]):
        self.ir = ir
        self.mapping = mapping


def evaluate_ast(
    root: Block, context: Dict[str, Any], includes: Dict[str, Block] | None = None
) -> RenderResult:
    """Evaluate AST to a target-neutral IR and collect a trivial mapping of node types to positions.

    Mapping is a list of (node_type, start) tuples for nodes that expose `start`.
    """
    mapping: List[Tuple[str, Tuple[int, int]]] = []
    # Evaluate root with path-aware mapping propagation
    ir = root.evaluate(context, includes, path="/", mapping=mapping)
    return RenderResult(ir, mapping)


def json_serialize(ir: Any) -> str:
    return json.dumps(ir, indent=2, ensure_ascii=False)


def markdown_serialize(ir: Any) -> str:
    # Naive serializer: concatenate string-like leaves, join lists with newlines
    def _flatten(x: Any) -> List[str]:
        if x is None:
            return []
        if isinstance(x, str):
            return [x]
        if isinstance(x, (int, float)):
            return [str(x)]
        if isinstance(x, list):
            out: List[str] = []
            for i in x:
                out.extend(_flatten(i))
            return out
        if isinstance(x, dict):
            # prefer values
            out: List[str] = []
            for v in x.values():
                out.extend(_flatten(v))
            return out
        return [str(x)]

    parts = _flatten(ir)
    return "\n\n".join(parts)


__all__ = ["evaluate_ast", "RenderResult", "json_serialize", "markdown_serialize"]
