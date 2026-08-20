import types


def test_create_jwt_uses_jwt_encode(monkeypatch, tmp_path):
    mod = __import__("scripts.ci.github_app_helpers", fromlist=["*"])

    called = {}

    class FakeJwt:
        @staticmethod
        def encode(payload, key, algorithm=None):
            called["payload"] = payload
            called["key"] = key
            called["alg"] = algorithm
            return b"tokbytes"

    monkeypatch.setattr(mod, "jwt", FakeJwt)
    p = tmp_path / "key.pem"
    p.write_text("PRIVATE")
    token = mod.create_jwt("123", str(p))
    assert token == "tokbytes"
    assert called["alg"] == "RS256"
    assert int(called["payload"]["iss"]) == 123


def test_list_installations_and_create_token(monkeypatch):
    mod = __import__("scripts.ci.github_app_helpers", fromlist=["*"])

    captured = {}

    class Resp:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data

        def json(self):
            return self._data

        def raise_for_status(self):
            if not (200 <= self.status_code < 300):
                raise RuntimeError(f"HTTP {self.status_code}")

    def fake_get(url, headers=None):
        captured.setdefault("gets", []).append((url, headers))
        return Resp(200, [{"id": 5, "account": {"login": "owner"}}])

    def fake_post(url, headers=None):
        captured.setdefault("posts", []).append((url, headers))
        return Resp(201, {"token": "itok"})

    monkeypatch.setattr(
        mod, "requests", types.SimpleNamespace(get=fake_get, post=fake_post)
    )
    # list_installations
    installs = mod.list_installations("jwt")
    assert isinstance(installs, list)
    # create_installation_token
    tok = mod.create_installation_token("jwt", "5")
    assert tok == "itok"
