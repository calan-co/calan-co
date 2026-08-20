"""Benchmarks for renderer performance."""

import os
from temple import render_passthrough


def load_template_text(path):
    """Resolve path relative to repo root."""
    # Go up 3 levels: benchmarks -> asv -> temple -> repo root
    bench_dir = os.path.dirname(os.path.abspath(__file__))
    asv_dir = os.path.dirname(bench_dir)
    temple_dir = os.path.dirname(asv_dir)
    repo_root = os.path.dirname(temple_dir)
    full_path = os.path.join(repo_root, path)
    if not os.path.exists(full_path):
        # fallback: some examples live under examples/templates/bench
        alt_path = path.replace("examples/bench/", "examples/templates/bench/")
        alt_full = os.path.join(repo_root, alt_path)
        if os.path.exists(alt_full):
            full_path = alt_full

    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


def create_simple_template(lines=100):
    """Create simple template with just text."""
    return "\n".join([f"Line {i}: simple text content" for i in range(lines)])


def create_mixed_template(lines=100):
    """Create template with mixed text and tokens."""
    parts = []
    for i in range(lines):
        if i % 5 == 0:
            parts.append("Line %d: {{ variable }}" % i)
        elif i % 5 == 1:
            parts.append("Line %d: {# comment #}" % i)
        else:
            parts.append(f"Line {i}: plain text")
    return "\n".join(parts)


def create_statement_template(lines=100):
    """Create template with many statement blocks."""
    parts = []
    for i in range(lines):
        if i % 10 == 0:
            parts.append("{% if condition %}")
        elif i % 10 == 9:
            parts.append("{% end %}")
        else:
            parts.append(f"Line {i}: content")
    return "\n".join(parts)


class BenchRendererPassthrough:
    """Benchmark render_passthrough with different template types."""

    def setup(self):
        """Prepare test templates."""
        self.simple_small = create_simple_template(100)
        self.simple_medium = create_simple_template(500)
        self.simple_large = create_simple_template(2000)

        self.mixed_small = create_mixed_template(100)
        self.mixed_medium = create_mixed_template(500)
        self.mixed_large = create_mixed_template(2000)

        self.statement_small = create_statement_template(100)
        self.statement_medium = create_statement_template(500)
        self.statement_large = create_statement_template(2000)

    def time_passthrough_simple_small(self):
        """Render simple small template (text extraction only)."""
        render_passthrough(self.simple_small)

    def time_passthrough_simple_medium(self):
        """Render simple medium template."""
        render_passthrough(self.simple_medium)

    def time_passthrough_simple_large(self):
        """Render simple large template."""
        render_passthrough(self.simple_large)

    def time_passthrough_mixed_small(self):
        """Render mixed small template with tokens."""
        render_passthrough(self.mixed_small)

    def time_passthrough_mixed_medium(self):
        """Render mixed medium template."""
        render_passthrough(self.mixed_medium)

    def time_passthrough_mixed_large(self):
        """Render mixed large template."""
        render_passthrough(self.mixed_large)

    def time_passthrough_statement_small(self):
        """Render template with statement blocks."""
        render_passthrough(self.statement_small)

    def time_passthrough_statement_medium(self):
        """Render template with statement blocks (medium)."""
        render_passthrough(self.statement_medium)

    def time_passthrough_statement_large(self):
        """Render template with statement blocks (large)."""
        render_passthrough(self.statement_large)


class BenchRendererWithValidation:
    """Benchmark render with and without block validation."""

    def setup(self):
        """Prepare templates."""
        self.valid_template = create_statement_template(100)
        self.invalid_template = "{% if cond %} content {% end %}"  # Mismatched
        self.deep_nesting = create_statement_template(100)

    def time_render_with_validation(self):
        """Render with block validation enabled."""
        render_passthrough(self.valid_template, validate_blocks=True)

    def time_render_without_validation(self):
        """Render with block validation disabled."""
        render_passthrough(self.valid_template, validate_blocks=False)

    def time_render_invalid_with_validation(self):
        """Render invalid template (catches mismatched blocks)."""
        render_passthrough(self.invalid_template, validate_blocks=True)


class BenchRendererRealWorldTemplates:
    """Benchmark renderer on real-world template files."""

    def setup(self):
        """Load real templates."""
        self.tpl_small = load_template_text("examples/bench/real_small.md.tmpl")
        self.tpl_medium = load_template_text("examples/bench/real_medium.md.tmpl")
        self.tpl_large = load_template_text("examples/bench/real_large.html.tmpl")

    def time_render_small(self):
        """Render small real-world template."""
        render_passthrough(self.tpl_small)

    def time_render_medium(self):
        """Render medium real-world template."""
        render_passthrough(self.tpl_medium)

    def time_render_large(self):
        """Render large real-world template."""
        render_passthrough(self.tpl_large)
