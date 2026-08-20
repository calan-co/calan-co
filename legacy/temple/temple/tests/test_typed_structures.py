from temple.typed_ast import ObjectNode, Array, Expression
from temple.diagnostics import Position, SourceRange
from temple.typed_renderer import evaluate_ast, json_serialize


def test_object_and_array_serialization():
    sr = SourceRange(Position(0, 0), Position(0, 0))
    obj = ObjectNode(
        sr,
        [
            ("name", Expression(sr, "user.name")),
            ("skills", Array(sr, [Expression(sr, "user.skills")])),
        ],
    )
    ctx = {"user": {"name": "Alice", "skills": ["Python", "Templating"]}}
    res = evaluate_ast(obj, ctx)
    assert isinstance(res.ir, dict)
    assert res.ir["name"] == "Alice"
    assert isinstance(res.ir["skills"], list)
    assert "Python" in res.ir["skills"]
    # JSON serialize
    js = json_serialize(res.ir)
    assert "Alice" in js
