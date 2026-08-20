# Temple Examples & Quickstart

**Start here for working examples!** This directory contains runnable examples demonstrating Temple's DSL templating across multiple output formats.

## Quick Navigation

- **🚀 Running examples:** `python examples/run_example.py all`
- **🧪 Running tests:** `pytest temple/tests/test_example_templates.py`
- **📊 See outputs:** Check `examples/outputs/` for expected results

## Directory Structure

<!-- BEGIN:project-structure path=examples depth=3 annotations=examples/.structure-notes.yaml -->
```text
examples/
├── README.md                        # ⭐ You are here
├── run_example.py                   # Script to render templates
├── sample_data.json                 # Input data for all examples
├── outputs/                         # 📋 Expected rendering results
│   ├── html_positive.html.output
│   ├── md_positive.md.output
│   ├── text_positive.txt.output
│   └── toml_positive.toml.output
└── templates/                       # 📝 All template files
    ├── bench/                       # ⚡ Performance benchmarking
    │   ├── README.md
    │   ├── real_large.html.tmpl
    │   ├── real_medium.md.tmpl
    │   └── real_small.md.tmpl
    ├── includes/                    # 🔄 Template composition
    │   ├── footer.html.tmpl
    │   ├── footer.md.tmpl
    │   ├── footer.toml.tmpl
    │   ├── footer.txt.tmpl
    │   ├── header.html.tmpl
    │   ├── header.md.tmpl
    │   ├── header.toml.tmpl
    │   └── header.txt.tmpl
    ├── negative/                    # ❌ Validation error examples
    │   ├── html_negative.html.tmpl
    │   ├── md_negative.md.tmpl
    │   ├── text_negative.txt.tmpl
    │   └── toml_negative.toml.tmpl
    └── positive/                    # ✅ Working examples
        ├── html_positive.html.tmpl
        ├── md_positive.md.tmpl
        ├── text_positive.txt.tmpl
        └── toml_positive.toml.tmpl
```
<!-- END:project-structure -->

## DSL Examples (Core Examples)

The templates in `templates/` directory demonstrate Temple's DSL syntax across multiple output formats. All examples use the same input data ([sample_data.json](sample_data.json)) to show how Temple adapts to different output formats.

**What's included:**

- ✅ **Positive examples** (`templates/positive/`): Valid templates with conditionals, loops, includes
- ❌ **Negative examples** (`templates/negative/`): Templates with validation errors (missing required fields)
- 📋 **Expected outputs** (`outputs/`): `.output` files for comparison
- 📊 **Benchmark templates** (`templates/bench/`): Performance testing templates
- 🔄 **Includes** (`templates/includes/`): Template composition examples

**Template features demonstrated:**

- Variable insertion: `{{ user.name }}`
- Conditionals: `{% if user.active %}...{% end %}`
- Loops: `{% for job in user.jobs %}...{% end %}`
- Includes: `{% include 'header.html' %}`
- Loop metadata: `{% if loop.last %}`

## Quick Start

### 1. Python Setup

Ensure you have Temple installed:

```bash
cd /path/to/temple
pip install -e temple
pip install -e temple-linter
```

### 2. Run Examples

Use the provided `run_example.py` script to render templates across all formats:

```bash
cd examples

# Render a specific format
python run_example.py html       # HTML example
python run_example.py md         # Markdown example
python run_example.py text       # Text example
python run_example.py toml       # TOML example

# Render all formats at once
python run_example.py all

# Render and compare with expected outputs
python run_example.py html --compare    # Compare single format
python run_example.py all --compare     # Compare all formats
```

**Script Features:**

- Reusable across all 4 output formats
- Automatic template parsing with `lark_parser` and rendering with `typed_renderer`
- Loads sample data from `sample_data.json`
- Handles template includes (headers/footers)
- Optional comparison with expected `.output` files
- Clear output with format headers
- Unified diff display for mismatches

**Output Files:**
Each format has an expected output file for validation in `outputs/`:

- `html_positive.html.output` - Expected HTML rendering
- `md_positive.md.output` - Expected Markdown rendering
- `text_positive.txt.output` - Expected text rendering
- `toml_positive.toml.output` - Expected TOML rendering

**Example Output:**

```bash
$ python run_example.py html --compare
============================================================
Format: HTML
Template: html_positive.html.tmpl
============================================================

<html>
  <head><title>User</title></head>
  <body>
    ...
  </body>
</html>

✓ Output matches expected result (html_positive.html.output)
```

### 3. Python Test Commands

```bash
# Run example template tests
pytest temple/tests/test_example_templates.py -v

# Run with coverage
pytest temple/tests/test_example_templates.py --cov=temple
```

## Template Features

### Variables

Insert values directly into templates:

```template
{{ user.name }}        # Renders: Alice
{{ user.age }}         # Renders: 30
```

### Conditionals

Control rendering based on conditions:

```template
{% if user.active %}
  User is active
{% else %}
  User is inactive
{% end %}
```

### Loops

Iterate over collections:

```template
{% for job in user.jobs %}
- {{ job.title }} at {{ job.company }}
{% if loop.last %} (current){% end %}
{% end %}
```

### Template Includes

Compose templates using includes:

```template
{% include 'header' %}
<main>{{ content }}</main>
{% include 'footer' %}
```

## Other Directories

### Benchmark Templates (`templates/bench/`)

Templates used for performance benchmarking with [airspeed velocity (asv)](https://asv.readthedocs.io/):

- `real_small.md.tmpl` - Small Markdown template (~20 lines)
- `real_medium.md.tmpl` - Medium Markdown template (~100 lines)
- `real_large.html.tmpl` - Large HTML template (~500 lines)

Use the same `run_example.py` script with the same data structure.

### Linter Examples (`temple/examples/`)

Low-level examples used for testing the linter and base format validation:

- `valid_*.{json,html,md}` - Syntactically valid base formats
- `invalid_*.{json,html,md}` - Base format syntax errors
- `lint_examples.py` - Programmatic linter usage

**Note:** For general usage, refer to `examples/` templates instead.

---

## Contributing

To add new examples:

1. Create template file: `examples/templates/positive/example_positive.FORMAT.tmpl`
2. (Optional) Create negative validation case: `examples/templates/negative/example_negative.FORMAT.tmpl`
3. Update `sample_data.json` if needed for your example
4. Generate expected output: Run `python run_example.py FORMAT` and save output to `examples/outputs/example_positive.FORMAT.output`
5. Test with: `pytest temple/tests/test_example_templates.py`
6. Verify rendering with: `python run_example.py FORMAT --compare`

## Related Projects

- **temple:** Core templating engine
- **temple-linter:** LSP server for template validation
- **vscode-temple-linter:** VS Code extension for IDE integration
