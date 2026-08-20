"""Benchmarks for tokenizer with different token densities and patterns."""

from temple import temple_tokenizer


def create_sparse_template(size=1000):
    """Create template with sparse tokens (mostly text)."""
    lines = []
    for i in range(size):
        if i % 100 == 0:
            lines.append(f"Line {i}: {{ value_{i} }}\n")
        else:
            lines.append(f"This is plain text line {i}\n")
    return "".join(lines)


def create_dense_template(size=1000):
    """Create template with dense tokens (many inline tokens)."""
    lines = []
    for i in range(size):
        text_content = " text %d " % i
        parts = [
            "{{ var_a }}",
            text_content,
            "{{ var_b }}",
            " more text ",
            "{% if condition %}{{ var_c }}{% end %}",
            "\n",
        ]
        lines.append("".join(parts))
    return "".join(lines)


def create_nested_template(depth=10):
    """Create template with deeply nested tokens."""
    template = "outer: {{ data }}\n"
    for i in range(depth):
        template += "{% if level %}\n  nested content\n"
        template += "  {{ nested }}\n"
    for i in range(depth):
        template += "{% end %}\n"
    return template


class BenchTokenDensity:
    """Benchmark tokenizer with different token densities."""

    def setup(self):
        """Generate test templates."""
        self.sparse_small = create_sparse_template(100)
        self.sparse_medium = create_sparse_template(500)
        self.sparse_large = create_sparse_template(2000)

        self.dense_small = create_dense_template(100)
        self.dense_medium = create_dense_template(500)
        self.dense_large = create_dense_template(2000)

    def time_sparse_small(self):
        """Tokenize sparse small template."""
        list(temple_tokenizer(self.sparse_small))

    def time_sparse_medium(self):
        """Tokenize sparse medium template."""
        list(temple_tokenizer(self.sparse_medium))

    def time_sparse_large(self):
        """Tokenize sparse large template."""
        list(temple_tokenizer(self.sparse_large))

    def time_dense_small(self):
        """Tokenize dense small template."""
        list(temple_tokenizer(self.dense_small))

    def time_dense_medium(self):
        """Tokenize dense medium template."""
        list(temple_tokenizer(self.dense_medium))

    def time_dense_large(self):
        """Tokenize dense large template."""
        list(temple_tokenizer(self.dense_large))


class BenchNestingDepth:
    """Benchmark tokenizer with varying nesting depths."""

    def setup(self):
        """Generate nested templates."""
        self.nested_shallow = create_nested_template(2)
        self.nested_medium = create_nested_template(5)
        self.nested_deep = create_nested_template(10)
        self.nested_very_deep = create_nested_template(20)

    def time_nested_shallow(self):
        """Tokenize shallow nested template."""
        list(temple_tokenizer(self.nested_shallow))

    def time_nested_medium(self):
        """Tokenize medium nested template."""
        list(temple_tokenizer(self.nested_medium))

    def time_nested_deep(self):
        """Tokenize deep nested template."""
        list(temple_tokenizer(self.nested_deep))

    def time_nested_very_deep(self):
        """Tokenize very deep nested template."""
        list(temple_tokenizer(self.nested_very_deep))
