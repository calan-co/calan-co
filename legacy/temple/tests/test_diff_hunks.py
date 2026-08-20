import os
import importlib.util


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parse_unified_diff_hunks_simple_add():
    path = os.path.join(os.getcwd(), "scripts", "ci", "auto_resolve_reviews.py")
    mod = _load_module(path, "ci.auto_resolve_reviews_test")
    diff = """
+++ b/foo.txt
@@ -0,0 +1,3 @@
+a
+b
+c
"""
    result = mod.parse_unified_diff_hunks(diff)
    assert "foo.txt" in result
    assert result["foo.txt"] == [(1, 3)]


def test_parse_unified_diff_hunks_skip_zero_length():
    path = os.path.join(os.getcwd(), "scripts", "ci", "auto_resolve_reviews.py")
    mod = _load_module(path, "ci.auto_resolve_reviews_test2")
    diff = """
+++ b/bar.txt
@@ -5,3 +5,0 @@
"""
    result = mod.parse_unified_diff_hunks(diff)
    # zero-length hunks should be skipped
    assert result.get("bar.txt") == [] or result.get("bar.txt") is None
