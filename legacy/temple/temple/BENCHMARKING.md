# Benchmarking Guide

This directory contains performance benchmarks for the Temple templating engine using [Airspeed Velocity (ASV)](https://asv.readthedocs.io/).

## Quick Start

### Run benchmarks on current commit

```bash
cd temple
asv run --quick HEAD^!
```

The `HEAD^!` notation means "just this commit" (git syntax). Without it, `asv run` will benchmark all commits in the configured branches, which can take a long time.

### Run specific benchmarks

```bash
# Test only tokenizer benchmarks
asv run --quick HEAD^! --bench "bench_tokenizer"

# Test pattern caching
asv run --quick HEAD^! --bench "bench_pattern_caching"

# Test renderer with real-world templates
asv run --quick HEAD^! --bench "bench_renderer.BenchRendererRealWorldTemplates"
```

### Generate HTML report

```bash
asv publish
```

This generates an HTML report at `asv/results/html/index.html` that you can open in your browser.

## Benchmark Organization

### Benchmark Files

- **`bench_minimal.py`** - Trivial benchmark (no dependencies, always works)
- **`bench_pattern_caching.py`** - LRU cache efficiency for regex patterns
- **`bench_tokenizer_*.py`** - Tokenizer performance with different delimiters and patterns
- **`bench_renderer.py`** - Template rendering with real-world templates
- **`bench_templates.py`** - Full tokenization of real-world templates
- **`bench_type_checker.py`** - Type checking performance
- **`bench_serializers.py`** - Serialization to JSON/Markdown/HTML/YAML

### Template Files

Realistic benchmark templates are stored in `examples/bench/`:

- **`real_small.md.tmpl`** (~900 bytes) - Small resume/profile template
- **`real_medium.md.tmpl`** (~4.3 KB) - Medium documentation template with 250+ lines
- **`real_large.html.tmpl`** (~26 KB) - Large HTML dashboard/website template with 490+ lines

These templates are realistic and representative of actual use cases.

## Configuration

The ASV configuration is in `asv.conf.json`:

- **`repo`**: Absolute path to the repo root
- **`branches`**: Set to `["main"]` (benchmarks main branch by default)
- **`benchmark_dir`**: `asv/benchmarks/`
- **`install_command`**: Installs the temple package in the benchmark environment

## CI/CD Integration

### Performance Regression Gate

The GitHub Actions workflow (`../../.github/workflows/benchmarks.yml`) includes a performance regression check:

```bash
asv continuous origin/main HEAD --quick --factor 1.10 --split --only-changed
```

This compares HEAD against `origin/main` and fails if any benchmark is more than 10% slower.

### Scheduled Publish

The workflow also includes a scheduled job (weekly) to publish benchmark results to demonstrate performance trends over time.

## Troubleshooting

### Benchmarks marked as "failed"

Benchmarks may fail during discovery if they depend on missing modules. Check:

1. Are imports available? (e.g., `from temple.compiler.serializers import ...`)
2. Are template files accessible? (should be in `examples/bench/`)
3. Run `python -c "import bench_X; b = bench_X.ClassName(); b.setup()"` to debug

### ASV not finding benchmarks

```bash
asv discover
```

This lists all discovered benchmarks and any errors during discovery.

### Path issues

The benchmark files use a special path resolution to find template files relative to the repo root:

```python
def load_template_text(path):
    bench_dir = os.path.dirname(os.path.abspath(__file__))
    asv_dir = os.path.dirname(bench_dir)
    temple_dir = os.path.dirname(asv_dir)
    repo_root = os.path.dirname(temple_dir)
    full_path = os.path.join(repo_root, path)
```

This accounts for the 3-level nesting: `benchmarks/ -> asv/ -> temple/ -> repo_root/`

## References

- [ASV Documentation](https://asv.readthedocs.io/)
- [Configuring ASV](https://asv.readthedocs.io/en/stable/source/asv_command_line.html)
- [Writing Benchmarks](https://asv.readthedocs.io/en/stable/source/writing_benchmarks.html)
