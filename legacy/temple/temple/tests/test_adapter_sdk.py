"""Tests for the adapter SDK contracts."""

from temple.diagnostics import Position, SourceRange
from temple.sdk.adapter import (
    AdapterBase,
    AdapterParseResult,
    IRBlock,
    IRExpression,
    IRStatement,
    IRText,
    iter_ir_nodes,
)


def _sr(line: int, col: int, end_col: int) -> SourceRange:
    return SourceRange(Position(line, col), Position(line, end_col))


class _FakeAdapter(AdapterBase):
    def parse_to_ir(self, source: str, filename: str = "<memory>") -> AdapterParseResult:
        root = IRBlock(
            nodes=(
                IRText(value="hello ", source_range=_sr(0, 0, 6)),
                IRExpression(
                    expr="users | map('name') | join(', ')",
                    source_range=_sr(0, 7, 39),
                ),
                IRStatement(
                    kind="if",
                    args={
                        "condition": "enabled",
                        "body": IRBlock(
                            nodes=(
                                IRExpression(
                                    expr="items | selectattr('active') | map('name')",
                                    source_range=_sr(1, 0, 45),
                                ),
                            ),
                            source_range=_sr(1, 0, 45),
                        ),
                    },
                    source_range=_sr(1, 0, 45),
                ),
            ),
            source_range=_sr(0, 0, 45),
        )
        return AdapterParseResult(
            ir=root,
            source_map={(0, 0): _sr(0, 0, 6), ("if", 0): _sr(1, 0, 45)},
        )


def test_parse_to_ir_returns_typed_result() -> None:
    adapter = _FakeAdapter()
    result = adapter.parse_to_ir("ignored")

    assert isinstance(result, AdapterParseResult)
    assert isinstance(result.ir, IRBlock)
    assert len(result.ir.nodes) == 3
    assert isinstance(result.ir.nodes[0], IRText)
    assert isinstance(result.ir.nodes[1], IRExpression)


def test_map_engine_locations_to_source_uses_source_map() -> None:
    adapter = _FakeAdapter()
    result = adapter.parse_to_ir("ignored")

    mapped = adapter.map_engine_locations_to_source(("if", 0), result.source_map)
    assert mapped == _sr(1, 0, 45)
    assert adapter.map_engine_locations_to_source(("missing", 1), result.source_map) is None


def test_list_used_filters_discovers_nested_expressions() -> None:
    adapter = _FakeAdapter()
    result = adapter.parse_to_ir("ignored")

    filters = adapter.list_used_filters(result.ir)
    assert filters == ["map", "join", "selectattr"]


def test_iter_ir_nodes_walks_nested_blocks() -> None:
    adapter = _FakeAdapter()
    result = adapter.parse_to_ir("ignored")

    kinds = [type(node).__name__ for node in iter_ir_nodes(result.ir)]
    assert kinds == ["IRText", "IRExpression", "IRStatement", "IRExpression"]
