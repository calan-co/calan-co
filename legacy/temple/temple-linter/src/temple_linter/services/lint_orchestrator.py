"""
LintOrchestrator - Coordinates all linting services
"""

import logging
import os
from typing import Any

from lsprotocol.types import Diagnostic
from pygls.lsp.client import LanguageClient

from temple.defaults import DEFAULT_TEMPLE_EXTENSIONS
from temple.diagnostics import DiagnosticCollector

from ..base_format_linter import BaseFormatLinter
from ..diagnostic_converter import temple_to_lsp_diagnostic
from ..linter import TemplateLinter
from .base_linting_service import BaseLintingService
from .diagnostic_mapping_service import DiagnosticMappingService
from .token_cleaning_service import TokenCleaningService


class LintOrchestrator:
    """
    Orchestrates the complete linting workflow for templated files.

    Workflow:
    1. Template linting (syntax and logic validation)
    2. Token cleaning (strip DSL tokens)
    3. Base linting (delegate to native linters)
    4. Diagnostic mapping (map positions back to original)
    5. Merge all diagnostics

    This orchestrator coordinates services following Single Responsibility Principle:
    - TemplateLinter: Validates template syntax
    - TokenCleaningService: Strips DSL tokens
    - BaseLintingService: Delegates to native linters
    - DiagnosticMappingService: Maps positions
    """

    def __init__(self, logger: logging.Logger | None = None):
        self.logger = logger or logging.getLogger(__name__)
        self.template_linter = TemplateLinter()
        self.format_linter = BaseFormatLinter()
        self.token_cleaning_service = TokenCleaningService()
        self.base_linting_service = BaseLintingService(logger=self.logger)
        self.diagnostic_mapping_service = DiagnosticMappingService(logger=self.logger)

    def lint_template(
        self,
        text: str,
        uri: str,
        request_transport: LanguageClient | Any,
        temple_extensions: list[str] | None = None,
        semantic_context: dict[str, Any] | None = None,
        semantic_schema: Any = None,
        include_base_lint: bool = True,
    ) -> list[Diagnostic]:
        """
        Execute complete linting workflow for a templated file.

        Args:
            text: Template content
            uri: Document URI
            request_transport: Active session transport for request/response calls
            temple_extensions: List of temple file extensions (e.g., [".tmpl", ".template"])

        Returns:
            Combined list of template and base format diagnostics
        """
        if temple_extensions is None:
            temple_extensions = list(DEFAULT_TEMPLE_EXTENSIONS)

        # 1. Template linting
        # Create a node collector to capture per-node diagnostics during parsing
        node_collector = DiagnosticCollector()
        template_diagnostics = self._lint_template_syntax(
            text,
            node_collector,
            semantic_context=semantic_context,
            semantic_schema=semantic_schema,
        )

        # 2. Format detection
        filename = os.path.basename(uri) if uri else None
        detected_format = self.format_linter.detect_base_format(filename, text)

        # 3. Token cleaning
        projection = self.token_cleaning_service.project_for_base_lint(
            text,
            format_hint=detected_format,
        )
        cleaned_text = projection.cleaned_text

        # 4. Base linting
        # Skip base-format lint when template syntax already has hard errors to keep
        # diagnostics responsive and reduce downstream noise/false positives.
        has_blocking_template_errors = any(
            self._is_error_severity(getattr(diag, "severity", None))
            and self._is_blocking_template_error(diag)
            for diag in template_diagnostics
        )
        if has_blocking_template_errors or not include_base_lint:
            base_diagnostics: list[Diagnostic] = []
        else:
            base_diagnostics = self.base_linting_service.request_base_diagnostics(
                request_transport,
                cleaned_text,
                uri,
                detected_format,
                filename,
                temple_extensions,
            )

        # 5. Diagnostic mapping
        mapped_base_diagnostics = self.diagnostic_mapping_service.map_diagnostics(
            base_diagnostics, projection
        )
        mapped_base_diagnostics = self._mark_base_diagnostics(mapped_base_diagnostics)

        # 6. Include node-attached diagnostics (from parser/transformation)
        node_diags: list[Diagnostic] = []
        for d in node_collector.diagnostics:
            node_diags.append(temple_to_lsp_diagnostic(d))

        # 7. Merge diagnostics
        all_diagnostics = template_diagnostics + mapped_base_diagnostics + node_diags
        return self._dedupe_diagnostics(all_diagnostics)

    def _lint_template_syntax(
        self,
        text: str,
        node_collector: DiagnosticCollector | None = None,
        semantic_context: dict[str, Any] | None = None,
        semantic_schema: Any = None,
    ) -> list[Diagnostic]:
        """
        Lint template syntax and logic.

        Converts temple core diagnostics to LSP format.

        Args:
            text: Template content

        Returns:
            List of LSP Diagnostic objects
        """
        temple_diagnostics = self.template_linter.lint(
            text,
            node_collector=node_collector,
            context=semantic_context,
            schema=semantic_schema,
        )
        return [temple_to_lsp_diagnostic(d) for d in temple_diagnostics]

    @staticmethod
    def _diag_code(diag: Diagnostic) -> str:
        code = getattr(diag, "code", None)
        if code is None:
            return ""
        if isinstance(code, dict):
            value = code.get("value")
            return str(value) if value is not None else ""
        return str(code)

    @staticmethod
    def _is_error_severity(severity: Any) -> bool:
        if severity is None:
            return False
        try:
            return int(severity) == 1
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _is_blocking_template_error(diag: Diagnostic) -> bool:
        source = (diag.source or "").strip().lower()
        # Semantic diagnostics can coexist with useful base-format linting.
        return source != "temple-type-checker"

    @staticmethod
    def _is_zero_range(diag: Diagnostic) -> bool:
        try:
            start = diag.range.start
            end = diag.range.end
            return (
                start.line == 0
                and start.character == 0
                and end.line == 0
                and end.character == 0
            )
        except Exception:
            return False

    @staticmethod
    def _normalized_message(message: str) -> str:
        lowered = (message or "").strip().lower()
        for prefix in ("invalid expression syntax: ", "expression syntax: "):
            if lowered.startswith(prefix):
                return lowered[len(prefix) :]
        return lowered

    def _dedupe_diagnostics(self, diagnostics: list[Diagnostic]) -> list[Diagnostic]:
        deduped: list[Diagnostic] = []
        seen_exact: set[tuple[str, str, str, int, int, int, int]] = set()

        for diag in diagnostics:
            try:
                start = diag.range.start
                end = diag.range.end
                exact_key = (
                    (diag.source or "").strip().lower(),
                    self._diag_code(diag),
                    (diag.message or "").strip(),
                    start.line,
                    start.character,
                    end.line,
                    end.character,
                )
            except Exception:
                exact_key = ("", self._diag_code(diag), diag.message or "", 0, 0, 0, 0)

            if exact_key in seen_exact:
                continue
            seen_exact.add(exact_key)
            deduped.append(diag)

        # Collapse equivalent duplicates emitted by different internal sources.
        collapsed: list[Diagnostic] = []
        seen_collapsed: set[tuple[str, int, int, int, int, int]] = set()
        for diag in deduped:
            start = diag.range.start
            end = diag.range.end
            key = (
                self._normalized_message(diag.message or ""),
                int(getattr(diag, "severity", 0) or 0),
                start.line,
                start.character,
                end.line,
                end.character,
            )
            if key in seen_collapsed:
                continue
            seen_collapsed.add(key)
            collapsed.append(diag)
        deduped = collapsed

        # If we already have precise non-zero diagnostics, drop equivalent 0:0 fallbacks.
        non_zero_signatures = {
            (
                (diag.source or "").strip().lower(),
                self._diag_code(diag),
                self._normalized_message(diag.message or ""),
            )
            for diag in deduped
            if not self._is_zero_range(diag)
        }
        filtered = [
            diag
            for diag in deduped
            if not (
                self._is_zero_range(diag)
                and (
                    (diag.source or "").strip().lower(),
                    self._diag_code(diag),
                    self._normalized_message(diag.message or ""),
                )
                in non_zero_signatures
            )
        ]

        # Unclosed-delimiter diagnostics are clearer than cascading parse-end token errors.
        has_unclosed_delimiter = any(
            self._diag_code(diag) == "UNCLOSED_DELIMITER" for diag in filtered
        )
        if has_unclosed_delimiter:
            filtered = [
                diag
                for diag in filtered
                if self._diag_code(diag) != "UNEXPECTED_TOKEN"
            ]

        return filtered

    @staticmethod
    def _mark_base_diagnostics(diagnostics: list[Diagnostic]) -> list[Diagnostic]:
        marked: list[Diagnostic] = []
        for diag in diagnostics:
            source = (diag.source or "").strip()
            if source:
                diag.source = f"temple-base:{source}"
            else:
                diag.source = "temple-base"
            marked.append(diag)
        return marked
