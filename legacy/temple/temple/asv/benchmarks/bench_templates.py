"""Benchmarks for template tokenization across various sizes."""

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


class TemplateBenchBase:
    def setup(self):
        # Load templates once per benchmark run
        self.tpl_small = load_template_text(
            "examples/templates/bench/real_small.md.tmpl"
        )
        self.tpl_medium = load_template_text(
            "examples/templates/bench/real_medium.md.tmpl"
        )
        self.tpl_large = load_template_text(
            "examples/templates/bench/real_large.html.tmpl"
        )


class BenchTemplateSmall(TemplateBenchBase):
    def time_tokenize_small(self):
        """Time tokenizing small template."""
        list(temple_tokenizer(self.tpl_small))


class BenchTemplateMedium(TemplateBenchBase):
    def time_tokenize_medium(self):
        """Time tokenizing medium template."""
        list(temple_tokenizer(self.tpl_medium))


class BenchTemplateLarge(TemplateBenchBase):
    def time_tokenize_large(self):
        """Time tokenizing large template."""
        list(temple_tokenizer(self.tpl_large))
