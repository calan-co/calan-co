from typing import Any, Optional

from temple.diagnostics import Position, SourceRange
from temple.expression_eval import evaluate_expression


class TemplateError(Exception):
    pass


class Node:
    def __init__(self, source_range: SourceRange):
        # `source_range` is the canonical SourceRange for this node.
        self._source_range = source_range
        # Keep convenient `.start` reference for legacy code: the Position
        # (start of the SourceRange).
        self.start = source_range.start

    @property
    def source_range(self) -> SourceRange:
        return self._source_range

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> Any:
        raise NotImplementedError()


class Text(Node):
    def __init__(self, source_range: SourceRange, text: str):
        super().__init__(source_range)
        self.text = text

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> str:
        return self.text


class Expression(Node):
    def __init__(self, source_range: SourceRange, expr: str | None = None):
        expr_val = expr
        super().__init__(source_range)
        self.expr = expr_val

    def _resolve(self, context: dict[str, Any]) -> Any:
        return evaluate_expression(self.expr, context)

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> Any:
        val = self._resolve(context)
        if mapping is not None:
            mapping.append((path or "/", self.source_range.start))
        return val


class If(Node):
    def __init__(
        self,
        source_range: "SourceRange",
        condition: str,
        body: "Block",
        else_if_parts: list[tuple[str, "Block"]] | None = None,
        else_body: Optional["Block"] = None,
    ):
        super().__init__(source_range)
        self.condition = condition
        self.body = body
        self.else_if_parts = else_if_parts or []
        self.else_body = else_body

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> Any:
        cond_val = Expression(self.source_range, self.condition).evaluate(
            context, includes, path + "/cond", mapping
        )
        if cond_val:
            return self.body.evaluate(context, includes, path + "/body", mapping)
        # Check else-if branches
        for idx, (else_if_cond, else_if_body_blk) in enumerate(self.else_if_parts):
            elif_val = Expression(self.source_range, else_if_cond).evaluate(
                context, includes, path + f"/else_if[{idx}]/cond", mapping
            )
            if elif_val:
                return else_if_body_blk.evaluate(
                    context, includes, path + f"/else_if[{idx}]/body", mapping
                )
        # Check else branch
        if self.else_body:
            return self.else_body.evaluate(context, includes, path + "/else", mapping)
        return None


class For(Node):
    def __init__(
        self,
        source_range: "SourceRange",
        var: str,
        iterable: str,
        body: "Block",
    ):
        super().__init__(source_range)
        # Require var and iterable to be provided to avoid silent runtime errors.
        if var is None:
            raise TemplateError("For loop 'var' parameter is required")
        if iterable is None:
            raise TemplateError("For loop 'iterable' parameter is required")
        # Accept keyword args used in tests: var, iterable
        self.var = var
        self.iterable = iterable
        # Compatibility aliases for older code/tests that expect legacy names
        self.var_name = self.var
        self.iterable_expr = self.iterable
        self.body = body
        self.body_block = self.body

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> list[Any]:
        iterable = Expression(self.source_range, self.iterable).evaluate(
            context, includes, path + "/iter", mapping
        )
        if iterable is None:
            return []
        # try to get length for loop helpers
        try:
            length = len(iterable)
        except Exception:
            length = None
        results = []
        for idx, item in enumerate(iterable):
            local_ctx = dict(context)
            local_ctx[self.var] = item
            # loop helper
            loop = {
                "index": idx + 1,
                "index0": idx,
                "first": idx == 0,
                "last": (idx == length - 1) if length is not None else False,
                "length": length,
            }
            local_ctx["loop"] = loop
            val = self.body.evaluate(
                local_ctx, includes, path + f"/for[{self.var}][{idx}]", mapping
            )
            if isinstance(val, list):
                results.extend(val)
            else:
                results.append(val)
        return results


class Include(Node):
    def __init__(self, source_range: "SourceRange", name: str):
        super().__init__(source_range)
        self.name = name

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> Any:
        if not includes or self.name not in includes:
            raise TemplateError(f"Include not found: {self.name}")
        return includes[self.name].evaluate(
            context, includes, path + f"/include[{self.name}]", mapping
        )


class Set(Node):
    def __init__(self, source_range: "SourceRange", name: str, expr: str):
        super().__init__(source_range)
        self.name = name
        self.expr = expr

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> None:
        if self.name:
            context[self.name] = evaluate_expression(self.expr, context)
        if mapping is not None:
            mapping.append((path or "/", self.source_range.start))
        return None


class Block(Node):
    def __init__(
        self,
        nodes: list[Node] | None,
        name: str | None = None,
    ):
        sr = (
            SourceRange(nodes[0].source_range.start, nodes[-1].source_range.end)
            if nodes
            else SourceRange(Position(0, 0), Position(0, 0))
        )
        super().__init__(sr)
        self.name = name
        # canonical storage
        self.nodes = list(nodes) if nodes is not None else []
        # Provide .body alias for older code expecting `.body`
        self.body = self.nodes

    def __iter__(self):
        return iter(self.nodes)

    def __len__(self):
        return len(self.nodes)

    def __getitem__(self, idx: int) -> Node:
        return self.nodes[idx]

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> Any:
        out: list[Any] = []
        for idx, n in enumerate(self.nodes):
            v = n.evaluate(context, includes, path + f"/{idx}", mapping)
            # flatten nested Blocks and For results conservatively
            if isinstance(v, list):
                out.extend(v)
            elif v is None:
                continue
            else:
                out.append(v)
        if mapping is not None:
            mapping.append((path or "/", self.source_range.start))
        return out


class Array(Node):
    def __init__(
        self,
        source_range: "SourceRange",
        items: list[Node] | None = None,
    ):
        super().__init__(source_range)
        self.items = items or []

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> list[Any]:
        out: list[Any] = []
        for idx, it in enumerate(self.items):
            v = it.evaluate(context, includes, path + f"/{idx}", mapping)
            if isinstance(v, list):
                out.extend(v)
            elif v is None:
                continue
            else:
                out.append(v)
        if mapping is not None:
            mapping.append((path or "/", self.source_range.start))
        return out


class ObjectNode(Node):
    def __init__(
        self,
        source_range: "SourceRange",
        pairs: list[tuple[str, Node]] | None = None,
    ):
        super().__init__(source_range)
        # pairs: list of (key, Node)
        self.pairs = pairs or []

    def evaluate(
        self,
        context: dict[str, Any],
        includes: dict[str, "Block"] | None = None,
        path: str = "",
        mapping: list[tuple[str, Position]] | None = None,
    ) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, node in self.pairs:
            v = node.evaluate(context, includes, path + f"/{key}", mapping)
            # if v is a single-item list, unwrap to scalar
            if isinstance(v, list) and len(v) == 1:
                out[key] = v[0]
            else:
                out[key] = v
        if mapping is not None:
            mapping.append((path or "/", self.source_range.start))
        return out


# Placeholder classes until they are implemented in typed_ast
class FunctionDef(Node):
    pass


class FunctionCall(Node):
    pass


__all__ = [
    "Node",
    "Text",
    "Expression",
    "If",
    "For",
    "Include",
    "Set",
    "Block",
    "Array",
    "ObjectNode",
    "TemplateError",
    "FunctionDef",
    "FunctionCall",
]
