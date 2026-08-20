Temple Linter Documentation
============================

Welcome to Temple Linter's documentation. Temple Linter is a Language Server Protocol (LSP) server for linting templated files, providing intelligent validation for templates with embedded DSL tokens.

Overview
--------

Temple Linter provides:

* **Template-aware linting**: Validates both template syntax and base format
* **Position-accurate diagnostics**: Maps errors between cleaned and original content
* **VS Code integration**: Delegates base format linting to native linters
* **Extensible architecture**: Service-based design following Single Responsibility Principle

Architecture
------------

The linting workflow consists of five coordinated services:

1. **Template Linting**: Validates template syntax and logic (if/for/end matching)
2. **Token Cleaning**: Strips DSL tokens while tracking original positions
3. **Base Linting**: Delegates to VS Code's native linters (JSON, YAML, Markdown, etc.)
4. **Diagnostic Mapping**: Maps diagnostic positions from cleaned content back to original
5. **Orchestration**: Coordinates all services and merges diagnostics

Key Components
--------------

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   api

Core Services
~~~~~~~~~~~~~

* :class:`~temple_linter.services.lint_orchestrator.LintOrchestrator` - Coordinates the complete linting workflow
* :class:`~temple_linter.services.token_cleaning_service.TokenCleaningService` - Strips DSL tokens
* :class:`~temple_linter.services.base_linting_service.BaseLintingService` - Delegates to native linters
* :class:`~temple_linter.services.diagnostic_mapping_service.DiagnosticMappingService` - Maps diagnostic positions

Utilities
~~~~~~~~~

* :mod:`temple_linter.template_tokenizer` - DSL tokenizer with configurable delimiters
* :mod:`temple_linter.template_preprocessing` - Standalone token stripping utility
* :mod:`temple_linter.linter` - Template syntax validation

LSP Integration
~~~~~~~~~~~~~~~

* :mod:`temple_linter.lsp_server` - Language Server Protocol implementation
* Custom LSP methods:
  
  * ``temple/requestBaseDiagnostics`` - Request diagnostics from VS Code extension
  * ``temple/createVirtualDocument`` - Create virtual documents for linting

Quick Start
-----------

**Installation**::

    pip install -r requirements.txt

**Running the LSP Server**::

    python -m temple_linter.lsp_server

**Using in VS Code**:

The Temple Linter VS Code extension (``vscode-temple-linter``) automatically starts the LSP server 
for files with ``.tmpl`` or ``.template`` extensions.

Token Model
-----------

All tokens use a unified position model with ``(line, col)`` tuples:

* **0-indexed**: Lines and columns start at 0
* **Inclusive**: Both start and end positions are inclusive
* **Token types**: ``text``, ``statement``, ``expression``, ``comment``

Example::

    "Hello {% if x %}world{% end %}"
    
    Tokens:
    - Token(type='text', value='Hello ', start=(0,0), end=(0,6))
    - Token(type='statement', value='if x', start=(0,6), end=(0,16))
    - Token(type='text', value='world', start=(0,16), end=(0,21))
    - Token(type='statement', value='end', start=(0,21), end=(0,31))

Configurable Delimiters
------------------------

Templates support custom delimiters to avoid conflicts with output formats::

    # Default delimiters (Jinja-like)
    {% statement %}
    {{ expression }}
    {# comment #}
    
    # Custom delimiters (configurable)
    [[ statement ]]
    << expression >>
    [## comment ##]

See :mod:`temple_linter.template_tokenizer` for configuration details.

Indices and tables
==================

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
