"""Benchmarks for tokenizer pattern caching efficiency."""

import os
from temple import temple_tokenizer
from temple.template_tokenizer import _compile_token_pattern


def load_template_text(path):
    """Resolve path relative to repo root."""
    # Go up 3 levels: benchmarks -> asv -> temple -> repo root
    bench_dir = os.path.dirname(os.path.abspath(__file__))
    asv_dir = os.path.dirname(bench_dir)
    temple_dir = os.path.dirname(asv_dir)
    repo_root = os.path.dirname(temple_dir)
    full_path = os.path.join(repo_root, path)
    if not os.path.exists(full_path):
        alt_path = path.replace("examples/bench/", "examples/templates/bench/")
        alt_full = os.path.join(repo_root, alt_path)
        if os.path.exists(alt_full):
            full_path = alt_full

    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


class BenchPatternCaching:
    """Benchmark LRU cache efficiency for pattern compilation."""

    def setup(self):
        """Load templates."""
        self.tpl = load_template_text("examples/bench/real_small.md.tmpl")
        self.delims_default = {
            "statement": ("{%", "%}"),
            "expression": ("{{", "}}"),
            "comment": ("{#", "#}"),
        }
        self.delims_custom_1 = {
            "statement": ("<<", ">>"),
            "expression": ("<:", ":>"),
            "comment": ("<#", "#>"),
        }
        self.delims_custom_2 = {
            "statement": ("[%", "%]"),
            "expression": ("${", "}"),
            "comment": ("[!", "!]"),
        }
        # Clear cache for baseline measurement
        _compile_token_pattern.cache_clear()

    def time_repeated_same_delimiters(self):
        """Tokenize same template with same delimiters multiple times (tests cache hits)."""
        # After first call, pattern is cached; subsequent calls benefit from cache
        for _ in range(50):
            list(temple_tokenizer(self.tpl, self.delims_default))

    def time_repeated_different_delimiters(self):
        """Tokenize template with three different delimiter configs."""
        # Each delimiter config requires pattern compilation
        for i in range(20):
            delims = [self.delims_default, self.delims_custom_1, self.delims_custom_2]
            list(temple_tokenizer(self.tpl, delims[i % 3]))

    def time_mixed_templates_same_delimiters(self):
        """Tokenize different templates with same delimiters (all benefit from cache)."""
        tpl_small = load_template_text("examples/bench/real_small.md.tmpl")
        tpl_medium = load_template_text("examples/bench/real_medium.md.tmpl")
        tpl_large = load_template_text("examples/bench/real_large.html.tmpl")

        for _ in range(10):
            list(temple_tokenizer(tpl_small, self.delims_default))
            list(temple_tokenizer(tpl_medium, self.delims_default))
            list(temple_tokenizer(tpl_large, self.delims_default))


class BenchCacheWarming:
    """Benchmark the effect of cache warming."""

    def setup(self):
        """Prepare templates and delimiters."""
        self.tpl = load_template_text("examples/bench/real_medium.md.tmpl")
        self.delims = {
            "statement": ("{%", "%}"),
            "expression": ("{{", "}}"),
            "comment": ("{#", "#}"),
        }

    def time_cold_cache(self):
        """Tokenize with cold cache (first call compiles pattern)."""
        _compile_token_pattern.cache_clear()
        list(temple_tokenizer(self.tpl, self.delims))

    def time_warm_cache(self):
        """Tokenize with warm cache (pattern already compiled)."""
        # Cache is warmed by setup or previous calls
        list(temple_tokenizer(self.tpl, self.delims))
