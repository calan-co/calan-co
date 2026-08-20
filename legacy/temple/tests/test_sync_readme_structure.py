import importlib.util
import sys
from pathlib import Path

import pytest


def _load_sync_module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "docs" / "sync_readme_structure.py"
    module_name = "docs.sync_readme_structure_test"
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_parse_render_specs_rejects_unknown_key_flag_style() -> None:
    mod = _load_sync_module()
    with pytest.raises(ValueError, match="unrecognized attribute key: --exclude"):
        mod.parse_render_specs("path=temple-linter --exclude=.*")


def test_parse_render_specs_rejects_bare_flag_token() -> None:
    mod = _load_sync_module()
    with pytest.raises(ValueError, match="invalid attribute token"):
        mod.parse_render_specs("path=temple-linter --exclude")


def test_parse_render_specs_accepts_supported_keys() -> None:
    mod = _load_sync_module()
    specs = mod.parse_render_specs(
        "path=temple-linter depth=2 annotations=temple-linter/.structure-notes.yaml section=project exclude=.* include=.vscode/**"
    )
    assert len(specs) == 1
    assert specs[0].path == "temple-linter"
    assert specs[0].depth == 2
    assert specs[0].section == "project"
    assert specs[0].excludes == (".*",)
    assert specs[0].includes == (".vscode/**",)


def test_include_flag_forces_inclusion_of_matching_paths(tmp_path: Path) -> None:
    mod = _load_sync_module()

    (tmp_path / "src" / "temple_linter").mkdir(parents=True)
    (tmp_path / "src" / "temple_linter" / "lsp_server.py").write_text(
        "pass", encoding="utf-8"
    )
    (tmp_path / "src" / "other").mkdir(parents=True)
    (tmp_path / "src" / "other" / "skip.py").write_text("pass", encoding="utf-8")
    (tmp_path / ".benchmarks").mkdir()
    (tmp_path / ".benchmarks" / "notes.txt").write_text("x", encoding="utf-8")

    ignore_config = mod.IgnoreConfig(excluded_files=(".git",), rules=())
    lines, _ = mod.build_tree_lines(
        root_path=tmp_path,
        label="demo",
        depth=1,
        repo_root=tmp_path,
        ignore_config=ignore_config,
        ad_hoc_excludes=(".*",),
        ad_hoc_includes=("src/temple_linter/**",),
        annotations={},
    )
    rendered = "\n".join(lines)
    assert "src/" in rendered
    assert "temple_linter/" in rendered
    assert "lsp_server.py" in rendered
    assert "other/" not in rendered
    assert "skip.py" not in rendered
    assert ".benchmarks/" not in rendered
