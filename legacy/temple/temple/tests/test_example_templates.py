import re
from pathlib import Path

import pytest

from temple.lark_parser import parse_template
from temple.typed_renderer import evaluate_ast
from temple.schema_checker import validate
from html.parser import HTMLParser

# tomllib is only available in Python 3.11+
import importlib.util

HAS_TOMLLIB = importlib.util.find_spec("tomllib") is not None


class _TagTextParser(HTMLParser):
    def __init__(self, target_tag):
        super().__init__()
        self.target = target_tag
        self.in_tag = False
        self.text = ""

    def handle_starttag(self, tag, attrs):
        if tag == self.target:
            self.in_tag = True

    def handle_endtag(self, tag):
        if tag == self.target:
            self.in_tag = False

    def handle_data(self, data):
        if self.in_tag:
            self.text += data


class _CountingHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.starttags = 0

    def handle_starttag(self, tag, attrs):
        self.starttags += 1


BASE_DIR = Path(__file__).parents[2] / "examples" / "templates"


# Create a helper to get files from positive/negative subdirectories
def get_template_path(filename, positive=True):
    """Get the path to a template file in the positive or negative subdirectory."""
    subdir = "positive" if positive else "negative"
    return BASE_DIR / subdir / filename


SCHEMA = {
    "type": "object",
    "required": ["name"],
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "number"},
        "active": {"type": "boolean"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "jobs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "company": {"type": "string"},
                },
            },
        },
    },
}


def render_template_file(path: Path, ctx: dict):
    text = path.read_text()
    root = parse_template(text)
    # load includes if present in examples/templates/includes
    includes = {}
    inc_dir = BASE_DIR / "includes"
    if inc_dir.exists():
        for p in inc_dir.glob("*.tmpl"):
            inc_name = p.stem
            inc_root = parse_template(p.read_text())
            includes[inc_name] = inc_root
    res = evaluate_ast(root, ctx, includes=includes if includes else None)
    ir = res.ir
    if isinstance(ir, list):
        rendered = "".join(str(x) for x in ir)
    else:
        rendered = str(ir)
    return rendered, res.mapping


def parse_structured_from_text(text: str) -> dict:
    # Try to extract simple fields from rendered text (name, age, active, skills, jobs)
    # Name
    name = None
    m = re.search(r"^##\s*(.+)$", text, re.M)
    if m:
        name = m.group(1).strip()
    else:
        m = re.search(r"^Name:\s*(.+)$", text, re.M)
        if m:
            name = m.group(1).strip()
        else:
            m = re.search(r"<h1>([^<]+)</h1>", text)
            if m:
                name = m.group(1).strip()

    # Age
    age = None
    m = re.search(r"^[- ]*Age:\s*(\d+)", text, re.M)
    if m:
        age = int(m.group(1))
    else:
        m = re.search(r"Age:\s*(\d+)", text)
        if m:
            age = int(m.group(1))

    # Active
    active = False
    m = re.search(r"Active:\s*(Yes|No|True|False|true|false)", text)
    if m:
        v = m.group(1).lower()
        active = v in ("yes", "true")

    # Skills: gather list items under Skills:/<ul>
    skills = []
    # markdown list
    for mm in re.findall(r"^\s*[-*]\s*(\S.+)$", text, re.M):
        # only pick lines after Skills: marker
        # naive approach: include first two list items
        skills.append(mm.strip())
        if len(skills) >= 2:
            break
    if not skills:
        # html list
        skills = re.findall(r"<li>([^<]+)</li>", text)
        if skills:
            skills = skills[:2]

    # Job: parse "Job: TITLE at COMPANY"
    job = None
    m = re.search(r"Job:\s*(.+?)\s+at\s+(.+)$", text, re.M)
    if m:
        job = {"title": m.group(1).strip(), "company": m.group(2).strip()}
    else:
        # inline: Job: TITLE at COMPANY
        m = re.search(r"Job:\s*(.+) at (.+)", text)
        if m:
            job = {"title": m.group(1).strip(), "company": m.group(2).strip()}

    out = {
        "name": name,
        "age": age,
        "active": active,
        "skills": skills,
        "jobs": [job] if job else [],
    }
    return out


@pytest.mark.skipif(not HAS_TOMLLIB, reason="tomllib requires Python 3.11+")
def test_toml_positive():
    ctx = {
        "user": {
            "name": "Alice",
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("toml_positive.toml.tmpl", positive=True), ctx
    )
    import tomllib

    parsed = tomllib.loads(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert diags == []


@pytest.mark.skipif(not HAS_TOMLLIB, reason="tomllib requires Python 3.11+")
def test_toml_negative():
    ctx = {
        "user": {
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("toml_negative.toml.tmpl", positive=False), ctx
    )
    import tomllib

    parsed = tomllib.loads(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert any(d["path"].endswith("/name") for d in diags)


def test_md_positive():
    ctx = {
        "user": {
            "name": "Alice",
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("md_positive.md.tmpl", positive=True), ctx
    )
    parsed = parse_structured_from_text(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert diags == []


def test_md_negative():
    ctx = {
        "user": {
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("md_negative.md.tmpl", positive=False), ctx
    )
    parsed = parse_structured_from_text(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert any(d["path"].endswith("/name") for d in diags)


def test_html_positive():
    ctx = {
        "user": {
            "name": "Alice",
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("html_positive.html.tmpl", positive=True), ctx
    )
    parsed = parse_structured_from_text(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert diags == []


def test_html_negative():
    ctx = {
        "user": {
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("html_negative.html.tmpl", positive=False), ctx
    )
    parsed = parse_structured_from_text(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert any(d["path"].endswith("/name") for d in diags)


def test_text_positive():
    ctx = {
        "user": {
            "name": "Alice",
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("text_positive.txt.tmpl", positive=True), ctx
    )
    parsed = parse_structured_from_text(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert diags == []


def test_text_negative():
    ctx = {
        "user": {
            "age": 30,
            "active": True,
            "skills": ["python", "lark"],
            "jobs": [{"title": "Engineer", "company": "Acme"}],
        }
    }
    rendered, mapping = render_template_file(
        get_template_path("text_negative.txt.tmpl", positive=False), ctx
    )
    parsed = parse_structured_from_text(rendered)
    diags = validate(parsed, SCHEMA, mapping=mapping)
    assert any(d["path"].endswith("/name") for d in diags)


@pytest.mark.skipif(
    not HAS_TOMLLIB, reason="tomllib required for TOML validation in includes"
)
def test_includes_match_extension():
    """Ensure include files roughly match their declared extension.

    This is a lightweight, fast check to catch obvious mismatches (HTML in .md,
    non-TOML in .toml, etc.). It uses stdlib parsers where possible to avoid
    adding new dependencies.
    """
    import tomllib

    inc_dir = BASE_DIR / "includes"
    assert inc_dir.exists()
    for p in sorted(inc_dir.glob("*.*.tmpl")):
        name_parts = p.stem.split(".")
        if len(name_parts) < 2:
            continue
        ext = name_parts[-1]
        txt = p.read_text()
        stripped = txt.strip()
        if ext == "md":
            # Require a Markdown header and disallow HTML tags inside includes
            has_header = any(
                re.match(r"^\s{0,3}#{1,6}\s+", line) for line in txt.splitlines()
            )
            has_html_tag = bool(re.search(r"<[^>]+>", txt))
            assert not has_html_tag, (
                f"HTML-like content detected in markdown include {p}"
            )
            assert has_header or len(stripped) > 30, (
                f"Markdown include {p} seems too short or missing header"
            )
        elif ext == "html":
            # Require the content to parse as HTML and contain at least one start tag
            parser = _CountingHTMLParser()
            try:
                parser.feed(txt)
            except Exception:
                assert False, f"Invalid HTML in {p}"
            assert parser.starttags > 0, f"No HTML tags found in {p}"
        elif ext == "txt":
            # Plain text includes must be non-empty and not contain HTML
            assert stripped != "", f"Empty text include: {p}"
            assert "<" not in txt and ">" not in txt, (
                f"HTML-like content in text include: {p}"
            )
        elif ext == "toml":
            # Prefer valid TOML; allow comment-only snippets, or at least one key/table-like line
            try:
                tomllib.loads(txt)
            except Exception:
                # collect non-empty non-comment lines
                lines = [line for line in txt.splitlines() if line.strip()]
                non_comment = [
                    line for line in lines if not line.strip().startswith("#")
                ]
                kv_like = any(
                    re.match(r"^\s*[\w\-\._\"]+\s*=", line) for line in non_comment
                )
                table_like = any(
                    re.match(r"^\s*\[.*\]\s*$", line) for line in non_comment
                )
                assert (not non_comment) or kv_like or table_like, (
                    f"TOML include {p} is not valid TOML and not comment-only"
                )
        else:
            # Unknown extension: ensure it's non-empty and not obviously HTML
            assert stripped != "", f"Empty include: {p}"
            assert "<" not in txt and ">" not in txt, (
                f"HTML-like content in include: {p}"
            )
