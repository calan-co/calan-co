from typing import Any, Dict, List, Optional, Tuple


def _find_node_pos(
    mapping: Optional[List[Tuple[str, Tuple[int, int]]]],
    preferred_path: Optional[str] = None,
):
    if not mapping:
        return None
    if preferred_path:
        # mapping entries are (path, pos)
        for p, pos in mapping:
            if p == preferred_path or p.startswith(preferred_path + "/"):
                return pos
    # fallback to the first mapping entry's position
    return mapping[0][1]


def validate(
    ir: Any,
    schema: Dict[str, Any],
    mapping: Optional[List[Tuple[str, Tuple[int, int]]]] = None,
    path: str = "",
) -> List[Dict[str, Any]]:
    """Validate a Python IR against a minimal JSON-schema-like spec.

    Supported schema keys: 'type' (object, array, string, number, boolean),
    'properties' (dict), 'required' (list), 'items' (schema).

    Returns list of diagnostics: {path, message, node_pos}
    """
    diags: List[Dict[str, Any]] = []

    t = schema.get("type")
    if t == "object":
        if not isinstance(ir, dict):
            diags.append(
                {
                    "path": path or "/",
                    "message": f"expected object, got {type(ir).__name__}",
                    "node_pos": _find_node_pos(mapping, path or "/"),
                }
            )
            return diags
        # required
        for req in schema.get("required", []):
            if req not in ir:
                diags.append(
                    {
                        "path": f"{path}/{req}",
                        "message": "required property missing",
                        "node_pos": _find_node_pos(mapping, path or "/"),
                    }
                )
        props = schema.get("properties", {})
        for key, subschema in props.items():
            if key in ir:
                # no fine-grained mapping available in prototype; pass same mapping
                diags.extend(validate(ir[key], subschema, mapping, f"{path}/{key}"))
        return diags

    if t == "array":
        if not isinstance(ir, list):
            diags.append(
                {
                    "path": path or "/",
                    "message": f"expected array, got {type(ir).__name__}",
                    "node_pos": _find_node_pos(mapping, path or "/"),
                }
            )
            return diags
        item_schema = schema.get("items")
        if item_schema:
            for idx, item in enumerate(ir):
                diags.extend(validate(item, item_schema, mapping, f"{path}/{idx}"))
        return diags

    if t == "string":
        if not isinstance(ir, str):
            diags.append(
                {
                    "path": path or "/",
                    "message": f"expected string, got {type(ir).__name__}",
                    "node_pos": _find_node_pos(mapping, path or "/"),
                }
            )
        return diags

    if t == "number":
        if not isinstance(ir, (int, float)):
            diags.append(
                {
                    "path": path or "/",
                    "message": f"expected number, got {type(ir).__name__}",
                    "node_pos": _find_node_pos(mapping, path or "/"),
                }
            )
        return diags

    if t == "boolean":
        if not isinstance(ir, bool):
            diags.append(
                {
                    "path": path or "/",
                    "message": f"expected boolean, got {type(ir).__name__}",
                    "node_pos": _find_node_pos(mapping, path or "/"),
                }
            )
        return diags

    # no type specified — accept anything
    return diags


__all__ = ["validate"]
