# Error Reporting Strategy for Temple Parser & Linter

"""
Error reporting is designed to be clear, actionable, and reference both the query and schema location when possible.

1. Inline Error Annotations:
   - Errors are attached to specific tokens (statements, expressions) with start/end positions.
   - Example: LintError: Unclosed block(s): if @ 0-12

2. Summary Reporting:
   - After linting, a summary of all errors is provided, listing error type, message, and location.

3. Error Types:
   - Syntax errors: Unmatched blocks, empty statements/expressions, malformed tokens.
   - Logic errors: Invalid query paths, type mismatches, unsupported primitives.
   - Format errors: (optional) Invalid base format detected by pluggable adapter.

4. Actionable Messages:
   - Each error message describes the problem and suggests a fix (e.g., "Unmatched end: did you forget to close an 'if' block?").
   - Messages reference the exact location in the template.

5. Best-Effort Output:
   - If errors are found, the linter can annotate the output or provide a best-effort rendering with error comments.

6. Extensibility:
   - Error reporting can be extended to include schema/query validation errors, referencing the schema location and query path.

Example Error Message:
    LintError: Property 'address' not found in schema for 'user' @ 42-56

"""
