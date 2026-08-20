from importlib.machinery import SourceFileLoader
from importlib import util
from pathlib import Path


def load_module():
    path = Path("scripts/ci/sim_asv_env.py").resolve()
    loader = SourceFileLoader("sim_asv_env", str(path))
    spec = util.spec_from_loader(loader.name, loader)
    if spec is None:
        raise ValueError(f"Failed to create module spec for {loader.name}")
    mod = util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def test_inspect_path(tmp_path: Path):
    mod = load_module()
    d = tmp_path / "pkg"
    d.mkdir()
    # create a pyproject.toml to mark installable
    (d / "pyproject.toml").write_text('[tool.poetry]\nname = "x"\n')
    info = mod.inspect_path(d)
    assert info["exists"] is True
    assert info["pyproject.toml"] is True
