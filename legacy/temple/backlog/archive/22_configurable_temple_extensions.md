---
title: "Configurable Temple Extensions from VS Code"
status: complete
priority: LOW
complexity: Low
estimated_effort: 4 hours
dependencies:
  - "[[18_format_detector_registry.md]]"
related_backlog:
  - "[[14_config_support.md]]"
related_commit: b4acda5 # feat: add configurable temple extensions from VS Code
---

# Configurable Temple Extensions from VS Code

## Context

Temple extensions (`.tmpl`, `.template`) are currently hardcoded in two places:
- `vscode-temple-linter/package.json` - VS Code language file associations
- `temple-linter/src/temple_linter/base_format_linter.py` - `strip_temple_extension()` function

This creates:
- **DRY violation**: Same list maintained in two locations
- **Inflexibility**: Users can't customize temple extensions via VS Code settings
- **Sync risk**: Changes to VS Code config don't propagate to Python server
- **Maintenance burden**: Any new extension requires updating both files

## Problem Statement

We need to pass configured temple extensions from VS Code to the Python LSP server, making the server adapt to whatever extensions VS Code recognizes as temple files.

## Context Files

- `vscode-temple-linter/package.json` - Language configuration with file patterns
- `temple-linter/src/temple_linter/lsp_server.py` - LSP initialization handler
- `temple-linter/src/temple_linter/base_format_linter.py` - `strip_temple_extension()` function
- `temple-linter/src/temple_linter/services/base_linting_service.py` - Calls `strip_temple_extension()`

## Tasks

1. **VS Code Extension Changes:**
   - Read temple extensions from `package.json` language configuration or VS Code settings
   - Pass extensions in `InitializeParams.initializationOptions` during LSP handshake
   - Document configuration option in README

2. **Python LSP Server Changes:**
   - Store temple extensions in `TempleLinterServer.__init__()` from initialization options
   - Add fallback to `[".tmpl", ".template"]` if not provided
   - Make extensions accessible to services via server instance

3. **Update `strip_temple_extension()` Function:**
   - Change signature from `strip_temple_extension(filename)` to `strip_temple_extension(filename, extensions)`
   - Accept `extensions: List[str]` parameter with default `[".tmpl", ".template"]`
   - Maintain case-insensitive matching behavior

4. **Thread Configuration Through Services:**
   - Update `BaseLintingService.request_base_diagnostics()` to accept extensions parameter
   - Pass extensions from orchestrator → base linting service → strip function
   - Ensure all call sites receive extensions from server configuration

5. **Add Tests:**
   - Test custom extensions: `[".tpl", ".tmpl", ".jinja"]`
   - Test empty extensions list (no stripping)
   - Test case-insensitive matching still works
   - Test fallback to defaults when not configured

6. **Documentation:**
   - Update `temple-linter/docs/EXTENDING.md` with configuration example
   - Add VS Code settings.json example
   - Document LSP initialization options

## Dependencies

- **18_format_detector_registry.md** (required) - Builds on passthrough mechanism that uses `strip_temple_extension()`

## Execution Order

Execute after Work Item #18 (Format Detector Registry) since it extends the passthrough functionality. Can be done independently or alongside other configuration work.

## Acceptance Criteria

- [ ] Temple extensions read from VS Code configuration
- [ ] Passed to Python server via LSP initialization
- [ ] `strip_temple_extension()` accepts extensions parameter
- [ ] Fallback to defaults if not configured
- [ ] All tests pass with custom extensions
- [ ] Documentation includes configuration examples
- [ ] No hardcoded extension lists in Python code

## Implementation Notes

**VS Code InitializationOptions format:**
```typescript
interface TempleInitializationOptions {
  templeExtensions?: string[];  // e.g., [".tmpl", ".template", ".tpl"]
}
```

**Python LSP Server storage:**
```python
class TempleLinterServer(LanguageServer):
    def __init__(self):
        super().__init__("temple-linter", "v1")
        self.temple_extensions = [".tmpl", ".template"]  # defaults
        # ... rest of init
        
    # In on_initialize handler:
    def on_initialize(self, params: InitializeParams):
        if params.initialization_options:
            self.temple_extensions = params.initialization_options.get(
                "templeExtensions", [".tmpl", ".template"]
            )
```

**Function signature update:**
```python
def strip_temple_extension(
    filename: Optional[str],
    extensions: List[str] = None
) -> Optional[str]:
    if extensions is None:
        extensions = [".tmpl", ".template"]
    # ... rest of function
```

## Expected Outcomes

- **Single source of truth**: VS Code configuration drives extension behavior
- **User flexibility**: Users can define custom temple extensions in settings
- **Maintainability**: No need to sync extension lists across codebases
- **Consistency**: Python server always matches VS Code's file associations

## Related Documentation

- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) - Configuration management
- [temple-linter/docs/EXTENDING.md](../temple-linter/docs/EXTENDING.md) - Extension guide
- [VS Code Language Server Protocol - Initialization](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize)
