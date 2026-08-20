# Temple: Sample Architecture

## Overview
A declarative, type-safe transformation engine for structured data that validates and emits your target format.

Temple is designed to be data format-agnostic, supporting JSON, XML, YAML, TOML, and future formats. The architecture is modular, with pluggable parsers, a unified query engine, and a consistent templating DSL overlaying the target output format.

See ADRs: [Market Role & Adapter Architecture](adr/003-market-role-and-adapter-architecture.md) and [Base-Lint Strategy and Diagnostics Pipeline](adr/005-base-lint-strategy-and-diagnostics-pipeline.md) for market positioning and author-time diagnostics strategy across base-language tooling.

## Components

### 1. Input Data Parsers
- **Purpose:** Parse input data (JSON, XML, YAML, TOML, etc.) into a normalized internal object model (tree/graph).
- **Implementation:** Pluggable adapters for each format.

### 2. Schema Validator
- **Purpose:** Validate input data against its schema (JSON Schema, XML Schema, etc.).
- **Implementation:** Use format-specific validators; optionally convert to a meta-schema for unified validation.

### 3. Query Engine
- **Purpose:** Provide a unified way to access and traverse the normalized object model.
- **Implementation:** Support dot notation, JMESPath, or pluggable query languages.

### 4. Template Parser & Linter
- **Purpose:** Parse templates written in the target output format with DSL overlays; lint for syntax and logic errors.
- **Implementation:** Custom parser that recognizes both the base format and DSL extensions.

### 5. Output Format Linter
- **Purpose:** Validate the template (and rendered output) against the target format's linter (e.g., markdownlint, htmlhint, JSON Schema).
- **Implementation:** Integrate with existing linters, ignoring or handling DSL tokens.

### 6. Rendering Engine
- **Purpose:** Apply the template logic to the normalized object model, producing the final output in the target format.
- **Implementation:** Walk the template AST, resolve queries, and render output.

### 7. Error Reporting & Feedback
- **Purpose:** Provide actionable error messages and best-effort output with annotations for template, query, or output issues.
- **Implementation:** Error handling at each stage, with inline or summary reporting.

### 8. CLI/Editor Integration
- **Purpose:** Real-time feedback, live preview, and developer tooling.
- **Implementation:** CLI commands and/or editor plugins for linting, validation, and preview.

## Data Flow Diagram

Input Data (JSON/XML/YAML/TOML) → [Parser] → Normalized Object Model → [Schema Validator] → [Query Engine] ← [Template Parser & Linter] ← Template (Markdown/HTML/JSON + DSL)

[Rendering Engine] → Output (Markdown/HTML/JSON/etc.) → [Output Format Linter]

[Error Reporting & Feedback] at all stages

---

See `README.md` and `/backlog/temple.md` for vision, goals, and work items.

### Changelog

- January 2026: Added ADR-003 describing market positioning and adapter architecture; plan to ship Temple-native first and provide an adapter interface for engine integrations.
- February 2026: Added ADR-005 to define base-lint strategy precedence (`embedded -> virtual -> mirror-file`), focus mode scope, and diagnostics quality/performance constraints.
