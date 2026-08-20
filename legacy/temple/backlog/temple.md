# Meta-Templating System: Work Items

## 1. Tree-Based Templating Logic
- Research and define tree-based logic primitives (loops, conditionals, includes)
- Evaluate existing engines (XSLT, Jsonnet, jq, Markdoc, Jinja2) for inspiration
- Design AST structure for templates

## 2. Lightweight DSLs
- Specify minimal, consistent logic syntax (e.g., `{% ... %}`, `{{ ... }}`)
- Define object-model query syntax (dot notation, JMESPath, etc.)
- Ensure DSL overlays do not break target format linting
- Design for pluggable data format support (JSON, XML, YAML, TOML, ...)
- Support user-defined functions and custom logic extensions

## 3. Dev-Time Validation
- Integrate template syntax linting (custom linter or extension of existing linters)
- Implement query validation against input schema (JSON Schema, XML Schema, etc.)
- Integrate output format linters (markdownlint, htmlhint, JSON Schema, etc.)
- Ensure template is valid in target format even with DSL overlays

## 4. Post-Rendering Feedback
- Design error reporting and annotation system for best-effort rendering
- Provide actionable error messages for template, query, and output issues
- Support partial rendering with error placeholders

## 5. User Experience
- CLI and/or editor plugin for real-time feedback
- Live preview of rendered output and errors
- Documentation and onboarding for template authors

## 6. Architecture & Extensibility
- Pluggable data format parsers and schema validators (JSON, XML, YAML, TOML, ...)
- Unified query engine for all object models
- Support for new output formats with minimal changes
- Modular, testable codebase

---

See `/temple/README.md` and `/temple/ARCHITECTURE.md` for project vision, architecture, and roadmap.