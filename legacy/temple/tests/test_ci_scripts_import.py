import importlib.util
import os


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parse_unified_diff_hunks_zero_length():
    path = os.path.join(os.getcwd(), "scripts", "ci", "auto_resolve_reviews.py")
    spec = importlib.util.spec_from_file_location("ci.auto_resolve_reviews_test2", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    diff = """
+++ b/bar.txt
@@ -5,3 +5,0 @@
"""
    result = mod.parse_unified_diff_hunks(diff)
    assert result.get("bar.txt") == [] or result.get("bar.txt") is None


def test_github_app_helpers_loads():
    path = os.path.join(os.getcwd(), "scripts", "ci", "github_app_helpers.py")
    mod = _load_module(path, "ci.github_app_helpers_test")
    assert hasattr(mod, "create_jwt")


def test_auto_resolve_reviews_loads():
    path = os.path.join(os.getcwd(), "scripts", "ci", "auto_resolve_reviews.py")
    mod = _load_module(path, "ci.auto_resolve_reviews_test")
    assert hasattr(mod, "parse_unified_diff_hunks")
