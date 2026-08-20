---
title: Canonical Examples & Developer Docs
id: 41
status: completed
related_commits: 
  - 11ee6f2  # MISSING-COMMIT:   - '11ee6f2' # docs: add sample script and restructure examples for clarity and contributor experience
estimated_hours: 8
priority: medium
---

## Goal

Provide clear, runnable examples and developer-facing documentation for serializers and diagnostics APIs.

## Status: COMPLETED ✓

All deliverables created and integrated with existing codebase. Examples restructured for clarity and contributor experience. Include mechanism verified and working across all 4 formats.

## Deliverables

### 1. Examples Restructuring for Clarity (`examples/`)
- ✓ **New Structure**: `templates/{positive,negative,includes,bench}` with root-level `run_example.py` and `sample_data.json`
- ✓ **Positive Examples** (4 files): Working templates for HTML, Markdown, Text, TOML with includes
- ✓ **Negative Examples** (4 files): Templates demonstrating validation errors
- ✓ **Includes** (8 files): Reusable headers/footers for each format (header.html.tmpl, footer.html.tmpl, etc.)
- ✓ **Benchmarks** (3 files): Performance testing templates
- ✓ **Outputs** (4 files): Expected output files for validation testing
- ✓ **run_example.py** — Reusable script to render all format examples with `--compare` validation flag
- ✓ **sample_data.json** — Standardized input data (user profile with skills, jobs, etc.)
- ✓ **README.md** — Directory structure guide with contributing guidelines and quickstart

### 2. Include Mechanism Verification ✓
- ✓ **Parser Integration**: `lark_parser` correctly extracts include names from `{% include 'name' %}` syntax via regex
- ✓ **File Naming**: Include files (e.g., `header.html.tmpl`) are loaded and keyed correctly via `Path.stem`
- ✓ **Resolution**: Template references (e.g., `{% include 'header.html' %}`) correctly match dictionary keys from loaded files
- ✓ **Validation**: All 4 positive examples render with includes and produce expected output
  - HTML: header/footer rendering with profile summary
  - Markdown: header/footer with structured content
  - Text: header/footer with plain text
  - TOML: header/footer with table sections
- ✓ **Output Verification**: `run_example.py all --compare` passes for all 4 formats

### 3. Diagnostics API Documentation (`temple-linter/docs/diagnostics_api.md`)
- ✓ Diagnostic types: Severity levels, `Diagnostic` dataclass, `DiagnosticCollector`
- ✓ Error categories: Syntax, type, semantic errors with code examples
- ✓ Formatting: `ErrorFormatter` for human-readable messages with source context
- ✓ Diagnostic mapping: `TemplateMapping` and `DiagnosticMappingService` for LSP integration
- ✓ LSP conversion: Converting diagnostics to LSP format for IDE display
- ✓ Practical examples: Undefined variables, type mismatches, base format errors
- ✓ Error suppression syntax and acceptance criteria

### 4. Examples Quickstart Guide (`examples/README.md`)
- ✓ Directory structure overview for new `templates/{positive,negative,includes,bench}` organization
- ✓ Python setup instructions
- ✓ Runnable DSL examples for all 4 formats (HTML, Markdown, Text, TOML)
- ✓ Usage instructions for run_example.py script
- ✓ Contributing guidelines for adding new examples
- ✓ Links to related projects and documentation

## Acceptance Criteria ✓

- ✓ New examples structure provides clear categorization (positive/negative/includes/bench/outputs)
- ✓ All examples render with root-level `python examples/run_example.py` command
- ✓ Include mechanism verified: templates with includes render correctly and match expected output
- ✓ run_example.py script works for all formats (HTML, Markdown, Text, TOML) with --compare validation
- ✓ sample_data.json provides standardized input data matching test suite
- ✓ Directory organization is self-documenting with clear file naming conventions
- ✓ Examples README includes contributing guidelines and setup instructions
- ✓ Diagnostics API documentation covers extension points and integration patterns
- ✓ Error handling and diagnostics mapping explained with practical examples

## Implementation Notes

### Examples Organization (RESTRUCTURED)
Previously: `examples/dsl_examples/`, `examples/typed/`, scattered files
Now: Unified `examples/` structure with clear subdirectories:
```
examples/
├── templates/          # All template files organized by category
│   ├── positive/       # 4 working examples (html, md, text, toml)
│   ├── negative/       # 4 error/validation examples
│   ├── includes/       # 8 reusable includes (header/footer per format)
│   └── bench/          # 3 performance benchmarks
├── outputs/            # 4 expected output files for validation
├── run_example.py      # Root-level entry point (was in dsl_examples/)
├── sample_data.json    # Standardized input (was in dsl_examples/)
└── README.md           # Structure guide & contributing guidelines
```

### Include Mechanism (VERIFIED)
- File naming: `header.html.tmpl`, `footer.toml.tmpl`, etc. in `templates/includes/`
- Parser extraction: `{% include 'header.html' %}` → extracts `'header.html'`
- Dictionary keying: `Path.stem` converts `header.html.tmpl` → `'header.html'` key
- Resolution: Template include name matches dictionary key (verified working)
- Validation: All 4 formats render with includes producing expected output

### Documentation Coverage
- **Diagnostics API:** 550+ lines covering error types, formatting, mapping, LSP integration, practical examples
- **Examples Guide:** Updated with dsl_examples structure, run_example.py usage, contributing guidelines

### Integration Points
- Examples/README links to `temple-linter/docs/diagnostics_api.md`
- Diagnostics docs links to Error Reporting Strategy
- All docs use consistent code block formatting and examples
- run_example.py integrates with existing test suite data model

## Files Created/Modified

### New Files Created
- `examples/templates/positive/` — 4 working template examples
- `examples/templates/negative/` — 4 validation error examples
- `examples/templates/includes/` — 8 include files (header/footer per format)
- `examples/templates/bench/` — 3 performance templates with README
- `examples/outputs/` — 4 expected output files for validation
- `examples/run_example.py` — Root-level rendering script (moved from dsl_examples/)
- `examples/sample_data.json` — Standardized input data (moved from dsl_examples/)
- `examples/README.md` — Structure guide with quickstart and contributing guidelines
- `temple-linter/docs/diagnostics_api.md` — Comprehensive diagnostics documentation
- `temple/docs/serializers.md` — Serializer API documentation
- `temple/examples/README.md` — Temple core examples guide

### Directories Removed/Reorganized
- Removed: `examples/dsl_examples/` (structure moved to `examples/templates/`)
- Removed: `examples/typed/` (no active usage, archived backlog only)
- Reorganized: All template files consolidated under `examples/templates/` with clear categorization

## Testing

All examples tested and verified working:
```bash
# Test individual format
python examples/run_example.py html
python examples/run_example.py md
python examples/run_example.py text
python examples/run_example.py toml

# Test all formats with output validation
python examples/run_example.py all --compare

# Expected results (all ✓):
# ✓ Output matches expected result (html_positive.html.output)
# ✓ Output matches expected result (md_positive.md.output)
# ✓ Output matches expected result (text_positive.txt.output)
# ✓ Output matches expected result (toml_positive.toml.output)

# Run full test suite
pytest temple/tests/test_example_templates.py
```

### Verification Results
- **Include Mechanism**: ✓ VERIFIED — All 4 formats render includes correctly
- **Output Validation**: ✓ VERIFIED — All outputs match expected files
- **File Organization**: ✓ VERIFIED — Templates, includes, outputs properly organized
- **Entry Point**: ✓ VERIFIED — root-level `python examples/run_example.py` is discoverable and functional
