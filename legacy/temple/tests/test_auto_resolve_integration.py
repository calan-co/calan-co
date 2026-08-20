import types
import importlib
import pytest


@pytest.fixture(autouse=True)
def env_vars(monkeypatch, tmp_path):
    monkeypatch.setenv("REPOSITORY", "owner/repo")
    monkeypatch.setenv("PR_NUMBER", "1")
    monkeypatch.setenv("HEAD_SHA", "deadbeef")
    monkeypatch.setenv("BASE_REF", "main")
    monkeypatch.setenv("DRY_RUN", "1")
    monkeypatch.setenv("GITHUB_PR_AUTORESOLVE_TOKEN", "tok")
    yield


def test_main_dry_run_resolves_thread(monkeypatch, capsys):
    mod = importlib.import_module("scripts.ci.auto_resolve_reviews")

    # Mock requests.get and post
    class Resp:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data

        def json(self):
            return self._data

        def raise_for_status(self):
            if not (200 <= self.status_code < 300):
                raise RuntimeError(f"HTTP {self.status_code}")

    def fake_get(url, headers=None, params=None):
        # checks endpoint
        if url.endswith("/check-runs"):
            return Resp(
                200,
                {
                    "check_runs": [
                        {"status": "completed", "conclusion": "success", "name": "ci"}
                    ]
                },
            )
        # legacy status
        if url.endswith("/status"):
            return Resp(200, {"state": "success"})
        # PR files
        if "/pulls/1/files" in url:
            # Honor pagination: return results for page 1, empty for subsequent pages
            page = (params or {}).get("page", 1)
            if int(page) > 1:
                return Resp(200, [])
            return Resp(200, [{"filename": "foo.txt"}])
        # PR body
        if url.endswith("/pulls/1"):
            return Resp(
                200,
                {
                    "body": "",
                },
            )
        # commits list
        if url.endswith("/pulls/1/commits"):
            return Resp(200, [])
        raise RuntimeError(f"unexpected GET {url}")

    def fake_post(url, json=None, headers=None):
        # GraphQL
        if url.endswith("/graphql"):
            # return one thread with start line 3 and a comment with databaseId
            data = {
                "data": {
                    "repository": {
                        "pullRequest": {
                            "reviewThreads": {
                                "nodes": [
                                    {
                                        "id": "thread:1",
                                        "isResolved": False,
                                        "isOutdated": False,
                                        "path": "foo.txt",
                                        "start": {"line": 3},
                                        "comments": {"nodes": [{"databaseId": 123}]},
                                    }
                                ]
                            }
                        }
                    }
                }
            }
            return Resp(200, data)
        # post comment or thread-reply
        if "/issues/1/comments" in url or "/pulls/1/comments" in url:
            return Resp(201, {"id": 1})
        raise RuntimeError(f"unexpected POST {url}")

    monkeypatch.setattr(
        mod, "requests", types.SimpleNamespace(get=fake_get, post=fake_post)
    )

    # Mock subprocess.run for git fetch and git diff
    class Proc:
        def __init__(self, stdout=""):
            self.returncode = 0
            self.stdout = stdout
            self.stderr = ""

    def fake_run(cmd, capture_output=False, text=False, **kwargs):
        cmd_str = " ".join(cmd)
        if "git fetch" in cmd_str:
            return Proc()
        if "git diff" in cmd_str:
            # produce a diff where foo.txt has a hunk covering line 3
            diff = "+++ b/foo.txt\n@@ -1,1 +1,3 @@\n+\n+\n+@@ -2,0 +3,1 @@\n++newline\n"
            return Proc(stdout=diff)
        return Proc()

    monkeypatch.setattr(mod, "subprocess", types.SimpleNamespace(run=fake_run))

    # Run main (should not raise)
    rc = mod.main()
    captured = capsys.readouterr()
    assert rc == 0
    assert "DRY RUN" in captured.out
    assert "would resolve" in captured.out or "DRY RUN summary" in captured.out
