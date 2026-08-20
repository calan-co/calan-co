"""E2E and performance-threshold tests for temple-linter."""

from __future__ import annotations

import os
import time

from lsprotocol.types import Diagnostic as LspDiagnostic
from lsprotocol.types import Position as LspPosition
from lsprotocol.types import Range as LspRange

from temple.compiler.schema import SchemaParser
from temple_linter.services.lint_orchestrator import LintOrchestrator

_DEFAULT_PERF_THRESHOLD_MULTIPLIER = 3.0


def _perf_threshold_multiplier() -> float:
    raw = os.getenv("TEMPLE_PERF_THRESHOLD_MULTIPLIER")
    if raw is None:
        return _DEFAULT_PERF_THRESHOLD_MULTIPLIER
    try:
        parsed = float(raw)
    except ValueError:
        return _DEFAULT_PERF_THRESHOLD_MULTIPLIER
    return max(parsed, 0.1)


class _FakeResult:
    def __init__(self, payload):
        self._payload = payload

    def result(self, timeout=None):
        return self._payload


class _FakeProtocol:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def send_request(self, method, params):
        self.requests.append((method, params))
        return _FakeResult(self.payload)


class _FakeTransport:
    def __init__(self, payload):
        self.protocol = _FakeProtocol(payload)


def _base_payload(message: str = "base diagnostic") -> dict:
    return {
        "diagnostics": [
            LspDiagnostic(
                range=LspRange(
                    start=LspPosition(line=0, character=0),
                    end=LspPosition(line=0, character=1),
                ),
                message=message,
                severity=1,
                source="json",
            )
        ]
    }


def test_e2e_pipeline_merges_semantic_and_base_diagnostics() -> None:
    orchestrator = LintOrchestrator()
    transport = _FakeTransport(_base_payload("base format issue"))
    schema = SchemaParser.from_json_schema(
        {
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                    },
                }
            },
        }
    )

    diagnostics = orchestrator.lint_template(
        '{"name":"{{ user.name }}","email":"{{ user.email }}"}',
        "file:///tmp/user.json.tmpl",
        transport,
        semantic_schema=schema,
    )

    assert any(diag.message == "base format issue" for diag in diagnostics)
    assert any(
        diag.source == "temple-type-checker"
        or str(getattr(diag, "code", "")) == "PARSER_DEPENDENCY_MISSING"
        for diag in diagnostics
    )
    assert transport.protocol.requests


def test_large_template_lint_stays_under_threshold() -> None:
    orchestrator = LintOrchestrator()
    transport = _FakeTransport({"diagnostics": []})
    template = "\n".join(f"{{{{ user.field_{i} }}}}" for i in range(400))

    started = time.perf_counter()
    diagnostics = orchestrator.lint_template(
        template,
        "file:///tmp/perf.json.tmpl",
        transport,
    )
    elapsed = time.perf_counter() - started

    assert isinstance(diagnostics, list)
    assert elapsed < (1.5 * _perf_threshold_multiplier())


def test_small_edit_lint_stays_under_threshold() -> None:
    orchestrator = LintOrchestrator()
    transport = _FakeTransport({"diagnostics": []})
    template = "\n".join(f"{{{{ user.field_{i} }}}}" for i in range(150))

    _ = orchestrator.lint_template(
        template,
        "file:///tmp/perf.json.tmpl",
        transport,
    )

    updated_template = template + "\n{{ user.field_151 }}"
    started = time.perf_counter()
    diagnostics = orchestrator.lint_template(
        updated_template,
        "file:///tmp/perf.json.tmpl",
        transport,
    )
    elapsed = time.perf_counter() - started

    assert isinstance(diagnostics, list)
    assert elapsed < (1.0 * _perf_threshold_multiplier())
