"""Parity tests for Temple-native vs Jinja2 adapter diagnostics."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("jinja2")

from temple.adapters.jinja2_adapter import Jinja2Adapter
from temple.compiler.type_checker import TypeChecker
from temple.lark_parser import parse_template

FIXTURE_DIR = Path(__file__).parent / "fixtures"
MANIFEST_PATH = FIXTURE_DIR / "manifest.json"
RELEVANT_CODES = {"missing_property", "type_mismatch", "undefined_variable"}


def _load_manifest() -> list[dict]:
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return list(payload.get("cases", []))


def _native_diagnostic_codes(template: str, context: dict) -> set[str]:
    root = parse_template(template)
    checker = TypeChecker(data=context)
    checker.check(root)
    return {err.kind for err in checker.errors.errors}


def _adapter_diagnostic_codes(adapter: Jinja2Adapter, template: str, context: dict) -> set[str]:
    diagnostics = adapter.semantic_diagnostics(template, data=context)
    return {str(diag.get("code")) for diag in diagnostics if diag.get("code")}


@pytest.mark.parametrize("case", _load_manifest(), ids=lambda case: str(case["name"]))
def test_native_and_jinja2_adapter_diagnostics_are_parity_aligned(case: dict) -> None:
    adapter = Jinja2Adapter()
    template = (FIXTURE_DIR / str(case["template"])).read_text(encoding="utf-8")
    context = dict(case["context"])
    expected_codes = set(case["expected_codes"])

    native_codes = _native_diagnostic_codes(template, context)
    adapter_codes = _adapter_diagnostic_codes(adapter, template, context)

    assert expected_codes <= native_codes
    assert expected_codes <= adapter_codes
    assert (native_codes & RELEVANT_CODES) == (adapter_codes & RELEVANT_CODES)
