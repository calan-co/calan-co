import importlib.util
import os


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "auto_resolve", os.path.join(os.path.dirname(__file__), "..", "scripts", "ci", "auto_resolve_reviews.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeResp:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data or {}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_combined_status_pending(monkeypatch):
    mod = _load_module()

    def fake_get(url, headers=None):
        if "check-runs" in url:
            return _FakeResp(200, {"check_runs": [{"name": "t1", "status": "in_progress", "conclusion": None}]})
        return _FakeResp(200, {"state": "success"})

    monkeypatch.setattr(mod, "requests", type("R", (), {"get": staticmethod(fake_get)}))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "pending"


def test_combined_status_failure(monkeypatch):
    mod = _load_module()

    def fake_get(url, headers=None):
        if "check-runs" in url:
            return _FakeResp(200, {"check_runs": [{"name": "t1", "status": "completed", "conclusion": "failure"}]})
        return _FakeResp(200, {"state": "failure"})

    monkeypatch.setattr(mod, "requests", type("R", (), {"get": staticmethod(fake_get)}))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "failure"


def test_combined_status_neutral_all(monkeypatch):
    mod = _load_module()

    def fake_get(url, headers=None):
        if "check-runs" in url:
            return _FakeResp(200, {"check_runs": [
                {"name": "t1", "status": "completed", "conclusion": "neutral"},
                {"name": "t2", "status": "completed", "conclusion": "neutral"},
            ]})
        return _FakeResp(200, {"state": "success"})

    monkeypatch.setattr(mod, "requests", type("R", (), {"get": staticmethod(fake_get)}))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "success"


def test_combined_status_fallback_legacy(monkeypatch):
    mod = _load_module()

    def fake_get(url, headers=None):
        if "check-runs" in url:
            return _FakeResp(503, {})
        return _FakeResp(200, {"state": "failure"})

    monkeypatch.setattr(mod, "requests", type("R", (), {"get": staticmethod(fake_get)}))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "failure"
