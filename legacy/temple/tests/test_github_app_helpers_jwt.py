import os
import importlib.util
import types


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_create_jwt_monkeypatch(tmp_path):
    path = os.path.join(os.getcwd(), "scripts", "ci", "github_app_helpers.py")
    mod = _load_module(path, "ci.github_app_helpers_test_jwt")

    # If the module's jwt is unavailable, monkeypatch a fake one
    fake_jwt = types.SimpleNamespace()
    fake_jwt.encode = lambda payload, key, algorithm: b"fake-token"
    mod.jwt = fake_jwt

    # create a temporary private key file (contents are not inspected by fake encoder)
    pk = tmp_path / "private.pem"
    pk.write_text("FAKE-KEY")

    token = mod.create_jwt("not-an-int", str(pk))
    assert isinstance(token, str)
    assert token == "fake-token"
