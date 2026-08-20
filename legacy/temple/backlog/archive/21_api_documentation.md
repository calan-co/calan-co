---
title: "Comprehensive API Documentation"
status: complete
priority: HIGH
complexity: Low
estimated_effort: 1 day
dependencies:
  - "[[17_refactor_lsp_server.md]]"
  - "[[19_unified_token_model.md]]"
related_backlog:
  - "[[16_documentation.md]]"
related_commit: 
  - d94283e  # docs(temple-linter): add comprehensive API documentation with Sphinx
---

# Comprehensive API Documentation

## Context

temple-linter currently lacks comprehensive API documentation:
- No docstrings on many public classes/functions
- External integrations need clear interfaces
- LSP protocol extensions are undocumented
- Contributors don't know which APIs are stable

## Problem Statement

We need complete API documentation covering:
- Public classes and functions
- LSP protocol extensions
- Usage examples
- Error handling patterns
- Integration guides

## Context Files

- All `temple-linter/src/temple_linter/*.py` files
- `vscode-temple-linter/src/extension.ts` - LSP protocol usage

## Tasks

1. Add detailed docstrings to all public classes/functions in `temple_linter/`
2. Follow Google Python style guide for docstrings
3. Set up Sphinx with autodoc extension
4. Generate `docs/API.md` with:
   - Module overview
   - Class documentation  
   - Function signatures
   - Usage examples
5. Document custom LSP methods:
   - `temple/requestBaseDiagnostics`
   - `temple/createVirtualDocument`
6. Add examples for main entry points
7. Add `docs/` build to CI

## Dependencies

- **17_refactor_lsp_server.md** (required) - Document stable service interfaces
- **19_unified_token_model.md** (required) - Document canonical token model

## Execution Order

Execute THIRD in Phase 2, after Work Items #19 (Unified Token Model) and #17 (Refactor LSP Server) complete. This ensures we document stable, refactored interfaces rather than deprecated code.

## Acceptance Criteria

- [ ] All public APIs have docstrings
- [ ] Examples for common use cases
- [ ] Generated HTML docs available
- [ ] Integrated into CI (docs must build without errors)
- [ ] LSP protocol extensions documented
- [ ] All exceptions documented with examples
- [ ] Cross-references between related functions
- [ ] Both HTML and Markdown outputs generated

## LLM Agent Prompt

```
Generate comprehensive API documentation for temple-linter Python package.

Context:
- temple-linter lacks API documentation
- External integrations need clear interfaces
- LSP protocol extensions must be documented

Task:
1. Add detailed docstrings to all public classes/functions in temple_linter/:
   - lsp_server.py: TempleLinterServer class
   - template_tokenizer.py: temple_tokenizer() function
   - template_preprocessing.py: strip_template_tokens() function
   - diagnostics.py: DiagnosticMapper class
   - base_format_linter.py: detect_base_format() function
   - Follow Google Python style guide for docstrings
2. Set up Sphinx with autodoc extension:
   - Create docs/conf.py
   - Create docs/index.rst
   - Add API reference sections
3. Generate docs/API.md with:
   - Module overview (what is temple-linter, who uses it)
   - Class documentation (autodoc from docstrings)
   - Function signatures with types
   - Usage examples for main entry points
4. Document custom LSP methods:
   - temple/requestBaseDiagnostics: what it does, parameters, response
   - temple/createVirtualDocument: what it does, parameters, response
   - Add examples showing TypeScript client usage
5. Add examples for main entry points:
   - Starting LSP server
   - Tokenizing templates
   - Stripping template tokens
   - Mapping diagnostics
6. Document all exceptions that can be raised with examples
7. Cross-reference related functions (e.g., tokenizer → preprocessor)
8. Generate both HTML and Markdown outputs

Requirements:
- Use type hints in all signatures
- Include examples for main entry points
- Document all exceptions that can be raised
- Cross-reference related functions
- Generate both HTML and Markdown outputs
- Add CI check ensuring docs build successfully
```

## Expected Outcomes

- Clear reference documentation for API consumers
- Easier onboarding for contributors
- Stable public API contract
- Examples reduce integration time
- CI prevents doc rot

## Related Documentation

- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) Section 4.1: Missing Documentation
- [temple-linter/README.md](../temple-linter/README.md) - User guide
- [Google Python Style Guide - Docstrings](https://google.github.io/styleguide/pyguide.html#38-comments-and-docstrings)
