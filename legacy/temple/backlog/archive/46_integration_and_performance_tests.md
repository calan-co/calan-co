---
title: "46_integration_and_performance_tests"
status: completed
state_reason: success
priority: Medium
complexity: Medium
estimated_effort: 10 hours
actual_effort: 3
completed_date: 2026-02-13
related_commit:
  - c96532b  # refactor(ast): migrate imports to temple.typed_ast; deprecate legacy ast_nodes shim (backlog #35)
  - a397997  # fix(asv): fallback example path for benchmark template loading; add smoke tests (backlog #46)
  - a38d007  # feat(temple-linter): add native LSP providers and perf checks
  - 3f17a66  # ci(workflows): add vscode package validation to static analysis
  - 8bb34ef  # feat(vscode): harden LSP init contract and packaging checks
test_results: "Local: uv run --with pytest --with-editable ./temple --with-editable ./temple-linter python -m pytest temple-linter/tests/test_e2e_performance.py temple-linter/tests/test_lsp_mvp_smoke.py -q passes; static analysis now validates VS Code package checks via CI + pre-push parity."
dependencies:
  - [[42_integrate_temple_core_dependency.md]] ⏳
  - [[43_implement_template_syntax_validation.md]] ⏳
  - [[44_implement_semantic_validation.md]] ⏳
  - [[45_implement_lsp_language_features.md]] ⏳
related_backlog:
  - archive/38_integration_and_e2e_tests.md (temple core tests)
  - archive/39_performance_benchmarks.md (temple core benchmarks)
related_spike: []

notes: |
  Comprehensive E2E tests and performance benchmarks validating complete linting pipeline with temple core integration.
  2026-02-13: Added `test_e2e_performance.py` with pipeline merge checks and runtime thresholds.
  2026-02-13: Updated `.github/workflows/tests.yml` to explicitly enforce the performance threshold suite.
  2026-02-13: Consolidated implementation and test wiring committed in `a38d007`.
  2026-02-13: Added LSP/initialization smoke coverage in `8bb34ef` and moved VS Code package validation to static analysis in `3f17a66`.
---

## Goal

Create comprehensive integration tests and performance benchmarks for temple-linter with full temple core integration, ensuring correctness and acceptable performance at scale.

## Background

With all temple core features integrated (syntax validation, semantic validation, LSP features), we need end-to-end tests that validate the complete linting pipeline and measure performance for realistic workloads.

## Tasks

### 1. Create End-to-End Integration Tests

Add `tests/test_e2e_integration.py`:

```python
import pytest
from pathlib import Path
from temple_linter import TemplateLinter
from temple.compiler import Schema

class TestE2EIntegration:
    """End-to-end integration tests with temple core."""
    
    def test_complete_linting_pipeline(self):
        """Test full pipeline: parse -> type check -> base lint."""
        # Template with all error types
        template = '''
        {% if user.active %}
          {{ user.name }}
          {{ user.missing_field }}  <!-- Semantic error -->
        {% end %}  <!-- Syntax error: mismatched block -->
        
        <div class="invalid">  <!-- Base format error -->
        '''
        
        schema = Schema.from_dict({
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "active": {"type": "boolean"},
                        "name": {"type": "string"}
                    }
                }
            }
        })
        
        linter = TemplateLinter()
        diagnostics = linter.lint(template, schema=schema)
        
        # Should catch all three error types
        error_codes = [d.code for d in diagnostics]
        assert "MISMATCHED_BLOCK" in error_codes  # Syntax
        assert "UNDEFINED_VARIABLE" in error_codes  # Semantic
        # Base format error would be caught by base linter integration
    
    def test_multi_file_workspace(self, tmp_path):
        """Test linting across multiple files with includes."""
        # Create workspace structure
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        # Main template
        (workspace / "main.html.tmpl").write_text('''
        {% include 'header.html' %}
        <div>{{ content }}</div>
        {% include 'footer.html' %}
        ''')
        
        # Includes
        (workspace / "header.html.tmpl").write_text('<header>{{ title }}</header>')
        (workspace / "footer.html.tmpl").write_text('<footer>{{ copyright }}</footer>')
        
        # Schema
        schema = Schema.from_dict({
            "type": "object",
            "properties": {
                "content": {"type": "string"},
                "title": {"type": "string"},
                "copyright": {"type": "string"}
            }
        })
        
        # Lint main template
        linter = TemplateLinter()
        linter.workspace_root = workspace
        text = (workspace / "main.html.tmpl").read_text()
        diagnostics = linter.lint(text, schema=schema, template_uri=str(workspace / "main.html.tmpl"))
        
        # Should resolve includes and validate all variables
        assert len(diagnostics) == 0
    
    def test_error_recovery_and_partial_results(self):
        """Test that linter provides useful results even with errors."""
        template = '''
        {% if user.active %}
          {{ user.name }}
        <!-- Missing end, but we should still catch other errors -->
        {{ undefined_var }}
        '''
        
        schema = Schema.from_dict({
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "active": {"type": "boolean"},
                        "name": {"type": "string"}
                    }
                }
            }
        })
        
        linter = TemplateLinter()
        diagnostics = linter.lint(template, schema=schema)
        
        # Should report both syntax and semantic errors
        assert any(d.code == "UNCLOSED_BLOCK" for d in diagnostics)
        assert any(d.code == "UNDEFINED_VARIABLE" for d in diagnostics)
        assert any("undefined_var" in d.message for d in diagnostics)
```

### 2. Create Performance Benchmarks

Add `tests/benchmarks/test_linter_performance.py`:

```python
import pytest
import time
from temple_linter import TemplateLinter
from temple.compiler import Schema

class TestLinterPerformance:
    """Performance benchmarks for linting operations."""
    
    @pytest.fixture
    def large_template(self):
        """Generate large template with 1000 expressions."""
        lines = []
        for i in range(1000):
            lines.append(f"{{{{ user.field_{i} }}}}")
        return "\n".join(lines)
    
    @pytest.fixture
    def large_schema(self):
        """Generate schema with 1000 fields."""
        properties = {f"field_{i}": {"type": "string"} for i in range(1000)}
        return Schema.from_dict({
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": properties
                }
            }
        })
    
    def test_parse_performance(self, large_template):
        """Test parsing performance for large templates."""
        linter = TemplateLinter()
        
        start = time.time()
        diagnostics = linter.lint(large_template)
        duration = time.time() - start
        
        # Should parse 1000 expressions in < 100ms
        assert duration < 0.1, f"Parsing took {duration}s"
    
    def test_type_check_performance(self, large_template, large_schema):
        """Test type checking performance for large schemas."""
        linter = TemplateLinter()
        
        start = time.time()
        diagnostics = linter.lint(large_template, schema=large_schema)
        duration = time.time() - start
        
        # Should type check 1000 fields in < 200ms
        assert duration < 0.2, f"Type checking took {duration}s"
    
    def test_incremental_linting(self):
        """Test performance of incremental updates."""
        template = "{{ user.name }}" * 100
        linter = TemplateLinter()
        
        # Initial lint
        start = time.time()
        linter.lint(template)
        initial_duration = time.time() - start
        
        # Incremental change (append one more expression)
        template += "{{ user.email }}"
        start = time.time()
        linter.lint(template)
        incremental_duration = time.time() - start
        
        # Incremental should be faster (with caching)
        # Note: This requires implementing AST caching
        print(f"Initial: {initial_duration}s, Incremental: {incremental_duration}s")
    
    def test_memory_usage(self, large_template, large_schema):
        """Test memory usage for large templates."""
        import tracemalloc
        
        tracemalloc.start()
        
        linter = TemplateLinter()
        diagnostics = linter.lint(large_template, schema=large_schema)
        
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        
        # Should use < 50MB for 1000 expressions
        assert peak < 50 * 1024 * 1024, f"Peak memory: {peak / 1024 / 1024}MB"
```

### 3. Add LSP Integration Tests

Create `tests/test_lsp_integration.py`:

```python
import pytest
from pygls.server import LanguageServer
from lsprotocol.types import (
    InitializeParams, TextDocumentItem, DidOpenTextDocumentParams,
    CompletionParams, Position
)

class TestLSPIntegration:
    """Test LSP server with temple core integration."""
    
    @pytest.fixture
    def lsp_server(self):
        """Create test LSP server."""
        from temple_linter.lsp_server import create_server
        return create_server()
    
    def test_diagnostics_on_open(self, lsp_server):
        """Test that diagnostics are sent when document opens."""
        # Initialize server
        lsp_server.lsp.initialize(InitializeParams(
            process_id=1,
            root_uri="file:///test"
        ))
        
        # Open document with error
        doc = TextDocumentItem(
            uri="file:///test/template.html.tmpl",
            language_id="temple",
            version=1,
            text="{% if user.active %}{{ user.missing }}"
        )
        
        # Should receive diagnostics
        diagnostics = lsp_server.text_document__did_open(
            DidOpenTextDocumentParams(text_document=doc)
        )
        
        assert any(d.code == "UNCLOSED_BLOCK" for d in diagnostics)
        assert any(d.code == "UNDEFINED_VARIABLE" for d in diagnostics)
    
    def test_completions_with_schema(self, lsp_server):
        """Test completions use schema information."""
        # Open document
        doc = TextDocumentItem(
            uri="file:///test/template.html.tmpl",
            language_id="temple",
            version=1,
            text="{{ user. }}"
        )
        lsp_server.text_document__did_open(DidOpenTextDocumentParams(text_document=doc))
        
        # Request completions
        completions = lsp_server.text_document__completion(
            CompletionParams(
                text_document=doc,
                position=Position(line=0, character=8)  # After "user."
            )
        )
        
        # Should show schema properties
        assert any(item.label == "name" for item in completions.items)
        assert any(item.label == "email" for item in completions.items)
```

### 4. Add Regression Tests

Create `tests/test_regressions.py` for known issues:

```python
def test_regression_multiline_expression():
    """Regression: Multi-line expressions broke position tracking."""
    template = '''
    {{
      user.name
    }}
    '''
    
    linter = TemplateLinter()
    diagnostics = linter.lint(template)
    
    # Should parse without error
    assert len(diagnostics) == 0

def test_regression_nested_conditionals():
    """Regression: Deep nesting caused stack overflow."""
    template = "{% if a %}" * 100 + "content" + "{% end %}" * 100
    
    linter = TemplateLinter()
    diagnostics = linter.lint(template)
    
    # Should handle deep nesting
    assert len(diagnostics) == 0
```

### 5. Configure Performance Thresholds

Add performance configuration to `pytest.ini`:

```ini
[pytest]
markers =
    slow: marks tests as slow (> 1s)
    benchmark: performance benchmark tests

# Performance thresholds
benchmark_min_rounds = 10
benchmark_max_time = 1.0
```

### 6. Add CI Integration for Tests

Update `.github/workflows/test.yml`:

```yaml
- name: Run integration tests
  run: pytest tests/test_e2e_integration.py -v

- name: Run performance benchmarks
  run: pytest tests/benchmarks/ --benchmark-only

- name: Run LSP integration tests
  run: pytest tests/test_lsp_integration.py -v
```

## Acceptance Criteria

- ✓ E2E tests cover complete linting pipeline (parse, type check, base lint)
- ✓ Multi-file workspace tests validate include resolution
- ✓ Performance benchmarks establish baseline metrics
- ✓ Parse time < 100ms for 1000-expression template
- ✓ Type check time < 200ms for 1000-field schema
- ✓ Memory usage < 50MB for large templates
- ✓ LSP integration tests validate server behavior
- ✓ Regression tests prevent known issues from reoccurring
- ✓ All tests pass in CI/CD pipeline

## Performance Targets

- **Parsing:** < 100ms for 10KB template (1000 expressions)
- **Type Checking:** < 200ms for 1000-field schema
- **Complete Lint:** < 300ms end-to-end for typical template
- **Memory:** < 50MB peak for large templates
- **Startup:** < 1s LSP server initialization

## Test Coverage Goals

- **Unit Tests:** > 90% code coverage
- **Integration Tests:** All major features tested end-to-end
- **Performance Tests:** All critical paths benchmarked
- **Regression Tests:** All reported bugs have test cases

## Implementation Notes

- Use `pytest-benchmark` for performance testing
- Use `tracemalloc` for memory profiling
- Mock file system for workspace tests where appropriate
- Consider AST caching for incremental performance
- Profile with `py-spy` or `cProfile` to identify bottlenecks

## Related Work

- Backlog #42: Integrate Temple Core Dependency
- Backlog #43: Implement Template Syntax Validation
- Backlog #44: Implement Semantic Validation
- Backlog #45: Implement LSP Language Features
- Backlog #38: Integration and E2E Tests (temple core tests)
- Backlog #39: Performance Benchmarks (temple core benchmarks)
