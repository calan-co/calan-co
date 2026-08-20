import pytest


def test_parse_unified_diff_hunks_basic():
    from scripts.ci.auto_resolve_reviews import parse_unified_diff_hunks
    import textwrap

    diff = textwrap.dedent("""
    +++ b/foo.txt
    @@ -1,2 +1,3 @@
    +lineA
    @@ -10,0 +11,2 @@
    +ins1
    +ins2
    +++ b/bar.txt
    @@ -3,1 +3,1 @@
    +barchange
    """)

    parsed = parse_unified_diff_hunks(diff)
    assert parsed == {
        "foo.txt": [(1, 3), (11, 12)],
        "bar.txt": [(3, 3)],
    }


def test_post_thread_reply_requires_requests():
    import importlib

    mod = importlib.import_module("scripts.ci.auto_resolve_reviews")
    orig = getattr(mod, "requests", None)
    try:
        mod.requests = None
        with pytest.raises(RuntimeError):
            mod.post_thread_reply("owner/repo", 1, 123, "hi", "tok")
    finally:
        mod.requests = orig
