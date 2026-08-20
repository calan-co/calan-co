# Linter Testing Examples

This directory contains **low-level examples** used for testing the Temple linter and base format validation. These files are primarily for **internal testing purposes**.

## Contents

- `valid_*.{json,html,md}` - Syntactically valid base formats (no template syntax)
- `invalid_*.{json,html,md}` - Base format syntax errors (malformed JSON, invalid HTML tags, etc.)
- `lint_examples.py` - Programmatic linter usage demonstrating error detection
- `templater_config.yaml` - Configuration file for template processing

## Purpose

These examples test that:
1. The linter correctly identifies base format errors (malformed JSON, invalid HTML, etc.)
2. Template tokens are properly stripped before base format linting
3. Diagnostics are correctly mapped back to original template positions

## For General Usage

**If you're looking for working template examples**, see [../../examples/dsl_examples/](../../examples/dsl_examples/) instead. Those examples demonstrate:
- Complete template syntax (variables, conditionals, loops)
- Real-world use cases across multiple output formats
- Input data and expected outputs
- Reusable rendering scripts

## Running Tests

These examples are validated by the test suite:

```bash
# Run linter tests
pytest temple/tests/test_linter.py

# Run all temple core tests
pytest temple/tests/
```

## See Also

- [Temple Linter Documentation](../../../temple-linter/docs/) - Linter API and usage
- [Error Reporting Strategy](../docs/error_reporting_strategy.md) - How errors are formatted and reported
- [DSL Examples](../../examples/dsl_examples/) - Production-ready template examples
