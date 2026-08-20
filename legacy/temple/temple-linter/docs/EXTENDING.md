# Extending Temple Linter: Format Detectors

Temple Linter uses a pluggable registry to detect the base format of templated files. Add new formats by registering a detector that implements the `FormatDetector` protocol.

## FormatDetector Protocol

- `matches(filename: Optional[str], content: str) -> float`
  - Return a confidence score in `[0.0, 1.0]`.
  - Consider both filename (extension) and content heuristics.
- `format_name() -> str`
  - Return the canonical format string (e.g., `"json"`).

A detector is evaluated if its priority is high enough to be considered; higher priority runs earlier.

## Registry Usage

```python
from temple_linter.base_format_linter import BaseFormatLinter

linter = BaseFormatLinter()
format_name = linter.registry.detect("example.myfmt", "...")
```

## Registering a Custom Detector

```python
from temple_linter.base_format_linter import FormatDetector, BaseFormatLinter

class MyFormatDetector(FormatDetector):
    def format_name(self) -> str:
        return "myfmt"

    def matches(self, filename, content) -> float:
        if filename and filename.lower().endswith(".myfmt"):
            return 1.0
        if "MYFMT" in content:
            return 0.5
        return 0.0

linter = BaseFormatLinter()
linter.registry.register(MyFormatDetector(), priority=75)
```

## Detector Priorities

- Detectors are tried in **descending priority**.
- Built-in defaults (highest to lowest): JSON (100), YAML (90), HTML (80), XML (70), TOML (60), Markdown (50).
- If no detector exceeds the minimum confidence threshold (0.2), the format is set to `vscode-auto`, which triggers **VS Code passthrough mode**: the temple extension (`.tmpl`/`.template`) is stripped from the filename, and the cleaned content is forwarded to VS Code for automatic language detection and linting.

## VS Code Passthrough Mode

When the registry cannot confidently detect a format, Temple Linter defers to VS Code:

1. The temple extension (`.tmpl`, `.template`) is stripped: `config.ini.tmpl` → `config.ini`
2. The cleaned content is sent to VS Code with the stripped filename
3. VS Code uses its own language detection based on the resulting extension and content
4. This allows support for any format VS Code recognizes without needing a Temple detector

This means users can template **any** file format supported by VS Code without adding custom detectors—the registry handles common cases for performance, but unknown formats automatically fall back to VS Code's detection.

## Tips for Detectors

- Use lightweight heuristics; aim for <1 ms.
- Combine extension + content checks for better accuracy.
- Return higher scores for more certain matches (e.g., exact extension = 1.0).
- Keep logic deterministic and side-effect free.

## Testing Detectors

Add unit tests in `temple-linter/tests/test_base_format_linter.py`:

```python
def test_myfmt_detector():
    linter = BaseFormatLinter()
    linter.registry.register(MyFormatDetector(), priority=85)
    assert linter.detect_base_format("file.myfmt", "") == "myfmt"
```

## When to Add a New Detector

- New file format support (e.g., CSV, INI)
- Custom in-house template formats
- Improved heuristics for existing formats
