import types
import pytest


def _make_response(status_code=200, data=None):
    class Resp:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data or {}

        def json(self):
            return self._data

        def raise_for_status(self):
            if not (200 <= self.status_code < 300):
                raise RuntimeError(f"HTTP {self.status_code}")

    return Resp(status_code, data)


def test_combined_status_checks_pending(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    def fake_get(url, headers=None):
        # checks_url
        if url.endswith("/check-runs"):
            return _make_response(
                200, {"check_runs": [{"status": "in_progress", "name": "ci"}]}
            )
        return _make_response(200, {"state": "success"})

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(get=fake_get, post=None))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "pending"


def test_combined_status_checks_failure(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    def fake_get(url, headers=None):
        if url.endswith("/check-runs"):
            return _make_response(
                200,
                {
                    "check_runs": [
                        {"status": "completed", "conclusion": "failure", "name": "ci"}
                    ]
                },
            )
        return _make_response(200, {"state": "failure"})

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(get=fake_get, post=None))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "failure"


def test_combined_status_fallback_to_legacy(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    # Simulate checks endpoint returning non-200
    def fake_get(url, headers=None):
        if url.endswith("/check-runs"):
            return _make_response(500, {})
        return _make_response(200, {"state": "success"})

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(get=fake_get, post=None))
    res = mod.combined_status("owner/repo", "deadbeef", "tok")
    assert res == "success"


def test_git_fetch_base_failure(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    class P:
        def __init__(self):
            self.returncode = 1
            self.stdout = ""
            self.stderr = "err"

    monkeypatch.setattr(
        mod, "subprocess", types.SimpleNamespace(run=lambda *a, **k: P())
    )
    with pytest.raises(RuntimeError):
        mod.git_fetch_base("main")


def test_graphql_query_error_raises(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    def fake_post(url, json=None, headers=None):
        return _make_response(200, {"errors": [{"message": "bad"}]})

    monkeypatch.setattr(
        mod, "requests", types.SimpleNamespace(post=fake_post, get=None)
    )
    with pytest.raises(RuntimeError):
        mod.graphql_query("owner/repo", "q", {}, "tok")


def test_post_thread_reply_success(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    captured = {}

    def fake_post(url, headers=None, json=None):
        captured["url"] = url
        captured["payload"] = json
        return _make_response(201, {"id": 1})

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(post=fake_post))
    mod.post_thread_reply("owner/repo", 5, 99, "hi", "tok")
    assert captured["payload"]["in_reply_to"] == 99


def _fake_graphql_response(nodes):
    return {
        "data": {"repository": {"pullRequest": {"reviewThreads": {"nodes": nodes}}}}
    }


def test_list_review_threads_prefers_start_line(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    nodes = [{"id": "t1", "isResolved": False, "path": "a.py", "start": {"line": 42}}]

    def fake_post(url, json=None, headers=None):
        return _make_response(200, _fake_graphql_response(nodes))

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(post=fake_post))
    out = mod.list_review_threads("o/r", 1, "tok")
    assert out[0].get("start", {}).get("line") == 42


def test_list_review_threads_uses_comment_line_when_no_start(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    nodes = [
        {
            "id": "t2",
            "isResolved": False,
            "path": "b.py",
            "comments": {"nodes": [{"databaseId": 1, "line": 10}]},
        }
    ]

    def fake_post(url, json=None, headers=None):
        return _make_response(200, _fake_graphql_response(nodes))

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(post=fake_post))
    out = mod.list_review_threads("o/r", 1, "tok")
    assert out[0].get("start", {}).get("line") == 10


def test_list_review_threads_uses_originalLine_if_line_missing(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    nodes = [
        {
            "id": "t3",
            "isResolved": False,
            "path": "c.py",
            "comments": {"nodes": [{"databaseId": 2, "originalLine": 11}]},
        }
    ]

    def fake_post(url, json=None, headers=None):
        return _make_response(200, _fake_graphql_response(nodes))

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(post=fake_post))
    out = mod.list_review_threads("o/r", 1, "tok")
    assert out[0].get("start", {}).get("line") == 11


def test_list_review_threads_falls_back_to_position(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    nodes = [
        {
            "id": "t4",
            "isResolved": False,
            "path": "d.py",
            "comments": {"nodes": [{"databaseId": 3, "position": 5}]},
        }
    ]

    def fake_post(url, json=None, headers=None):
        return _make_response(200, _fake_graphql_response(nodes))

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(post=fake_post))
    out = mod.list_review_threads("o/r", 1, "tok")
    assert out[0].get("start", {}).get("line") == 5


def test_list_review_threads_no_position_or_line(monkeypatch):
    mod = __import__("scripts.ci.auto_resolve_reviews", fromlist=["*"])

    nodes = [
        {
            "id": "t5",
            "isResolved": False,
            "path": "e.py",
            "comments": {"nodes": [{"databaseId": 4}]},
        }
    ]

    def fake_post(url, json=None, headers=None):
        return _make_response(200, _fake_graphql_response(nodes))

    monkeypatch.setattr(mod, "requests", types.SimpleNamespace(post=fake_post))
    out = mod.list_review_threads("o/r", 1, "tok")
    # No start line should be set
    assert out[0].get("start") is None or out[0].get("start", {}).get("line") is None
