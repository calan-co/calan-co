"""Smoke tests for packaged LSP entrypoint wiring."""

from importlib import import_module
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore[no-redef]

from temple_linter import lsp_server


def test_lsp_server_main_exists() -> None:
    assert callable(lsp_server.main)


def test_lsp_server_main_dispatches_to_start_io(monkeypatch) -> None:
    called = {"start_io": False}

    def fake_start_io() -> None:
        called["start_io"] = True

    monkeypatch.setattr(lsp_server.ls, "start_io", fake_start_io)

    exit_code = lsp_server.main()

    assert called["start_io"] is True
    assert exit_code == 0


def test_console_entrypoint_target_is_importable() -> None:
    module = import_module("temple_linter.lsp_server")
    target = getattr(module, "main", None)
    assert callable(target)


def test_pyproject_entrypoint_and_python_constraint() -> None:
    pyproject_path = Path(__file__).resolve().parents[1] / "pyproject.toml"
    pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))

    assert pyproject["project"]["scripts"]["temple-linter-lsp"] == "temple_linter.lsp_server:main"
    assert pyproject["project"]["requires-python"] == ">=3.10"


def test_setup_py_matches_entrypoint_and_python_constraint() -> None:
    setup_path = Path(__file__).resolve().parents[1] / "setup.py"
    setup_text = setup_path.read_text(encoding="utf-8")

    assert "temple_linter.lsp_server:main" in setup_text
    assert 'python_requires=">=3.10"' in setup_text
