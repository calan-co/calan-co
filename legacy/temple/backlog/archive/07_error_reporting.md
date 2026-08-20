---
title: "Error Reporting and Best-Effort Rendering"
status: not_started
priority: HIGH
complexity: Medium
 dependencies:
   - [[04_template_parser_linter.md]]
   - [[06_rendering_engine.md]]
 related_backlog:
   - [[12_diagnostics_mapping.md]]
   - [[13_combine_template_and_base_diagnostics.md]]
estimated_effort: 1 week

## Deliverables
- Error reporting module
- Annotation strategy for rendered output
- Example error messages and annotated outputs
- Integration with CLI/editor feedback

## Acceptance Criteria
- Errors are reported at each stage (template, query, output)
- Best-effort rendering produces as much valid output as possible
- Error annotations are clear and non-intrusive
- Example workflows demonstrate error handling
