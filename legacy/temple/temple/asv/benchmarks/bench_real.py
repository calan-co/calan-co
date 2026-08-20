"""Benchmarks for real-world template tokenization."""

import os
from temple import temple_tokenizer


def load_template_text(path):
    # Resolve path relative to repo root
    # Go up 3 levels: benchmarks -> asv -> temple -> repo root
    bench_dir = os.path.dirname(os.path.abspath(__file__))
    asv_dir = os.path.dirname(bench_dir)
    temple_dir = os.path.dirname(asv_dir)
    repo_root = os.path.dirname(temple_dir)
    full_path = os.path.join(repo_root, path)
    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


def bench_tokenize_small():
    """Tokenize small template."""
    tpl = load_template_text("examples/templates/bench/real_small.md.tmpl")
    for _ in range(100):
        list(temple_tokenizer(tpl))


def bench_tokenize_large():
    """Tokenize large template."""
    tpl = load_template_text("examples/templates/bench/real_large.html.tmpl")
    for _ in range(10):
        list(temple_tokenizer(tpl))
