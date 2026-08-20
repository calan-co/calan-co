from typing import List, Tuple

from temple.lark_parser import parse_with_diagnostics
from temple.typed_ast import Block
from temple.diagnostics import Diagnostic


class TypedTemplateParser:
    """Lightweight wrapper around the Lark-based parser used in tests.

    parse(text) -> (nodes_list, diagnostics_list)
    """

    def parse(self, text: str) -> Tuple[List[Block], List[Diagnostic]]:
        ast, diags = parse_with_diagnostics(text)
        # ast is a Block; return its child nodes as list for compatibility with tests
        nodes = (
            list(ast.nodes)
            if isinstance(ast, Block)
            else ([ast] if ast is not None else [])
        )
        # Ensure nodes have a source_range (some transformer code may omit positions)
        from temple.diagnostics import SourceRange, Position

        for n in nodes:
            if getattr(n, "source_range", None) is None:
                # try to synthesize from n.start or fallback to (0,0)
                start = getattr(n, "start", None) or (0, 0)
                n.source_range = SourceRange(
                    Position(start[0], start[1]), Position(start[0], start[1])
                )
        return nodes, diags


__all__ = [
    "TypedTemplateParser",
]
