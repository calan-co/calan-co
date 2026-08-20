import os
from pathlib import Path
import importlib
import importlib.util


def _repo_root_from_module(mod):
    bench_dir = os.path.dirname(os.path.abspath(mod.__file__))
    asv_dir = os.path.dirname(bench_dir)
    temple_dir = os.path.dirname(asv_dir)
    repo_root = os.path.dirname(temple_dir)
    return repo_root


def _ensure_parent(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)


def _write(path: Path, data: str):
    _ensure_parent(path)
    path.write_text(data, encoding="utf-8")


def _cleanup(path: Path):
    try:
        if path.exists():
            path.unlink()
    except Exception:
        # Best-effort cleanup: ignore errors (e.g., race conditions or
        # missing files) during test teardown rather than failing the test.
        pass


def _smoke_test_module(mod_name: str):
    """Load module by file path so tests work without an installed package.

    This derives the module file under the repo `temple/` tree from the dotted
    `mod_name` and imports it directly.
    """
    parts = mod_name.split(".")
    # Resolve module file under repo: temple/asv/benchmarks/<module>.py
    # repo root is one level above `tests/`
    repo_root = Path(__file__).resolve().parents[1]
    module_file = repo_root / "temple" / "asv" / "benchmarks" / f"{parts[-1]}.py"
    spec = importlib.util.spec_from_file_location(mod_name, str(module_file))
    mod = importlib.util.module_from_spec(spec)
    loader = spec.loader
    assert loader is not None
    loader.exec_module(mod)  # type: ignore
    repo_root = Path(_repo_root_from_module(mod))

    # Primary path test
    primary_rel = "examples/bench/test_temp_smoke.tmpl"
    primary_full = repo_root / primary_rel
    try:
        _write(primary_full, "primary-content")
        got = mod.load_template_text(primary_rel)
        assert "primary-content" in got
    finally:
        _cleanup(primary_full)

    # Fallback path test: primary missing, alt exists under examples/templates/bench
    primary_rel2 = "examples/bench/test_temp_smoke_missing.tmpl"
    alt_rel = "examples/templates/bench/test_temp_smoke_missing.tmpl"
    alt_full = repo_root / alt_rel
    try:
        # ensure primary does not exist
        _cleanup(repo_root / primary_rel2)
        _write(alt_full, "alt-content")
        got2 = mod.load_template_text(primary_rel2)
        assert "alt-content" in got2
    finally:
        _cleanup(alt_full)


def test_bench_renderer_loader_smoke():
    _smoke_test_module("temple.asv.benchmarks.bench_renderer")


def test_bench_pattern_caching_loader_smoke():
    _smoke_test_module("temple.asv.benchmarks.bench_pattern_caching")


def test_bench_tokenizer_delimiters_loader_smoke():
    _smoke_test_module("temple.asv.benchmarks.bench_tokenizer_delimiters")
