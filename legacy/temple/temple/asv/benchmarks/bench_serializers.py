"""Serializer benchmarks across JSON/Markdown/HTML/YAML."""

from temple.compiler.parser import TypedTemplateParser
from temple.compiler.type_checker import TypeChecker
from temple.compiler.serializers import (
    JSONSerializer,
    MarkdownSerializer,
    HTMLSerializer,
    YAMLSerializer,
)
from temple.typed_ast import Block


def _make_block(nodes):
    # Wrap parsed nodes into a Block to align with serializer expectations.
    return Block(nodes or [], name="root")


def _build_template(sections: int = 20) -> str:
    parts = ["Hello {{ user.name }}"]
    loop = "{% for job in user.jobs %}{{ job.title }} at {{ job.company }} {% end %}"
    for _ in range(sections):
        parts.append(loop)
    return "\n".join(parts)


class BenchSerializers:
    def setup(self):
        self.parser = TypedTemplateParser()
        self.data = {
            "user": {
                "name": "Alice",
                "jobs": [
                    {"title": "Engineer", "company": "Acme"},
                    {"title": "Manager", "company": "Beta"},
                    {"title": "Lead", "company": "Gamma"},
                ],
            }
        }

        # Parse once and type check to ensure serializer inputs are valid
        ast_nodes, _ = self.parser.parse(_build_template(60))
        checker = TypeChecker(data=self.data)
        for node in ast_nodes:
            checker.check(node)

        self.ast = _make_block(ast_nodes)
        self.json_serializer = JSONSerializer(pretty=False)
        self.md_serializer = MarkdownSerializer(pretty=False)
        self.html_serializer = HTMLSerializer(pretty=False)
        self.yaml_serializer = YAMLSerializer(pretty=False)

    def time_serialize_json(self):
        self.json_serializer.serialize(self.ast, self.data)

    def time_serialize_markdown(self):
        self.md_serializer.serialize(self.ast, self.data)

    def time_serialize_html(self):
        self.html_serializer.serialize(self.ast, self.data)

    def time_serialize_yaml(self):
        self.yaml_serializer.serialize(self.ast, self.data)
