from pathlib import Path

from temple.lark_parser import parse_template
from temple.typed_renderer import evaluate_ast


BASE = Path(__file__).parents[2] / "examples" / "templates" / "bench"


def load_template(name: str) -> str:
    return (BASE / name).read_text()


def make_ctx(n_items: int = 10):
    ctx = {
        "user": {
            "name": "Alice",
            "age": 30,
            "active": True,
            "email": "alice@example.com",
            "skills": ["python", "lark", "templating"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        },
        "items": [
            {"title": f"Item {i}", "description": "desc", "tags": ["a", "b"]}
            for i in range(n_items)
        ],
    }
    return ctx


def test_bench_real_small(benchmark):
    tpl = load_template("real_small.md.tmpl")
    root = parse_template(tpl)
    ctx = make_ctx()
    benchmark(lambda: evaluate_ast(root, ctx))


def test_bench_real_medium(benchmark):
    tpl = load_template("real_medium.md.tmpl")
    root = parse_template(tpl)
    ctx = make_ctx()
    benchmark(lambda: evaluate_ast(root, ctx))


def test_bench_real_large(benchmark):
    tpl = load_template("real_large.html.tmpl")
    root = parse_template(tpl)
    ctx = make_ctx(n_items=200)
    benchmark(lambda: evaluate_ast(root, ctx))
