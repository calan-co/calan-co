# Benchmark Templates

This directory contains templates used for **performance benchmarking** with [airspeed velocity (asv)](https://asv.readthedocs.io/).

## Templates

- `real_small.md.tmpl` - Small Markdown template (~20 lines) for quick iteration benchmarks
- `real_medium.md.tmpl` - Medium Markdown template (~100 lines) for realistic workload benchmarks  
- `real_large.html.tmpl` - Large HTML template (~500 lines) for stress testing and scalability benchmarks

## Sample Data

All benchmark templates use the same input data structure as [../dsl_examples/sample_data.json](../dsl_examples/sample_data.json):

```json
{
  "user": {
    "name": "Alice",
    "age": 30,
    "active": true,
    "skills": ["python", "lark"],
    "jobs": [{"title": "Engineer", "company": "Acme"}]
  }
}
```

## Running Benchmarks

From the temple root directory:

```bash
# Run all benchmarks
asv run

# Run specific benchmark suite
asv run --bench bench_templates

# Generate HTML report
asv publish
asv preview
```

## Benchmark Configuration

See [../../asv/asv.conf.json](../../asv/asv.conf.json) for benchmark configuration and [../../asv/benchmarks/](../../asv/benchmarks/) for benchmark implementations.

## For General Usage

**If you're looking for working template examples**, see [../dsl_examples/](../dsl_examples/) instead. The templates in this directory are optimized for performance testing, not for learning Temple's DSL syntax.
