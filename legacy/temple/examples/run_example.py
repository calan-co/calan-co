#!/usr/bin/env python3
"""
run_example.py

Reusable script to render DSL template examples across all output formats.

Usage:
    python run_example.py html             # Render HTML example
    python run_example.py md               # Render Markdown example
    python run_example.py text             # Render Text example
    python run_example.py toml             # Render TOML example
    python run_example.py all              # Render all examples
    python run_example.py all --compare    # Render and compare with expected outputs
    python run_example.py html --compare   # Render HTML and compare
"""

import sys
import json
from pathlib import Path
from temple.lark_parser import parse_template
from temple.typed_renderer import evaluate_ast


# Paths (this script is located in examples/)
SCRIPT_DIR = Path(__file__).parent
TEMPLATES_DIR = SCRIPT_DIR / "templates"
OUTPUTS_DIR = SCRIPT_DIR / "outputs"
INCLUDES_DIR = TEMPLATES_DIR / "includes"

# Mapping of format names to file extensions
FORMATS = {
    "html": "html",
    "md": "md",
    "text": "txt",
    "toml": "toml",
}


def load_sample_data() -> dict:
    """Load sample input data from JSON file."""
    data_file = SCRIPT_DIR / "sample_data.json"
    if not data_file.exists():
        print(f"Error: Sample data file not found: {data_file}")
        sys.exit(1)

    with open(data_file) as f:
        return json.load(f)


def render_example(format_name: str, compare: bool = False) -> None:
    """
    Render an example for the specified format.

    Args:
        format_name: Format identifier (html, md, text, toml)
        compare: Whether to compare output with expected result
    """
    if format_name not in FORMATS:
        print(f"Error: Unknown format '{format_name}'")
        print(f"Supported formats: {', '.join(FORMATS.keys())}")
        sys.exit(1)

    file_ext = FORMATS[format_name]

    # File paths
    template_file = (
        TEMPLATES_DIR / "positive" / f"{format_name}_positive.{file_ext}.tmpl"
    )
    output_file = OUTPUTS_DIR / f"{format_name}_positive.{file_ext}.output"

    # Verify files exist
    if not template_file.exists():
        print(f"Error: Template file not found: {template_file}")
        sys.exit(1)

    # Load sample data
    sample_data = load_sample_data()

    # Parse template
    template_text = template_file.read_text()
    try:
        root = parse_template(template_text)
    except Exception as e:
        print(f"Error parsing template: {e}")
        sys.exit(1)

    # Load includes if present
    includes = {}
    if INCLUDES_DIR.exists():
        for p in INCLUDES_DIR.glob("*.tmpl"):
            inc_name = p.stem
            try:
                inc_root = parse_template(p.read_text())
                includes[inc_name] = inc_root
            except Exception as e:
                print(f"Warning: Could not parse include {inc_name}: {e}")

    # Render template
    try:
        res = evaluate_ast(root, sample_data, includes=includes if includes else None)
        ir = res.ir
        if isinstance(ir, list):
            output = "".join(str(x) for x in ir)
        else:
            output = str(ir)
    except Exception as e:
        print(f"Error rendering template: {e}")
        sys.exit(1)

    # Display result
    print(f"\n{'=' * 60}")
    print(f"Format: {format_name.upper()}")
    print(f"Template: {template_file.name}")
    print(f"{'=' * 60}\n")
    print(output)

    # Compare if requested
    if compare:
        if output_file.exists():
            expected = output_file.read_text()
            if output == expected:
                print(f"\n✓ Output matches expected result ({output_file.name})")
            else:
                print(f"\n✗ Output DOES NOT match expected result ({output_file.name})")
                print(f"\n--- Expected ({output_file.name}) ---")
                print(expected)
                print("\n--- Differences ---")
                import difflib

                diff = difflib.unified_diff(
                    expected.splitlines(keepends=True),
                    output.splitlines(keepends=True),
                    fromfile=str(output_file.name),
                    tofile="actual",
                )
                print("".join(diff))
        else:
            print(f"\n⚠ No expected output file found: {output_file.name}")


def main() -> None:
    """Main entry point."""
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1].lower()
    compare = "--compare" in sys.argv

    if command == "all":
        for format_name in FORMATS.keys():
            render_example(format_name, compare)
    else:
        render_example(command, compare)


if __name__ == "__main__":
    main()
