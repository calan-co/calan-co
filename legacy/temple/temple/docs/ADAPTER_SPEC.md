# Temple Adapter Specification (Draft)

Purpose
-------
This document specifies the adapter contract that allows Temple's type-safety and validation core to interoperate with third-party template engines (initial target: Jinja2). Adapters translate an engine's parse output into Temple's common intermediate representation (IR), provide source mapping for diagnostics, and allow Temple to validate templates without taking over rendering unless requested.

Scope
-----
- Define minimal API surface for adapters
- Define Temple IR (expressions/statements) expected by the type checker
- Specify diagnostics shape and source mapping requirements
- Define filter signature registry integration
- Provide example adapter responsibilities and acceptance criteria

Design goals
------------
- Small, well-documented surface area to reduce maintenance burden
- Preserve precise diagnostics (range-level, not only line numbers)
- Allow adapters to be implemented incrementally (prototype → production)
- Keep Temple-native rendering independent from adapters

Adapter contract (high level)
-----------------------------
An adapter must implement the following minimal functions (conceptual API):

- `parse_to_ir(source: str, filename: str) -> AdapterParseResult`
  - Parse the template with the engine and return an IR representation + source map.

- `map_engine_locations_to_source(loc: EngineLocation) -> SourceRange`
  - Map engine-local locations (line-only / node ids) back to original byte/char ranges.

- `list_used_filters(ir: IR) -> list[str]`
  - Enumerate filter names found in the IR for registry checking.

AdapterParseResult
------------------
- `ir`: Common IR (see below)
- `source_map`: mapping data for diagnostics (engine node → original SourceRange)
- `warnings`: non-fatal parse warnings

Common Intermediate Representation (IR)
--------------------------------------
Minimal IR nodes required by Temple type checker:
- `Text(value: str, start: SourcePos, end: SourcePos)`
- `Expression(expr: str, start: SourcePos, end: SourcePos)`  # expression string or parsed sub-AST
- `Statement(kind: str, args: dict, start: SourcePos, end: SourcePos)`  # if, for, set, include, etc.
- `Block(nodes: list[IRNode], start: SourcePos, end: SourcePos)`

Source positions
----------------
- `SourcePos`: tuple `(line: int, col: int)` (0-indexed) as used throughout Temple
- `SourceRange`: `(start: SourcePos, end: SourcePos)`

Diagnostics contract
--------------------
Adapters must provide diagnostics in the following shape:

- `Diagnostic { message: str, code: Optional[str], severity: int, range: SourceRange, related?: list }`

Temple will merge adapter diagnostics with its own type diagnostics; ranges must resolve to original template positions.

Filter signature registry
-------------------------
- Temple exposes a filter registry where each filter has a typed signature: `FilterSignature(name, input_type, args, output_type)`.
- Adapters map engine filter names to registered signatures. If an engine filter is unknown, the adapter should mark it as `dynamic` and Temple will apply conservative checks.

Source mapping expectations
--------------------------
- If the engine only exposes line numbers, the adapter should attempt best-effort mapping (token-level heuristics) to derive column ranges.
- For precise diagnostics, adapters should prefer byte/char offsets if available.

Rendering choices
-----------------
Adapters may opt to:
- Delegate rendering to the engine (Temple validates only), or
- Convert IR to Temple-native AST and render with Temple renderer (Temple owns rendering).

Acceptance criteria for a Jinja2 adapter prototype
-------------------------------------------------
- Parse a representative subset of templates and generate IR.
- Produce diagnostics for undefined variables and basic type mismatches.
- Map engine diagnostics to original template ranges with reasonable precision.
- Wire up filter registry for 10 common filters and validate signatures.
- Provide a parity test comparing adapter validation with Temple-native results for a set of fixtures.

Examples & notes
----------------
- The adapter should be implemented in a separate module (e.g., `temple.adapters.jinja2`) and include tests and examples.
- Keep the adapter's public API small and documented.

Next steps
----------
1. Draft concrete Python interfaces for `parse_to_ir` and `AdapterParseResult` in `temple/sdk/adapter.py`.
2. Implement a minimal Jinja2 adapter prototype that performs AST walking and returns the required IR.
3. Add parity tests and CI checks.


---

(END OF SPEC - draft)