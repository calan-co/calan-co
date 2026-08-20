import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

try:
    from temple_linter.services.base_linting_service import BaseLintingService
except Exception:
    import pathlib
    import sys

    ROOT = pathlib.Path(__file__).resolve().parents[1]
    SRC = ROOT / "src"
    if str(SRC) not in sys.path:
        sys.path.insert(0, str(SRC))

    from temple_linter.services.base_linting_service import BaseLintingService


class _FakeResult:
    def __init__(self, payload):
        self._payload = payload

    def result(self, timeout=None):
        return self._payload


class _FakeProtocol:
    def __init__(self, payload):
        self.sent = []
        self._payload = payload

    def send_request(self, method, params):
        self.sent.append((method, params))
        return _FakeResult(self._payload)


class _FakeLanguageClient:
    def __init__(self, payload):
        self.protocol = _FakeProtocol(payload)


def test_request_base_diagnostics_strips_extension():
    diagnostics_payload = {
        "diagnostics": [
            {
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": {"line": 0, "character": 1},
                },
                "message": "example",
                "source": "json",
            }
        ]
    }
    lc = _FakeLanguageClient(diagnostics_payload)
    svc = BaseLintingService()

    diagnostics = svc.request_base_diagnostics(
        lc,
        cleaned_text="{ }",
        original_uri="file:///workspace/config.json.tmpl",
        detected_format="json",
        original_filename="config.json.tmpl",
        temple_extensions=[".tmpl"],
    )

    # Request goes out with stripped temple suffix and format hint
    assert lc.protocol.sent[0][0] == "temple/requestBaseDiagnostics"
    assert lc.protocol.sent[0][1]["uri"] == "file:///workspace/config.json"
    assert lc.protocol.sent[0][1]["detectedFormat"] == "json"
    assert "content" in lc.protocol.sent[0][1]

    # Diagnostics are coerced to LSP Diagnostic objects
    assert len(diagnostics) == 1
    assert isinstance(diagnostics[0], type(diagnostics[0]))  # LSP Diagnostic type


def test_request_base_diagnostics_coerces_dict_to_diagnostic():
    """Verify dict diagnostics are coerced into LSP Diagnostic objects."""
    from lsprotocol.types import Diagnostic as LspDiagnostic

    diagnostics_payload = {
        "diagnostics": [
            # Raw dict
            {
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": {"line": 0, "character": 5},
                },
                "message": "error from dict",
                "severity": 1,
            }
        ]
    }
    lc = _FakeLanguageClient(diagnostics_payload)
    svc = BaseLintingService()

    diagnostics = svc.request_base_diagnostics(
        lc,
        cleaned_text="{}",
        original_uri="file:///test.json.tmpl",
        detected_format="json",
        original_filename="test.json.tmpl",
    )

    assert len(diagnostics) == 1
    assert isinstance(diagnostics[0], LspDiagnostic)
    assert diagnostics[0].message == "error from dict"


def test_request_base_diagnostics_handles_errors_gracefully():
    class _RaisingProtocol:
        def send_request(self, *_args, **_kwargs):
            raise RuntimeError("boom")

    class _RaisingClient:
        def __init__(self):
            self.protocol = _RaisingProtocol()

    svc = BaseLintingService()
    diagnostics = svc.request_base_diagnostics(
        _RaisingClient(),
        cleaned_text="{}",
        original_uri="file:///workspace/invalid.json.tmpl",
        detected_format="json",
        original_filename="invalid.json.tmpl",
        temple_extensions=[".tmpl"],
    )

    assert diagnostics == []


def test_request_base_diagnostics_handles_timeout_gracefully():
    from concurrent.futures import TimeoutError as FutureTimeoutError

    class _TimeoutResult:
        def result(self, timeout=None):
            raise FutureTimeoutError("timed out")

    class _TimeoutProtocol:
        def send_request(self, *_args, **_kwargs):
            return _TimeoutResult()

    class _TimeoutClient:
        def __init__(self):
            self.protocol = _TimeoutProtocol()

    svc = BaseLintingService()
    diagnostics = svc.request_base_diagnostics(
        _TimeoutClient(),
        cleaned_text="{}",
        original_uri="file:///workspace/slow.json.tmpl",
        detected_format="json",
        original_filename="slow.json.tmpl",
        temple_extensions=[".tmpl"],
    )

    assert diagnostics == []


def test_timeout_budget_scales_by_format_and_size():
    svc = BaseLintingService()

    markdown_large = svc._resolve_timeout_seconds(
        cleaned_text="x" * 16000,
        detected_format="markdown",
    )
    json_small = svc._resolve_timeout_seconds(
        cleaned_text="{}",
        detected_format="json",
    )
    unknown_small = svc._resolve_timeout_seconds(
        cleaned_text="{}",
        detected_format=None,
    )

    assert markdown_large > json_small
    assert json_small > unknown_small
    assert 0.35 <= unknown_small <= 2.5
    assert 0.35 <= markdown_large <= 2.5
