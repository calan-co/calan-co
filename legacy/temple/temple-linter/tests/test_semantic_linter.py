"""Semantic validation integration tests for Temple linter."""

import json

from temple.diagnostics import DiagnosticSeverity
from temple_linter.linter import TemplateLinter
from temple_linter.services.lint_orchestrator import LintOrchestrator


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    def result(self, timeout=None):
        return self._payload


class _FakeProtocol:
    def send_request(self, method, params):  # pragma: no cover - shape only
        return _FakeRequest({"diagnostics": []})


class _FakeLanguageClient:
    def __init__(self):
        self.protocol = _FakeProtocol()


def test_template_linter_emits_missing_property_semantic_diagnostic() -> None:
    linter = TemplateLinter()
    diagnostics = linter.lint("{{ user.email }}", context={"user": {"name": "Alice"}})

    assert any(d.code == "missing_property" for d in diagnostics)


def test_template_linter_emits_type_mismatch_for_non_iterable_for_loop() -> None:
    linter = TemplateLinter()
    diagnostics = linter.lint(
        "{% for item in user.name %}{{ item }}{% end %}",
        context={"user": {"name": "Alice"}},
    )

    assert any(d.code == "type_mismatch" for d in diagnostics)


def test_template_linter_emits_undefined_variable_from_schema() -> None:
    linter = TemplateLinter()
    diagnostics = linter.lint(
        "{{ account.id }}",
        schema={
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                }
            },
        },
    )

    assert any(d.code == "undefined_variable" for d in diagnostics)


def test_template_linter_emits_missing_property_from_schema() -> None:
    linter = TemplateLinter()
    diagnostics = linter.lint(
        "{{ user.email }}",
        schema={
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                }
            },
        },
    )

    assert any(d.code == "missing_property" for d in diagnostics)


def test_template_linter_emits_type_mismatch_from_schema() -> None:
    linter = TemplateLinter()
    diagnostics = linter.lint(
        "{% for item in user.name %}{{ item }}{% end %}",
        schema={
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                }
            },
        },
    )

    assert any(d.code == "type_mismatch" for d in diagnostics)


def test_template_linter_loads_schema_from_path(tmp_path) -> None:
    schema_path = tmp_path / "schema.json"
    schema_path.write_text(
        json.dumps(
            {
                "type": "object",
                "properties": {
                    "user": {
                        "type": "object",
                        "properties": {"name": {"type": "string"}},
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    linter = TemplateLinter()
    diagnostics = linter.lint("{{ user.email }}", schema_path=str(schema_path))

    assert any(d.code == "missing_property" for d in diagnostics)


def test_template_linter_skips_semantic_checks_when_syntax_invalid() -> None:
    linter = TemplateLinter()
    diagnostics = linter.lint(
        "{% if user.active %}{{ user.name }}",
        context={"user": {"active": True, "name": "Alice"}},
    )

    assert any(d.severity == DiagnosticSeverity.ERROR for d in diagnostics)
    assert all(d.source != "temple-type-checker" for d in diagnostics)


def test_lint_orchestrator_forwards_semantic_context() -> None:
    orchestrator = LintOrchestrator()
    client = _FakeLanguageClient()
    diagnostics = orchestrator.lint_template(
        "{{ user.email }}",
        "file:///tmp/template.md.tmpl",
        client,
        semantic_context={"user": {"name": "Alice"}},
    )

    assert any(diag.code == "missing_property" for diag in diagnostics)
