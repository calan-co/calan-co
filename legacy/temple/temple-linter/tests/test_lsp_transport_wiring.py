"""Transport wiring tests for base diagnostics delegation."""

from lsprotocol.types import Diagnostic as LspDiagnostic
from lsprotocol.types import Position as LspPosition
from lsprotocol.types import Range as LspRange

from temple_linter.services.base_linting_service import BaseLintingService
from temple_linter.services.lint_orchestrator import LintOrchestrator


class _FakeResult:
    def __init__(self, payload):
        self._payload = payload

    def result(self, timeout=None):
        return self._payload


class _FakeProtocol:
    def __init__(self, payload):
        self.payload = payload
        self.sent = []

    def send_request(self, method, params):
        self.sent.append((method, params))
        return _FakeResult(self.payload)


class _ServerTransport:
    """Mimics pygls server transport where protocol is a callable method."""

    def __init__(self, payload):
        self._protocol = _FakeProtocol(payload)

    def protocol(self):
        return self._protocol


def _diagnostics_payload():
    return {
        "diagnostics": [
            LspDiagnostic(
                range=LspRange(
                    start=LspPosition(line=0, character=0),
                    end=LspPosition(line=0, character=1),
                ),
                message="base diagnostic",
                severity=1,
                source="json",
            )
        ]
    }


def test_base_linting_service_supports_server_protocol_method() -> None:
    service = BaseLintingService()
    transport = _ServerTransport(_diagnostics_payload())

    diagnostics = service.request_base_diagnostics(
        transport,
        cleaned_text="{}",
        original_uri="file:///tmp/config.json.tmpl",
        detected_format="json",
        original_filename="config.json.tmpl",
        temple_extensions=[".tmpl"],
    )

    assert len(diagnostics) == 1
    assert transport._protocol.sent[0][0] == "temple/requestBaseDiagnostics"


def test_base_linting_service_gracefully_handles_missing_protocol() -> None:
    service = BaseLintingService()
    diagnostics = service.request_base_diagnostics(
        object(),
        cleaned_text="{}",
        original_uri="file:///tmp/config.json.tmpl",
        detected_format="json",
        original_filename="config.json.tmpl",
        temple_extensions=[".tmpl"],
    )

    assert diagnostics == []


def test_orchestrator_uses_session_transport_for_base_diagnostics() -> None:
    orchestrator = LintOrchestrator()
    transport = _ServerTransport(_diagnostics_payload())

    diagnostics = orchestrator.lint_template(
        "{}",
        "file:///tmp/config.json.tmpl",
        transport,
    )

    assert any(diag.message == "base diagnostic" for diag in diagnostics)
    assert any((diag.source or "").startswith("temple-base:") for diag in diagnostics)


def test_orchestrator_dedupes_identical_diagnostics() -> None:
    orchestrator = LintOrchestrator()
    transport = _ServerTransport({"diagnostics": []})

    diagnostics = orchestrator.lint_template(
        "{{ user. }}",
        "file:///tmp/example.tmpl",
        transport,
    )

    keys = {
        (
            diag.source,
            str(getattr(diag, "code", "")),
            diag.message,
            diag.range.start.line,
            diag.range.start.character,
            diag.range.end.line,
            diag.range.end.character,
        )
        for diag in diagnostics
    }
    assert len(keys) == len(diagnostics)


def test_orchestrator_prefers_unclosed_delimiter_over_cascading_token_error() -> None:
    orchestrator = LintOrchestrator()
    transport = _ServerTransport({"diagnostics": []})

    diagnostics = orchestrator.lint_template(
        "{{ user.name",
        "file:///tmp/example.tmpl",
        transport,
    )
    codes = {str(getattr(diag, "code", "")) for diag in diagnostics}

    assert "UNCLOSED_DELIMITER" in codes
    assert "UNEXPECTED_TOKEN" not in codes


def test_orchestrator_skips_base_lint_when_template_has_blocking_syntax_error() -> None:
    orchestrator = LintOrchestrator()
    transport = _ServerTransport(_diagnostics_payload())

    diagnostics = orchestrator.lint_template(
        "{% en %}",
        "file:///tmp/example.md.tmpl",
        transport,
    )

    assert not any(diag.message == "base diagnostic" for diag in diagnostics)
    assert transport._protocol.sent == []


def test_orchestrator_marks_base_diagnostic_with_default_source_when_missing() -> None:
    orchestrator = LintOrchestrator()
    payload = {
        "diagnostics": [
            LspDiagnostic(
                range=LspRange(
                    start=LspPosition(line=0, character=0),
                    end=LspPosition(line=0, character=1),
                ),
                message="base without source",
                severity=1,
            )
        ]
    }
    transport = _ServerTransport(payload)

    diagnostics = orchestrator.lint_template(
        "{}",
        "file:///tmp/config.json.tmpl",
        transport,
    )

    assert any(diag.message == "base without source" for diag in diagnostics)
    assert any((diag.source or "") == "temple-base" for diag in diagnostics)
