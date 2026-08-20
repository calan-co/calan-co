"""Type checker benchmarks for typical templates."""

from typing import Sequence
from temple.compiler.parser import TypedTemplateParser
from temple.compiler.type_checker import TypeChecker
from temple.typed_ast import Block, Node


def _make_block(nodes: Sequence[Node]) -> Block:
    return Block(list(nodes), "root")


def _build_template(sections: int = 20) -> str:
    parts = ["Hello {{ user.name }}"]
    loop = "{% for job in user.jobs %}{{ job.title }} at {{ job.company }} {% end %}"
    for _ in range(sections):
        parts.append(loop)
    return "\n".join(parts)


class BenchTypeChecker:
    def setup(self):
        self.parser = TypedTemplateParser()
        self.data: dict[str, dict[str, object]] = {
            "user": {
                "name": "Alice",
                "jobs": [
                    {"title": "Engineer", "company": "Acme"},
                    {"title": "Manager", "company": "Beta"},
                    {"title": "Lead", "company": "Gamma"},
                ],
            }
        }

        self.ast_small = _make_block(self.parser.parse(_build_template(10))[0])
        self.ast_medium = _make_block(self.parser.parse(_build_template(50))[0])
        self.ast_large = _make_block(self.parser.parse(_build_template(150))[0])

    def time_type_check_small(self):
        checker = TypeChecker(data=self.data)
        checker.check(self.ast_small)

    def time_type_check_medium(self):
        checker = TypeChecker(data=self.data)
        checker.check(self.ast_medium)

    def time_type_check_large(self):
        checker = TypeChecker(data=self.data)
        checker.check(self.ast_large)
