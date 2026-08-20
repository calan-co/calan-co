"""Benchmarks for tokenizer with different delimiter configurations."""

import os
from temple import temple_tokenizer


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


class TokenizerDelimiterBase:
    """Base class for delimiter benchmarks."""

    def setup(self):
        """Load template once."""
        self.tpl_small = load_template_text("examples/bench/real_small.md.tmpl")
        self.tpl_medium = load_template_text("examples/bench/real_medium.md.tmpl")
        self.tpl_large = load_template_text("examples/bench/real_large.html.tmpl")


class BenchDefaultDelimiters(TokenizerDelimiterBase):
    """Benchmark tokenization with default delimiters."""

    def time_default_small(self):
        """Tokenize small template with default delimiters."""
        list(temple_tokenizer(self.tpl_small))

    def time_default_medium(self):
        """Tokenize medium template with default delimiters."""
        list(temple_tokenizer(self.tpl_medium))

    def time_default_large(self):
        """Tokenize large template with default delimiters."""
        list(temple_tokenizer(self.tpl_large))


class BenchCustomDelimiters(TokenizerDelimiterBase):
    """Benchmark tokenization with custom delimiters."""

    def setup(self):
        """Setup templates and custom delimiter config."""
        super().setup()
        self.custom_delims = {
            "statement": ("<<", ">>"),
            "expression": ("<:", ":>"),
            "comment": ("<#", "#>"),
        }

    def time_custom_small(self):
        """Tokenize small template with custom delimiters."""
        list(temple_tokenizer(self.tpl_small, self.custom_delims))

    def time_custom_medium(self):
        """Tokenize medium template with custom delimiters."""
        list(temple_tokenizer(self.tpl_medium, self.custom_delims))

    def time_custom_large(self):
        """Tokenize large template with custom delimiters."""
        list(temple_tokenizer(self.tpl_large, self.custom_delims))


class BenchAltDelimiters(TokenizerDelimiterBase):
    """Benchmark tokenization with alternative delimiters."""

    def setup(self):
        """Setup templates and alternative delimiter config."""
        super().setup()
        # Alternative delimiters that avoid conflicts with output formats
        self.alt_delims = {
            "statement": ("[%", "%]"),
            "expression": ("${", "}"),
            "comment": ("[!", "!]"),
        }

    def time_alt_small(self):
        """Tokenize small template with alternative delimiters."""
        list(temple_tokenizer(self.tpl_small, self.alt_delims))

    def time_alt_medium(self):
        """Tokenize medium template with alternative delimiters."""
        list(temple_tokenizer(self.tpl_medium, self.alt_delims))

    def time_alt_large(self):
        """Tokenize large template with alternative delimiters."""
        list(temple_tokenizer(self.tpl_large, self.alt_delims))
