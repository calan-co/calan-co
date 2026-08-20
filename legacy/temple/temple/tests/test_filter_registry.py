"""Tests for Temple filter pipelines and registry behavior."""

from temple.expression_eval import evaluate_expression, parse_filter_pipeline
from temple.filter_registry import CORE_FILTER_SIGNATURES


def test_parse_filter_pipeline_extracts_base_and_filters() -> None:
    base_expr, filters = parse_filter_pipeline("users | map('name') | join(', ')")

    assert base_expr == "users"
    assert [f.name for f in filters] == ["map", "join"]
    assert filters[0].args == ("'name'",)
    assert filters[1].args == ("', '",)


def test_runtime_pipeline_map_join() -> None:
    context = {"users": [{"name": "Ada"}, {"name": "Grace"}]}
    result = evaluate_expression("users | map('name') | join(', ')", context)

    assert result == "Ada, Grace"


def test_runtime_pipeline_selectattr_default() -> None:
    context = {
        "users": [
            {"name": "Ada", "active": True},
            {"name": "Grace", "active": False},
        ],
        "profile": {"nickname": ""},
    }
    active_names = evaluate_expression(
        "users | selectattr('active') | map('name') | join(', ')",
        context,
    )
    nickname = evaluate_expression("profile.nickname | default('Anonymous')", context)

    assert active_names == "Ada"
    assert nickname == "Anonymous"


def test_runtime_pipeline_unknown_filter_returns_none() -> None:
    context = {"users": [{"name": "Ada"}]}
    result = evaluate_expression("users | does_not_exist('name')", context)

    assert result is None


def test_core_filter_signatures_present() -> None:
    names = {signature.name for signature in CORE_FILTER_SIGNATURES}
    assert {"selectattr", "map", "join", "default"} <= names
