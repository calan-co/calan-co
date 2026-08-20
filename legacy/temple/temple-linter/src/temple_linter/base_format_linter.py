"""
Base format linting integration for templated files.

Implements an extensible registry of format detectors following the Strategy
pattern. Each detector returns a confidence score (0.0-1.0) based on filename
and content heuristics; the registry selects the highest-confidence format.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from temple.defaults import DEFAULT_TEMPLE_EXTENSIONS
from temple_linter.services.token_cleaning_service import TokenCleaningService

MIN_CONFIDENCE = 0.2  # below this threshold we use VS Code auto-detection
VSCODE_PASSTHROUGH = "vscode-auto"  # sentinel for VS Code auto-detection


def strip_temple_extension(
    filename: str | None, extensions: list[str] = None
) -> str | None:
    """Strip temple suffix from filename, preserving base extension for VS Code detection.

    Args:
        filename: Original filename (e.g., "config.json.tmpl")
        extensions: List of temple extensions to strip (e.g., [".tmpl", ".template"])
            If None, defaults to [".tmpl", ".template"]

    Returns:
        Filename with temple extension removed, or original if no match

    Examples:
        strip_temple_extension("config.json.tmpl") -> "config.json"
        strip_temple_extension("README.md.template") -> "README.md"
        strip_temple_extension("data.tmpl") -> "data"
        strip_temple_extension("data.tpl", [".tpl", ".tmpl"]) -> "data"
        strip_temple_extension("plain_file") -> "plain_file"
    """
    if not filename:
        return filename

    if extensions is None:
        extensions = list(DEFAULT_TEMPLE_EXTENSIONS)

    # Strip any matching temple extension (case-insensitive)
    base = filename
    for ext in extensions:
        if base.lower().endswith(ext.lower()):
            base = base[: -len(ext)]
            break

    return base


class FormatDetector(Protocol):
    """Protocol for pluggable format detectors."""

    def matches(self, filename: str | None, content: str) -> float:
        """Return confidence score in [0.0, 1.0] for this format."""

    def format_name(self) -> str:
        """Return canonical format name (e.g., "json", "yaml")."""


@dataclass
class RegisteredDetector:
    priority: int
    detector: FormatDetector


class FormatDetectorRegistry:
    """Registry that resolves file formats via pluggable detectors."""

    def __init__(self) -> None:
        self._detectors: list[RegisteredDetector] = []

    def register(self, detector: FormatDetector, priority: int = 0) -> None:
        self._detectors.append(RegisteredDetector(priority, detector))
        # Sort descending priority to evaluate higher-priority detectors first
        self._detectors.sort(key=lambda d: d.priority, reverse=True)

    def detect(self, filename: str | None, content: str) -> str:
        best_format = VSCODE_PASSTHROUGH
        best_score = MIN_CONFIDENCE
        for entry in self._detectors:
            score = entry.detector.matches(filename, content)
            if score > best_score:
                best_score = score
                best_format = entry.detector.format_name()
        return best_format


def _has_extension(filename: str | None, extensions: list[str]) -> bool:
    if not filename:
        return False
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in extensions)


class _JsonDetector:
    def format_name(self) -> str:
        return "json"

    def matches(self, filename: str | None, content: str) -> float:
        if _has_extension(filename, [".json", ".json.tmpl", ".json.template"]):
            return 1.0
        sample = content.lstrip()[:200].lower()
        if sample.startswith("{") or sample.startswith("["):
            return 0.7
        return 0.0


class _YamlDetector:
    def format_name(self) -> str:
        return "yaml"

    def matches(self, filename: str | None, content: str) -> float:
        if _has_extension(
            filename,
            [
                ".yaml",
                ".yml",
                ".yaml.tmpl",
                ".yml.tmpl",
                ".yaml.template",
                ".yml.template",
            ],
        ):
            return 1.0
        sample = content.lstrip()[:400].lower()
        if sample.startswith("---"):
            return 0.7
        if ": " in sample:
            return 0.35
        return 0.0


class _HtmlDetector:
    def format_name(self) -> str:
        return "html"

    def matches(self, filename: str | None, content: str) -> float:
        if _has_extension(
            filename,
            [
                ".html",
                ".htm",
                ".html.tmpl",
                ".htm.tmpl",
                ".html.template",
                ".htm.template",
            ],
        ):
            return 1.0
        sample = content.lstrip()[:400].lower()
        if sample.startswith("<!doctype html") or sample.startswith("<html"):
            return 0.9
        if "<head" in sample or "<body" in sample:
            return 0.6
        return 0.0


class _TomlDetector:
    def format_name(self) -> str:
        return "toml"

    def matches(self, filename: str | None, content: str) -> float:
        if _has_extension(filename, [".toml", ".toml.tmpl", ".toml.template"]):
            return 1.0
        sample = content.lstrip()[:400].lower()
        if sample.startswith("[") and "=" in sample:
            return 0.8
        if "[" in sample and "]" in sample and "=" in sample:
            return 0.45
        return 0.0


class _XmlDetector:
    def format_name(self) -> str:
        return "xml"

    def matches(self, filename: str | None, content: str) -> float:
        if _has_extension(filename, [".xml", ".xml.tmpl", ".xml.template"]):
            return 1.0
        sample = content.lstrip()[:400].lower()
        if sample.startswith("<?xml"):
            return 0.9
        if sample.startswith("<"):
            return 0.4
        return 0.0


class _MarkdownDetector:
    def format_name(self) -> str:
        return "md"

    def matches(self, filename: str | None, content: str) -> float:
        if _has_extension(
            filename,
            [
                ".md",
                ".markdown",
                ".md.tmpl",
                ".markdown.tmpl",
                ".md.template",
                ".markdown.template",
            ],
        ):
            return 1.0
        sample = content.lstrip()[:200]
        if sample.startswith("#"):
            return 0.6
        if "\n- " in sample or "\n* " in sample:
            return 0.4
        return 0.0


class BaseFormatLinter:
    """Integrates format detection with base format linting."""

    def __init__(self, delimiters: dict[str, tuple] | None = None):
        self.delimiters = delimiters
        self.registry = self._build_default_registry()
        self._token_cleaner = TokenCleaningService()

    def _build_default_registry(self) -> FormatDetectorRegistry:
        registry = FormatDetectorRegistry()
        registry.register(_JsonDetector(), priority=100)
        registry.register(_YamlDetector(), priority=90)
        registry.register(_HtmlDetector(), priority=80)
        registry.register(_XmlDetector(), priority=70)
        registry.register(_TomlDetector(), priority=60)
        registry.register(_MarkdownDetector(), priority=50)
        return registry

    def detect_base_format(self, filename: str | None, text: str) -> str:
        """Detect the base format using registered detectors with confidence scoring."""
        return self.registry.detect(filename, text)

    def lint_base_format(
        self, text: str, filename: str | None = None
    ) -> list[dict[str, Any]]:
        """
        Lint the base format of a templated file by stripping template tokens first.
        Returns diagnostics from the base linter (placeholder).
        """
        base_text, _ = self._token_cleaner.clean_text_and_tokens(
            text,
            delimiters=self.delimiters,
        )
        base_format = self.detect_base_format(filename, base_text)
        diagnostics: list[dict[str, Any]] = []
        diagnostics.append(
            {
                "base_format": base_format,
                "info": f"Detected base format: {base_format}",
            }
        )
        return diagnostics
