"""Expression helpers for Temple runtime and tooling.

Supports a safe MVP expression subset:
- dotted variable lookup (including numeric index segments: ``user.skills.0``)
- list literals
- boolean operators: ``not``, ``and``, ``or``
- comparisons: ``==``, ``!=``, ``<``, ``<=``, ``>``, ``>=``
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any

from temple.filter_registry import DEFAULT_FILTER_ADAPTER

_SIMPLE_PATH_RE = re.compile(r"^[A-Za-z_]\w*(?:\.(?:[A-Za-z_]\w*|\d+))*$")
_INDEX_ACCESS_RE = re.compile(r"(?<=[A-Za-z_\]\)])\.(\d+)\b")
_FILTER_CALL_RE = re.compile(r"^([A-Za-z_]\w*)(?:\((.*)\))?$")


def normalize_expression(expr: str) -> str:
    """Normalize Temple expression text into Python-parseable form."""
    # Convert dotted numeric index access to subscript form: a.b.0 -> a.b[0]
    return _INDEX_ACCESS_RE.sub(r"[\1]", expr)


def is_simple_path(expr: str) -> bool:
    return bool(_SIMPLE_PATH_RE.fullmatch(expr.strip()))


def resolve_simple_path(path: str, context: dict[str, Any] | None) -> Any:
    """Resolve a dot path in dictionaries/lists with graceful missing handling."""
    if context is None:
        return None

    value: Any = context
    for part in path.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, (list, tuple)):
            if not part.isdigit():
                return None
            idx = int(part)
            if idx < 0 or idx >= len(value):
                return None
            value = value[idx]
        else:
            return None
    return value


@dataclass(frozen=True)
class FilterInvocation:
    """Parsed filter call in expression pipeline syntax."""

    name: str
    args: tuple[str, ...]


def _split_top_level(text: str, delimiter: str) -> list[str]:
    parts: list[str] = []
    buff: list[str] = []
    quote: str | None = None
    escaped = False
    depth = 0

    for ch in text:
        if quote is not None:
            buff.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue

        if ch in ("'", '"'):
            quote = ch
            buff.append(ch)
            continue

        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)

        if ch == delimiter and depth == 0:
            parts.append("".join(buff).strip())
            buff = []
            continue

        buff.append(ch)

    parts.append("".join(buff).strip())
    return parts


def _parse_filter_invocation(raw: str) -> FilterInvocation | None:
    text = raw.strip()
    if not text:
        return None

    match = _FILTER_CALL_RE.match(text)
    if match is None:
        return None

    name = match.group(1)
    args_text = match.group(2)
    if args_text is None:
        return FilterInvocation(name=name, args=())

    args = tuple(arg for arg in _split_top_level(args_text, ",") if arg)
    return FilterInvocation(name=name, args=args)


def parse_filter_pipeline(expr: str) -> tuple[str, tuple[FilterInvocation, ...]]:
    """Parse ``a | b(c) | d`` into base expression + filter invocations."""
    segments = _split_top_level(expr, "|")
    if len(segments) <= 1:
        return expr.strip(), ()

    base_expr = segments[0].strip()
    filters: list[FilterInvocation] = []
    for segment in segments[1:]:
        invocation = _parse_filter_invocation(segment)
        if invocation is not None:
            filters.append(invocation)
    return base_expr, tuple(filters)


def has_filter_pipeline(expr: str | None) -> bool:
    if expr is None:
        return False
    _base_expr, filters = parse_filter_pipeline(expr)
    return bool(filters)


class _ExpressionEvaluator:
    def __init__(self, context: dict[str, Any]):
        self.context = context

    def eval(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            return node.value

        if isinstance(node, ast.Name):
            return self.context.get(node.id)

        if isinstance(node, ast.Attribute):
            parent = self.eval(node.value)
            if isinstance(parent, dict):
                return parent.get(node.attr)
            return getattr(parent, node.attr, None)

        if isinstance(node, ast.Subscript):
            container = self.eval(node.value)
            key = self.eval(node.slice)
            return self._subscript(container, key)

        if isinstance(node, ast.List):
            return [self.eval(item) for item in node.elts]

        if isinstance(node, ast.Tuple):
            return tuple(self.eval(item) for item in node.elts)

        if isinstance(node, ast.UnaryOp):
            value = self.eval(node.operand)
            if isinstance(node.op, ast.Not):
                return not bool(value)
            if isinstance(node.op, ast.USub):
                return -value if isinstance(value, (int, float)) else None
            if isinstance(node.op, ast.UAdd):
                return +value if isinstance(value, (int, float)) else None
            return None

        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                result = self.eval(node.values[0])
                for expr in node.values[1:]:
                    if not result:
                        return result
                    result = self.eval(expr)
                return result
            if isinstance(node.op, ast.Or):
                result = self.eval(node.values[0])
                for expr in node.values[1:]:
                    if result:
                        return result
                    result = self.eval(expr)
                return result
            return None

        if isinstance(node, ast.Compare):
            return self._evaluate_compare(node)

        if isinstance(node, ast.BinOp):
            left = self.eval(node.left)
            right = self.eval(node.right)
            if isinstance(node.op, ast.Add):
                try:
                    return left + right
                except Exception:
                    return None
            if isinstance(node.op, ast.Sub):
                return left - right if isinstance(left, (int, float)) and isinstance(right, (int, float)) else None
            if isinstance(node.op, ast.Mult):
                return left * right if isinstance(left, (int, float, str)) and isinstance(right, (int, float)) else None
            if isinstance(node.op, ast.Div):
                if isinstance(left, (int, float)) and isinstance(right, (int, float)) and right != 0:
                    return left / right
                return None
            return None

        if isinstance(node, ast.Dict):
            out: dict[Any, Any] = {}
            for key_node, value_node in zip(node.keys, node.values):
                if key_node is None:
                    continue
                out[self.eval(key_node)] = self.eval(value_node)
            return out

        return None

    def _subscript(self, container: Any, key: Any) -> Any:
        if isinstance(container, dict):
            return container.get(key)
        if isinstance(container, (list, tuple)):
            if not isinstance(key, int):
                return None
            if key < 0 or key >= len(container):
                return None
            return container[key]
        try:
            return container[key]
        except Exception:
            return None

    def _evaluate_compare(self, node: ast.Compare) -> bool:
        left = self.eval(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            right = self.eval(comparator)
            if isinstance(op, ast.Eq):
                ok = left == right
            elif isinstance(op, ast.NotEq):
                ok = left != right
            elif isinstance(op, ast.Lt):
                ok = left < right
            elif isinstance(op, ast.LtE):
                ok = left <= right
            elif isinstance(op, ast.Gt):
                ok = left > right
            elif isinstance(op, ast.GtE):
                ok = left >= right
            else:
                return False

            if not ok:
                return False
            left = right
        return True


def _evaluate_base_expression(expr: str, context: dict[str, Any] | None) -> Any:
    if expr is None:
        return None

    stripped = expr.strip()
    if not stripped:
        return None

    if is_simple_path(stripped):
        return resolve_simple_path(stripped, context)

    try:
        parsed = ast.parse(normalize_expression(stripped), mode="eval")
    except Exception:
        return None

    evaluator = _ExpressionEvaluator(context or {})
    try:
        return evaluator.eval(parsed.body)
    except Exception:
        return None


def evaluate_expression(expr: str | None, context: dict[str, Any] | None) -> Any:
    """Evaluate an expression against context. Returns None on unsupported/invalid input."""
    if expr is None:
        return None

    stripped = expr.strip()
    if not stripped:
        return None

    base_expr, filters = parse_filter_pipeline(stripped)
    value = _evaluate_base_expression(base_expr, context)
    for filter_call in filters:
        args = tuple(_evaluate_base_expression(arg, context) for arg in filter_call.args)
        value = DEFAULT_FILTER_ADAPTER.apply(value, filter_call.name, args)
        if value is None and not DEFAULT_FILTER_ADAPTER.has_filter(filter_call.name):
            return None
    return value


def _path_from_node(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id

    if isinstance(node, ast.Attribute):
        parent = _path_from_node(node.value)
        if parent is None:
            return None
        return f"{parent}.{node.attr}"

    if isinstance(node, ast.Subscript):
        parent = _path_from_node(node.value)
        if parent is None:
            return None
        if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int):
            return f"{parent}.{node.slice.value}"
        return parent

    return None


class _VariablePathCollector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.paths: set[str] = set()

    def visit_Name(self, node: ast.Name) -> None:
        self.paths.add(node.id)
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        path = _path_from_node(node)
        if path:
            self.paths.add(path)
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        path = _path_from_node(node)
        if path:
            self.paths.add(path)
        self.generic_visit(node)


def _extract_base_variable_paths(expr: str) -> set[str]:
    stripped = expr.strip()
    if not stripped:
        return set()

    if is_simple_path(stripped):
        return {stripped}

    try:
        parsed = ast.parse(normalize_expression(stripped), mode="eval")
    except Exception:
        return set()

    collector = _VariablePathCollector()
    collector.visit(parsed)
    return collector.paths


def extract_variable_paths(expr: str | None) -> set[str]:
    """Extract variable paths referenced by an expression."""
    if expr is None:
        return set()

    stripped = expr.strip()
    if not stripped:
        return set()
    base_expr, filters = parse_filter_pipeline(stripped)
    paths = _extract_base_variable_paths(base_expr)
    for filter_call in filters:
        for arg in filter_call.args:
            paths.update(_extract_base_variable_paths(arg))
    return paths
