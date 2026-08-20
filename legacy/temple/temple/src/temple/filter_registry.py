"""Filter registry and runtime adapter for Temple expression pipelines."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

FilterImplementation = Callable[[Any, tuple[Any, ...]], Any]


@dataclass(frozen=True)
class FilterSignature:
    """Typed metadata for a registered filter."""

    name: str
    input_type: str
    argument_types: tuple[str, ...]
    output_type: str
    description: str = ""


@dataclass(frozen=True)
class _RegisteredFilter:
    signature: FilterSignature
    implementation: FilterImplementation


class FilterAdapter:
    """Apply registered filters to expression values."""

    def __init__(self, filters: dict[str, _RegisteredFilter] | None = None):
        self._filters = dict(filters or _build_core_filters())

    def apply(self, value: Any, filter_name: str, args: tuple[Any, ...] = ()) -> Any:
        registered = self._filters.get(filter_name)
        if registered is None:
            return None
        try:
            return registered.implementation(value, args)
        except Exception:
            return None

    def has_filter(self, filter_name: str) -> bool:
        return filter_name in self._filters

    def get_signature(self, filter_name: str) -> FilterSignature | None:
        registered = self._filters.get(filter_name)
        if registered is None:
            return None
        return registered.signature

    def list_signatures(self) -> tuple[FilterSignature, ...]:
        return tuple(
            self._filters[name].signature for name in sorted(self._filters.keys())
        )

    def list_names(self) -> tuple[str, ...]:
        return tuple(sorted(self._filters.keys()))


def _resolve_attr(value: Any, attr: str) -> Any:
    if isinstance(value, dict):
        return value.get(attr)
    return getattr(value, attr, None)


def _as_sequence(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


def _filter_selectattr(value: Any, args: tuple[Any, ...]) -> list[Any]:
    items = _as_sequence(value)
    if not args:
        return items

    attr = str(args[0])
    if len(args) >= 2:
        expected = args[1]
        return [item for item in items if _resolve_attr(item, attr) == expected]

    return [item for item in items if _resolve_attr(item, attr)]


def _filter_map(value: Any, args: tuple[Any, ...]) -> list[Any]:
    items = _as_sequence(value)
    if not args:
        return items

    attr = str(args[0])
    return [_resolve_attr(item, attr) for item in items]


def _filter_join(value: Any, args: tuple[Any, ...]) -> str:
    delimiter = str(args[0]) if args else ""
    if isinstance(value, (list, tuple)):
        return delimiter.join("" if item is None else str(item) for item in value)
    return "" if value is None else str(value)


def _filter_default(value: Any, args: tuple[Any, ...]) -> Any:
    fallback = args[0] if args else ""
    if value is None:
        return fallback
    if isinstance(value, str) and value == "":
        return fallback
    if isinstance(value, (list, tuple, dict, set)) and len(value) == 0:
        return fallback
    return value


def _build_core_filters() -> dict[str, _RegisteredFilter]:
    return {
        "selectattr": _RegisteredFilter(
            signature=FilterSignature(
                name="selectattr",
                input_type="array[object]",
                argument_types=("string", "any?"),
                output_type="array[object]",
                description="Select objects where an attribute is truthy or equals a value.",
            ),
            implementation=_filter_selectattr,
        ),
        "map": _RegisteredFilter(
            signature=FilterSignature(
                name="map",
                input_type="array[object]",
                argument_types=("string",),
                output_type="array[any]",
                description="Project an attribute from each object in an array.",
            ),
            implementation=_filter_map,
        ),
        "join": _RegisteredFilter(
            signature=FilterSignature(
                name="join",
                input_type="array[any]",
                argument_types=("string?",),
                output_type="string",
                description="Join array items into a string with an optional separator.",
            ),
            implementation=_filter_join,
        ),
        "default": _RegisteredFilter(
            signature=FilterSignature(
                name="default",
                input_type="any",
                argument_types=("any",),
                output_type="any",
                description="Provide a fallback when a value is empty.",
            ),
            implementation=_filter_default,
        ),
    }


DEFAULT_FILTER_ADAPTER = FilterAdapter()
CORE_FILTER_SIGNATURES: tuple[FilterSignature, ...] = (
    DEFAULT_FILTER_ADAPTER.list_signatures()
)


__all__ = [
    "CORE_FILTER_SIGNATURES",
    "DEFAULT_FILTER_ADAPTER",
    "FilterAdapter",
    "FilterSignature",
]
