# temple_linter package
"""
Temple Linter - LSP-based linter for Temple DSL templates.

Provides comprehensive syntax validation, semantic type checking,
and advanced IDE features for Temple templates.
"""

# Re-export commonly used temple core types for convenience
try:
    from temple.compiler import (
        TypeChecker,  # pyright: ignore[reportUnusedImport]
        Schema,  # pyright: ignore[reportUnusedImport]
        SchemaParser,  # pyright: ignore[reportUnusedImport]
    )
    from temple.diagnostics import Diagnostic, DiagnosticSeverity  # pyright: ignore[reportUnusedImport]
    from temple.compiler.parser import TypedTemplateParser  # pyright: ignore[reportUnusedImport]
    from temple.typed_ast import (
        Block,  # pyright: ignore[reportUnusedImport]
        Expression,  # pyright: ignore[reportUnusedImport]
        If,  # pyright: ignore[reportUnusedImport]
        For,  # pyright: ignore[reportUnusedImport]
        Include,  # pyright: ignore[reportUnusedImport]
        Text,  # pyright: ignore[reportUnusedImport]
    )

    # Export symbol names as strings to avoid evaluating objects at import-time
    # which improves static analysis and avoids referencing names in the except block.
    __all__ = [
        "TypedTemplateParser",
        "TypeChecker",
        "Diagnostic",
        "DiagnosticSeverity",
        "Schema",
        "SchemaParser",
        "Block",
        "Expression",
        "If",
        "For",
        "Include",
        "Text",
    ]
except ImportError as e:
    import warnings

    warnings.warn(
        f"Could not import temple core: {e}. Please install temple: pip install temple",
        ImportWarning,
    )
    __all__ = []
