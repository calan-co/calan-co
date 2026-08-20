"""Jinja2 adapter prototype for Temple IR conversion."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from temple.compiler.type_checker import TypeChecker
from temple.diagnostics import Position, SourceRange
from temple.sdk.adapter import (
    AdapterBase,
    AdapterDiagnostic,
    AdapterParseResult,
    IRBlock,
    IRExpression,
    IRStatement,
    IRText,
)
from temple.typed_ast import Block, Expression, For, If, Include, Set, Text

try:
    from jinja2 import Environment, nodes, select_autoescape
    from jinja2.exceptions import TemplateSyntaxError

    _JINJA2_IMPORT_ERROR: ModuleNotFoundError | None = None
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in integration envs
    _JINJA2_IMPORT_ERROR = exc
    Environment = object  # type: ignore[assignment,misc]
    TemplateSyntaxError = Exception  # type: ignore[assignment,misc]
    select_autoescape = None  # type: ignore[assignment]
    nodes = None  # type: ignore[assignment]


@dataclass(frozen=True)
class _SourceCursor:
    line_lengths: tuple[int, ...]

    def line_range(self, line_1_based: int) -> SourceRange:
        line_0 = max(0, line_1_based - 1)
        length = self.line_lengths[line_0] if line_0 < len(self.line_lengths) else 0
        return SourceRange(Position(line_0, 0), Position(line_0, length))


class Jinja2Adapter(AdapterBase):
    """Prototype Jinja2 adapter that emits Temple-compatible IR."""

    def __init__(self, environment: Environment | None = None):
        if _JINJA2_IMPORT_ERROR is not None:
            raise ModuleNotFoundError(
                "jinja2 is required for temple.adapters.jinja2_adapter"
            ) from _JINJA2_IMPORT_ERROR
        self.environment = environment or Environment(
            autoescape=select_autoescape(default=True, default_for_string=True)
        )

    def parse_to_ir(self, source: str, filename: str = "<memory>") -> AdapterParseResult:
        cursor = _SourceCursor(tuple(len(line) for line in source.splitlines()))
        try:
            tree = self.environment.parse(source, name=filename)
        except TemplateSyntaxError as exc:
            source_range = cursor.line_range(getattr(exc, "lineno", 1))
            return AdapterParseResult(
                ir=IRBlock(nodes=(), source_range=source_range),
                diagnostics=(
                    AdapterDiagnostic(
                        message=str(exc),
                        severity=1,
                        source_range=source_range,
                        code="jinja2.syntax_error",
                    ),
                ),
            )

        source_map: dict[Any, SourceRange] = {}
        counter = {"value": 0}
        body = self._nodes_to_ir_block(tree.body, cursor, source_map, counter)
        return AdapterParseResult(ir=body, source_map=source_map)

    def to_typed_block(self, ir: IRBlock) -> Block:
        return Block([self._ir_node_to_typed(node) for node in ir.nodes])

    def semantic_diagnostics(
        self,
        source: str,
        *,
        data: Any | None = None,
    ) -> tuple[dict, ...]:
        parsed = self.parse_to_ir(source)
        if parsed.diagnostics:
            return tuple(
                {
                    "message": diag.message,
                    "code": diag.code,
                    "severity": diag.severity,
                    "range": diag.source_range.to_lsp(),
                }
                for diag in parsed.diagnostics
            )
        checker = TypeChecker(data=data)
        checker.check(self.to_typed_block(parsed.ir))
        return tuple(checker.errors.to_diagnostics())

    def _register_source_range(
        self,
        source_map: dict[Any, SourceRange],
        source_range: SourceRange,
        counter: dict[str, int],
    ) -> str:
        counter["value"] += 1
        key = f"node:{counter['value']}"
        source_map[key] = source_range
        return key

    def _nodes_to_ir_block(
        self,
        jinja_nodes: list[Any],
        cursor: _SourceCursor,
        source_map: dict[Any, SourceRange],
        counter: dict[str, int],
    ) -> IRBlock:
        out: list[IRText | IRExpression | IRStatement] = []
        first_range = SourceRange(Position(0, 0), Position(0, 0))
        last_range = first_range

        for node in jinja_nodes:
            source_range = cursor.line_range(getattr(node, "lineno", 1))
            self._register_source_range(source_map, source_range, counter)
            if not out:
                first_range = source_range
            last_range = source_range
            out.extend(self._convert_node(node, cursor, source_map, counter, source_range))

        return IRBlock(nodes=tuple(out), source_range=SourceRange(first_range.start, last_range.end))

    def _convert_node(
        self,
        node: Any,
        cursor: _SourceCursor,
        source_map: dict[Any, SourceRange],
        counter: dict[str, int],
        source_range: SourceRange,
    ) -> list[IRText | IRExpression | IRStatement]:
        if isinstance(node, nodes.TemplateData):
            return [IRText(value=node.data, source_range=source_range)]

        if isinstance(node, nodes.Output):
            exprs: list[IRExpression] = []
            for child in node.nodes:
                if isinstance(child, nodes.TemplateData):
                    exprs.append(IRExpression(expr=repr(child.data), source_range=source_range))
                else:
                    exprs.append(
                        IRExpression(
                            expr=self._expr_to_text(child),
                            source_range=source_range,
                        )
                    )
            return exprs

        if isinstance(node, nodes.If):
            body = self._nodes_to_ir_block(node.body, cursor, source_map, counter)
            else_body = self._nodes_to_ir_block(node.else_, cursor, source_map, counter)
            elif_parts: list[tuple[str, IRBlock]] = []
            for elif_node in node.elif_:
                elif_parts.append(
                    (
                        self._expr_to_text(elif_node.test),
                        self._nodes_to_ir_block(
                            elif_node.body, cursor, source_map, counter
                        ),
                    )
                )
            return [
                IRStatement(
                    kind="if",
                    args={
                        "condition": self._expr_to_text(node.test),
                        "body": body,
                        "else_if_parts": tuple(elif_parts),
                        "else_body": else_body,
                    },
                    source_range=source_range,
                )
            ]

        if isinstance(node, nodes.For):
            body = self._nodes_to_ir_block(node.body, cursor, source_map, counter)
            return [
                IRStatement(
                    kind="for",
                    args={
                        "target": self._expr_to_text(node.target),
                        "iterable": self._expr_to_text(node.iter),
                        "body": body,
                    },
                    source_range=source_range,
                )
            ]

        if isinstance(node, nodes.Assign):
            return [
                IRStatement(
                    kind="set",
                    args={
                        "name": self._expr_to_text(node.target),
                        "expr": self._expr_to_text(node.node),
                    },
                    source_range=source_range,
                )
            ]

        if isinstance(node, nodes.Include):
            template_name = self._expr_to_text(node.template).strip("'\"")
            return [
                IRStatement(
                    kind="include",
                    args={"name": template_name},
                    source_range=source_range,
                )
            ]

        return []

    def _expr_to_text(self, node: Any) -> str:
        if isinstance(node, nodes.Name):
            return node.name
        if isinstance(node, nodes.Const):
            return repr(node.value)
        if isinstance(node, nodes.Getattr):
            return f"{self._expr_to_text(node.node)}.{node.attr}"
        if isinstance(node, nodes.Getitem):
            return f"{self._expr_to_text(node.node)}[{self._expr_to_text(node.arg)}]"
        if isinstance(node, nodes.List):
            return "[" + ", ".join(self._expr_to_text(item) for item in node.items) + "]"
        if isinstance(node, nodes.Tuple):
            return "(" + ", ".join(self._expr_to_text(item) for item in node.items) + ")"
        if isinstance(node, nodes.Not):
            return f"not {self._expr_to_text(node.node)}"
        if isinstance(node, nodes.And):
            return f"{self._expr_to_text(node.left)} and {self._expr_to_text(node.right)}"
        if isinstance(node, nodes.Or):
            return f"{self._expr_to_text(node.left)} or {self._expr_to_text(node.right)}"
        if isinstance(node, nodes.Compare):
            # Map Jinja2 compare operators to valid Python operators
            op_map = {
                "eq": "==",
                "ne": "!=",
                "lt": "<",
                "lteq": "<=",
                "gt": ">",
                "gteq": ">=",
            }
            left = self._expr_to_text(node.expr)
            ops: list[str] = []
            for operand in node.ops:
                op = operand.op
                # Translate Jinja operator to Python operator
                python_op = op_map.get(op, op)  # Fallback to original if unknown
                ops.append(f"{python_op} {self._expr_to_text(operand.expr)}")
            return f"{left} {' '.join(ops)}".strip()
        if isinstance(node, nodes.Filter):
            base = self._expr_to_text(node.node)
            if node.args:
                args = ", ".join(self._expr_to_text(arg) for arg in node.args)
                return f"{base} | {node.name}({args})"
            return f"{base} | {node.name}"
        return "<expr>"

    def _ir_node_to_typed(self, node: IRText | IRExpression | IRStatement):
        if isinstance(node, IRText):
            return Text(node.source_range, node.value)

        if isinstance(node, IRExpression):
            return Expression(node.source_range, node.expr)

        if node.kind == "if":
            else_if_parts: list[tuple[str, Block]] = []
            for cond, block in node.args.get("else_if_parts", ()):
                else_if_parts.append((cond, self.to_typed_block(block)))
            return If(
                source_range=node.source_range,
                condition=node.args.get("condition", ""),
                body=self.to_typed_block(node.args["body"]),
                else_if_parts=else_if_parts,
                else_body=self.to_typed_block(node.args["else_body"])
                if isinstance(node.args.get("else_body"), IRBlock)
                else None,
            )

        if node.kind == "for":
            return For(
                source_range=node.source_range,
                var=node.args.get("target", "item"),
                iterable=node.args.get("iterable", ""),
                body=self.to_typed_block(node.args["body"]),
            )

        if node.kind == "set":
            return Set(
                source_range=node.source_range,
                name=node.args.get("name", ""),
                expr=node.args.get("expr", ""),
            )

        if node.kind == "include":
            return Include(
                source_range=node.source_range,
                name=node.args.get("name", ""),
            )

        return Text(node.source_range, "")


__all__ = ["Jinja2Adapter"]
