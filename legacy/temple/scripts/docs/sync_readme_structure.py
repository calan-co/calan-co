#!/usr/bin/env python3
"""Synchronize auto-generated Markdown structure blocks.

Markers format:
  <!-- BEGIN:project-structure path=<relative-path> [depth=<int>] [include=<glob>] -->
  <!-- BEGIN:project-structure path=<relative-path> [depth=<int>] [exclude=<glob>] -->
  <!-- BEGIN:project-structure path=<relative-path> [annotations=<relative-path>] -->
  <!-- BEGIN:project-structure path=<relative-path> [section=<name>] -->
  <!-- BEGIN:project-structure path=<relative-path> ... path=<relative-path> ... -->
  ... generated content ...
  <!-- END:project-structure -->

Markers without a ``path=...`` attribute are treated as static blocks and left
unchanged. Use --write to update files in place, or --check to fail on drift.

Path exclusion rules are derived from `.gitignore` and `.ignore`, with `.git`
always excluded.

Legacy annotation manifests can use one entry per line, e.g.:
  templates/negative/ = ❌ Validation error examples
  README.md = ⭐ You are here

YAML manifests are preferred and support scoped notes:
  default:
    README.md: ⭐ You are here
  scopes:
    "file:temple-linter/README.md#tests":
      fixtures/: Test fixtures
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import re
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path

BEGIN_RE = re.compile(r"<!--\s*BEGIN:project-structure(?P<attrs>[^>]*)-->")
BLOCK_RE = re.compile(
    r"(?P<begin><!--\s*BEGIN:project-structure(?P<attrs>[^>]*)-->)(?P<body>.*?)(?P<end><!--\s*END:project-structure\s*-->)",
    re.DOTALL,
)

IGNORE_FILES = (".gitignore", ".ignore")

ALLOWED_KEYS = {
    "path",
    "depth",
    "exclude",
    "include",
    "annotations",
    "section",
}


@dataclass(frozen=True)
class IgnoreRule:
    negated: bool
    pattern: str
    anchored: bool
    dir_only: bool
    is_glob: bool
    has_slash: bool

    def matches(self, rel_path: str, name: str, is_dir: bool) -> bool:
        if self.dir_only and not is_dir:
            return False

        if self.anchored or self.has_slash:
            candidates = [rel_path]
        else:
            candidates = [name, rel_path]

        if self.is_glob:
            return any(
                fnmatch.fnmatchcase(candidate, self.pattern) for candidate in candidates
            )

        if self.anchored or self.has_slash:
            return rel_path == self.pattern or rel_path.startswith(f"{self.pattern}/")
        return name == self.pattern


@dataclass(frozen=True)
class IgnoreConfig:
    excluded_files: tuple[str, ...]
    rules: tuple[IgnoreRule, ...]


@dataclass(frozen=True)
class PathRenderSpec:
    path: str
    depth: int
    excludes: tuple[str, ...]
    includes: tuple[str, ...]
    annotations: str | None
    section: str | None


@dataclass(frozen=True)
class AnnotationWarning:
    spec_path: str
    annotations_path: str
    section: str | None
    unused_keys: tuple[str, ...]


@dataclass(frozen=True)
class AnnotationManifest:
    sections: dict[str, dict[str, str]]


def _read_ignore_entries(repo_root: Path) -> list[str]:
    entries: list[str] = []
    for filename in IGNORE_FILES:
        path = repo_root / filename
        if not path.exists():
            continue

        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            entries.append(line)
    return entries


def build_ignore_config(repo_root: Path) -> IgnoreConfig:
    entries = _read_ignore_entries(repo_root)
    excluded_files: set[str] = {".git"}
    rules: list[IgnoreRule] = [
        IgnoreRule(
            negated=False,
            pattern=".git",
            anchored=False,
            dir_only=True,
            is_glob=False,
            has_slash=False,
        )
    ]

    for raw_entry in entries:
        negated = raw_entry.startswith("!")
        entry = raw_entry[1:] if negated else raw_entry
        if entry.startswith("./"):
            entry = entry[2:]

        if not entry:
            continue

        dir_only = entry.endswith("/")
        normalized = entry[:-1] if dir_only else entry
        anchored = normalized.startswith("/")
        if anchored:
            normalized = normalized.lstrip("/")
        if not normalized:
            continue

        is_glob = any(ch in normalized for ch in "*?[]")
        has_slash = "/" in normalized

        if not is_glob:
            if negated:
                excluded_files.discard(normalized)
            else:
                excluded_files.add(normalized)

        rules.append(
            IgnoreRule(
                negated=negated,
                pattern=normalized,
                anchored=anchored,
                dir_only=dir_only,
                is_glob=is_glob,
                has_slash=has_slash,
            )
        )

    return IgnoreConfig(
        excluded_files=tuple(sorted(excluded_files)),
        rules=tuple(rules),
    )


def should_exclude_path(
    rel_path: Path, is_dir: bool, ignore_config: IgnoreConfig
) -> bool:
    rel_posix = rel_path.as_posix()
    if rel_posix.startswith("./"):
        rel_posix = rel_posix[2:]
    name = rel_path.name

    if (
        rel_posix in ignore_config.excluded_files
        or name in ignore_config.excluded_files
    ):
        return True

    excluded = False

    for rule in ignore_config.rules:
        if rule.matches(rel_posix, name, is_dir):
            excluded = not rule.negated

    return excluded


def _parse_tokens(attr_text: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for token in shlex.split(attr_text.strip()):
        if "=" not in token:
            raise ValueError(f"invalid attribute token (expected key=value): {token}")
        key, value = token.split("=", 1)
        pairs.append((key.strip(), value.strip()))
    return pairs


ParamSpec = dict[str, int | str | list[str] | None]


def parse_render_specs(attr_text: str) -> list[PathRenderSpec]:
    default_depth = 2
    default_excludes: list[str] = []
    default_includes: list[str] = []
    default_annotations: str | None = None
    default_section: str | None = None
    raw_specs: list[ParamSpec] = []
    current: ParamSpec | None = None

    for key, value in _parse_tokens(attr_text):
        normalized_key = key.lower()
        if normalized_key not in ALLOWED_KEYS:
            allowed_text = ", ".join(sorted(ALLOWED_KEYS))
            raise ValueError(
                f"unrecognized attribute key: {key} (allowed: {allowed_text})"
            )
        if normalized_key == "path":
            EMPTY_LIST: list[str] = []
            current = {
                "path": value,
                "depth": None,
                "excludes": EMPTY_LIST.copy(),
                "includes": EMPTY_LIST.copy(),
                "annotations": None,
                "section": None,
            }
            raw_specs.append(current)
            continue

        if normalized_key == "depth":
            try:
                parsed_depth = max(0, int(value))
            except ValueError as exc:
                raise ValueError(f"invalid depth value: {value}") from exc

            if current is None:
                default_depth = parsed_depth
            else:
                current["depth"] = parsed_depth
            continue

        if normalized_key == "exclude":
            if current is None:
                default_excludes.append(value)
            else:
                excludes = current["excludes"]
                assert isinstance(excludes, list)
                excludes.append(value)
            continue

        if normalized_key == "include":
            if current is None:
                default_includes.append(value)
            else:
                includes = current.get("includes")
                if not isinstance(includes, list):
                    includes = []
                    current["includes"] = includes
                includes.append(value)
            continue

        if normalized_key == "annotations":
            if current is None:
                default_annotations = value
            else:
                current["annotations"] = value
            continue

        if normalized_key == "section":
            if current is None:
                default_section = value
            else:
                current["section"] = value

    specs: list[PathRenderSpec] = []
    for spec in raw_specs:
        path = spec["path"]
        if not isinstance(path, str) or not path:
            continue

        depth_obj = spec["depth"]
        depth = depth_obj if isinstance(depth_obj, int) else default_depth

        raw_excludes = spec["excludes"]
        scoped_excludes = list(default_excludes)
        if isinstance(raw_excludes, list):
            scoped_excludes.extend(pattern for pattern in raw_excludes)
        raw_includes = spec.get("includes")
        scoped_includes = list(default_includes)
        if isinstance(raw_includes, list):
            scoped_includes.extend(pattern for pattern in raw_includes)

        annotations_obj = spec.get("annotations")
        annotations = (
            str(annotations_obj)
            if isinstance(annotations_obj, str)
            else default_annotations
        )
        section_obj = spec.get("section")
        section = str(section_obj) if isinstance(section_obj, str) else default_section

        specs.append(
            PathRenderSpec(
                path=path,
                depth=depth,
                excludes=tuple(scoped_excludes),
                includes=tuple(scoped_includes),
                annotations=annotations,
                section=section,
            )
        )

    return specs


def _normalize_annotation_key(key: str) -> str:
    normalized = key.strip().replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized.startswith("/"):
        normalized = normalized[1:]
    if not normalized or normalized == ".":
        return "."
    return normalized


def _parse_legacy_annotations(content: str) -> dict[str, str]:
    notes: dict[str, str] = {}
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if "=" in line:
            raw_key, raw_note = line.split("=", 1)
        elif ":" in line:
            raw_key, raw_note = line.split(":", 1)
        else:
            continue

        key = _normalize_annotation_key(raw_key)
        note = raw_note.strip()
        if note:
            notes[key] = note
    return notes


def _parse_yaml_scalar(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value[0] in {"'", '"'} and value[-1] == value[0]:
        try:
            parsed = ast.literal_eval(value)
            return str(parsed)
        except (SyntaxError, ValueError):
            return value[1:-1]
    return value


def _split_yaml_key_value(raw: str) -> tuple[str, str] | None:
    quote: str | None = None
    escaped = False
    for idx, char in enumerate(raw):
        if escaped:
            escaped = False
            continue
        if char == "\\" and quote:
            escaped = True
            continue
        if char in {'"', "'"}:
            if quote is None:
                quote = char
            elif quote == char:
                quote = None
            continue
        if char == ":" and quote is None:
            return raw[:idx], raw[idx + 1 :]
    return None


def _parse_yaml_key_value(raw: str, line_no: int, path: str) -> tuple[str, str]:
    split_result = _split_yaml_key_value(raw)
    if split_result is None:
        raise ValueError(f"invalid YAML entry at {path}:{line_no}: missing ':'")
    key_raw, value_raw = split_result
    key = _parse_yaml_scalar(key_raw)
    value = value_raw.strip()
    return key, value


def _parse_yaml_annotations(content: str, path: str) -> AnnotationManifest:
    sections: dict[str, dict[str, str]] = {}
    active_root: str | None = None
    active_scope: str | None = None

    for line_no, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "\t" in raw_line:
            raise ValueError(f"invalid YAML indentation (tab) at {path}:{line_no}")

        indent = len(raw_line) - len(raw_line.lstrip(" "))
        if indent not in {0, 2, 4}:
            raise ValueError(
                f"invalid YAML indentation at {path}:{line_no}: expected 0/2/4 spaces"
            )

        if indent == 0:
            key, value = _parse_yaml_key_value(stripped, line_no, path)
            if value:
                raise ValueError(
                    f"invalid YAML root entry at {path}:{line_no}: expected nested mapping"
                )
            if key not in {"default", "scopes"}:
                raise ValueError(
                    f"invalid YAML root key at {path}:{line_no}: expected 'default' or 'scopes'"
                )
            active_root = key
            active_scope = None
            if key == "default":
                sections.setdefault("default", {})
            continue

        if indent == 2:
            if active_root == "default":
                key, value = _parse_yaml_key_value(stripped, line_no, path)
                if not value:
                    raise ValueError(
                        f"invalid default note at {path}:{line_no}: note text is required"
                    )
                sections.setdefault("default", {})[_normalize_annotation_key(key)] = (
                    _parse_yaml_scalar(value)
                )
                continue

            if active_root == "scopes":
                key, value = _parse_yaml_key_value(stripped, line_no, path)
                if value:
                    raise ValueError(
                        f"invalid scope entry at {path}:{line_no}: expected nested mapping"
                    )
                scope_name = _parse_yaml_scalar(key).strip()
                if not scope_name:
                    raise ValueError(f"invalid empty scope at {path}:{line_no}")
                active_scope = scope_name
                sections.setdefault(active_scope, {})
                continue

            raise ValueError(
                f"invalid YAML structure at {path}:{line_no}: unexpected entry"
            )

        if indent == 4:
            if active_root != "scopes" or not active_scope:
                raise ValueError(
                    f"invalid YAML structure at {path}:{line_no}: nested note requires an active scope"
                )
            key, value = _parse_yaml_key_value(stripped, line_no, path)
            if not value:
                raise ValueError(
                    f"invalid scoped note at {path}:{line_no}: note text is required"
                )
            sections.setdefault(active_scope, {})[_normalize_annotation_key(key)] = (
                _parse_yaml_scalar(value)
            )

    return AnnotationManifest(sections=sections)


def _normalize_scope_token(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized.startswith("/"):
        normalized = normalized[1:]
    return normalized


def load_annotations_manifest(
    repo_root: Path, annotations_path: str | None
) -> AnnotationManifest:
    if not annotations_path:
        return AnnotationManifest(sections={})

    target = repo_root / annotations_path
    if not target.exists() or not target.is_file():
        raise ValueError(
            f"annotations file does not exist or is not a file: {annotations_path}"
        )

    content = target.read_text(encoding="utf-8")
    suffixes = {suffix.lower() for suffix in target.suffixes}
    if ".yaml" in suffixes or ".yml" in suffixes:
        return _parse_yaml_annotations(content, annotations_path)

    return AnnotationManifest(sections={"default": _parse_legacy_annotations(content)})


def resolve_annotations(
    manifest: AnnotationManifest,
    markdown_rel_path: str,
    tree_path: str,
    section: str | None,
) -> dict[str, str]:
    merged: dict[str, str] = {}
    normalized_markdown = _normalize_scope_token(markdown_rel_path)
    normalized_tree_path = _normalize_scope_token(tree_path)
    normalized_section = section.strip() if section else None

    precedence: list[str] = ["default", "global"]
    if normalized_section:
        precedence.extend([f"section:{normalized_section}", normalized_section])
    precedence.extend(
        [
            f"file:{normalized_markdown}",
            f"path:{normalized_tree_path}",
        ]
    )
    if normalized_section:
        precedence.extend(
            [
                f"file:{normalized_markdown}#{normalized_section}",
                f"path:{normalized_tree_path}#{normalized_section}",
            ]
        )

    seen: set[str] = set()
    for scope in precedence:
        if scope in seen:
            continue
        seen.add(scope)
        scoped_notes = manifest.sections.get(scope)
        if scoped_notes:
            merged.update(scoped_notes)
    return merged


def lookup_annotation(
    rel_path: Path, is_dir: bool, annotations: dict[str, str]
) -> tuple[str | None, str | None]:
    rel_posix = rel_path.as_posix()
    if rel_posix in {"", "."}:
        note = annotations.get(".")
        return note, "." if note else None

    if is_dir:
        dir_key = f"{rel_posix}/"
        if dir_key in annotations:
            return annotations[dir_key], dir_key
        if rel_posix in annotations:
            return annotations[rel_posix], rel_posix
        return None, None

    if rel_posix in annotations:
        return annotations[rel_posix], rel_posix
    return None, None


def format_annotated_lines(items: list[tuple[str, str | None]]) -> list[str]:
    if not any(note for _, note in items):
        return [line for line, _ in items]

    longest_path_width = max(len(line) for line, _ in items)
    note_column = longest_path_width + 2
    formatted: list[str] = []
    for line, note in items:
        if not note:
            formatted.append(line)
            continue
        padding = " " * max(1, note_column - len(line))
        formatted.append(f"{line}{padding}# {note}")
    return formatted


def should_exclude_ad_hoc(
    rel_path: Path, is_dir: bool, patterns: tuple[str, ...]
) -> bool:
    rel_posix = rel_path.as_posix()
    name = rel_path.name

    for raw_pattern in patterns:
        pattern = raw_pattern.strip()
        if not pattern:
            continue

        dir_only = pattern.endswith("/")
        normalized = pattern[:-1] if dir_only else pattern
        anchored = normalized.startswith("/")
        if anchored:
            normalized = normalized.lstrip("/")
        if not normalized:
            continue
        if dir_only and not is_dir:
            continue

        has_slash = "/" in normalized
        candidates = [rel_posix] if (anchored or has_slash) else [name, rel_posix]
        if any(fnmatch.fnmatchcase(candidate, normalized) for candidate in candidates):
            return True

    return False


def should_include_ad_hoc(
    rel_path: Path, is_dir: bool, patterns: tuple[str, ...]
) -> bool:
    rel_posix = rel_path.as_posix()
    name = rel_path.name

    for raw_pattern in patterns:
        pattern = raw_pattern.strip()
        if not pattern:
            continue

        dir_only = pattern.endswith("/")
        normalized = pattern[:-1] if dir_only else pattern
        anchored = normalized.startswith("/")
        if anchored:
            normalized = normalized.lstrip("/")
        if not normalized:
            continue
        if dir_only and not is_dir:
            continue

        has_slash = "/" in normalized
        candidates = [rel_posix] if (anchored or has_slash) else [name, rel_posix]
        if any(fnmatch.fnmatchcase(candidate, normalized) for candidate in candidates):
            return True

    return False


def _directory_has_included_descendant(
    directory: Path,
    root_path: Path,
    include_patterns: tuple[str, ...],
    max_depth: int | None = None,
) -> bool:
    if max_depth is not None and max_depth <= 0:
        return False

    try:
        children = sorted(
            directory.iterdir(), key=lambda p: (p.is_dir(), p.name.lower(), p.name)
        )
    except OSError:
        return False

    for child in children:
        rel_child = child.relative_to(root_path)
        if should_include_ad_hoc(rel_child, child.is_dir(), include_patterns):
            return True
        next_depth = None if max_depth is None else max_depth - 1
        if child.is_dir() and _directory_has_included_descendant(
            child,
            root_path,
            include_patterns,
            next_depth,
        ):
            return True
    return False


def visible_children(
    path: Path,
    root_path: Path,
    repo_root: Path,
    ignore_config: IgnoreConfig,
    ad_hoc_excludes: tuple[str, ...],
    ad_hoc_includes: tuple[str, ...],
) -> list[Path]:
    children: list[Path] = []
    for child in path.iterdir():
        rel_child = child.relative_to(repo_root)
        rel_child_from_root = child.relative_to(root_path)
        force_include = should_include_ad_hoc(
            rel_child_from_root, child.is_dir(), ad_hoc_includes
        )
        excluded_by_ignore = should_exclude_path(
            rel_child, child.is_dir(), ignore_config
        )
        excluded_by_ad_hoc = should_exclude_ad_hoc(
            rel_child_from_root, child.is_dir(), ad_hoc_excludes
        )

        if (excluded_by_ignore or excluded_by_ad_hoc) and not force_include:
            if child.is_dir() and _directory_has_included_descendant(
                child,
                root_path,
                ad_hoc_includes,
            ):
                children.append(child)
            continue
        children.append(child)
    return sorted(children, key=lambda p: (p.is_dir(), p.name.lower(), p.name))


def build_tree_lines(
    root_path: Path,
    label: str,
    depth: int,
    repo_root: Path,
    ignore_config: IgnoreConfig,
    ad_hoc_excludes: tuple[str, ...],
    ad_hoc_includes: tuple[str, ...],
    annotations: dict[str, str],
) -> tuple[list[str], tuple[str, ...]]:
    rows: list[tuple[str, str | None]] = [(f"{label.rstrip('/')}/", None)]
    used_annotation_keys: set[str] = set()
    root_note, root_key = lookup_annotation(Path("."), True, annotations)
    rows[0] = (rows[0][0], root_note)
    if root_key:
        used_annotation_keys.add(root_key)

    def walk(path: Path, prefix: str, current_depth: int) -> None:
        if current_depth >= depth and not _directory_has_included_descendant(
            path,
            root_path,
            ad_hoc_includes,
        ):
            return

        children = visible_children(
            path,
            root_path,
            repo_root,
            ignore_config,
            ad_hoc_excludes,
            ad_hoc_includes,
        )
        for idx, child in enumerate(children):
            rel_child_from_root = child.relative_to(root_path)
            child_is_included = should_include_ad_hoc(
                rel_child_from_root, child.is_dir(), ad_hoc_includes
            )
            child_has_included_descendant = child.is_dir() and _directory_has_included_descendant(
                child,
                root_path,
                ad_hoc_includes,
            )
            within_depth = current_depth < depth
            if not within_depth and not child_is_included and not child_has_included_descendant:
                continue

            is_last = idx == len(children) - 1
            connector = "└── " if is_last else "├── "
            name = f"{child.name}/" if child.is_dir() else child.name
            note, note_key = lookup_annotation(
                rel_child_from_root, child.is_dir(), annotations
            )
            if note_key:
                used_annotation_keys.add(note_key)
            rows.append((f"{prefix}{connector}{name}", note))

            if child.is_dir() and (
                current_depth + 1 < depth or child_has_included_descendant
            ):
                child_prefix = prefix + ("    " if is_last else "│   ")
                walk(child, child_prefix, current_depth + 1)

    walk(root_path, "", 0)
    unmatched_keys = tuple(
        key for key in sorted(annotations.keys()) if key not in used_annotation_keys
    )
    return format_annotated_lines(rows), unmatched_keys


def render_block(
    repo_root: Path,
    markdown_rel_path: str,
    specs: list[PathRenderSpec],
    ignore_config: IgnoreConfig,
) -> tuple[str, list[AnnotationWarning]]:
    if not specs:
        raise ValueError("project-structure marker requires 'path' attribute")

    lines: list[str] = []
    warnings: list[AnnotationWarning] = []
    annotations_cache: dict[str, AnnotationManifest] = {}
    for idx, spec in enumerate(specs):
        target = repo_root / spec.path
        if not target.exists() or not target.is_dir():
            raise ValueError(f"path does not exist or is not a directory: {spec.path}")

        annotations_key = spec.annotations or ""
        if annotations_key not in annotations_cache:
            annotations_cache[annotations_key] = load_annotations_manifest(
                repo_root, spec.annotations
            )
        resolved_notes = resolve_annotations(
            annotations_cache[annotations_key],
            markdown_rel_path=markdown_rel_path,
            tree_path=spec.path,
            section=spec.section,
        )

        scoped_excludes = list(spec.excludes)
        if spec.annotations:
            annotations_file = repo_root / spec.annotations
            if annotations_file.exists():
                try:
                    rel_annotations = annotations_file.relative_to(target).as_posix()
                except ValueError:
                    rel_annotations = None
                if rel_annotations:
                    scoped_excludes.append(rel_annotations)

        rendered_lines, unmatched_keys = build_tree_lines(
            target,
            spec.path,
            spec.depth,
            repo_root,
            ignore_config,
            tuple(scoped_excludes),
            spec.includes,
            resolved_notes,
        )
        lines.extend(rendered_lines)
        if unmatched_keys and spec.annotations:
            warnings.append(
                AnnotationWarning(
                    spec_path=spec.path,
                    annotations_path=spec.annotations,
                    section=spec.section,
                    unused_keys=unmatched_keys,
                )
            )
        if idx < len(specs) - 1:
            lines.append("")

    return "\n```text\n" + "\n".join(lines) + "\n```\n", warnings


def process_markdown(
    path: Path, repo_root: Path, ignore_config: IgnoreConfig
) -> tuple[bool, str, list[AnnotationWarning]]:
    original = path.read_text(encoding="utf-8")
    annotation_warnings: list[AnnotationWarning] = []
    markdown_rel_path = path.relative_to(repo_root).as_posix()

    def repl(match: re.Match[str]) -> str:
        specs = parse_render_specs(match.group("attrs"))
        if not specs:
            return match.group(0)
        body, warnings = render_block(
            repo_root,
            markdown_rel_path,
            specs,
            ignore_config,
        )
        annotation_warnings.extend(warnings)
        return f"{match.group('begin')}{body}{match.group('end')}"

    updated = BLOCK_RE.sub(repl, original)
    return (updated != original), updated, annotation_warnings


def find_candidate_markdown(repo_root: Path, ignore_config: IgnoreConfig) -> list[Path]:
    return _find_candidate_markdown_scoped(repo_root, ignore_config, scope_paths=None)


def _expand_scope_paths(repo_root: Path, raw_paths: list[str]) -> list[Path]:
    scoped_markdown: set[Path] = set()
    for raw_path in raw_paths:
        raw = raw_path.strip()
        if not raw:
            continue

        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = repo_root / candidate

        try:
            resolved = candidate.resolve()
            resolved.relative_to(repo_root)
        except (FileNotFoundError, ValueError):
            continue

        if resolved.is_dir():
            for markdown in resolved.rglob("*.md"):
                if markdown.is_file():
                    scoped_markdown.add(markdown)
            continue

        if resolved.is_file() and resolved.suffix.lower() == ".md":
            scoped_markdown.add(resolved)

    return sorted(scoped_markdown)


def _find_candidate_markdown_scoped(
    repo_root: Path,
    ignore_config: IgnoreConfig,
    scope_paths: list[str] | None,
) -> list[Path]:
    files: list[Path] = []
    candidates = (
        _expand_scope_paths(repo_root, scope_paths)
        if scope_paths
        else sorted(repo_root.rglob("*.md"))
    )

    for markdown in candidates:
        rel_markdown = markdown.relative_to(repo_root)
        if should_exclude_path(rel_markdown, is_dir=False, ignore_config=ignore_config):
            continue
        if "backlog" in rel_markdown.parts:
            continue
        content = markdown.read_text(encoding="utf-8")
        if BEGIN_RE.search(content):
            files.append(markdown)
    return sorted(files)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync markdown project-structure blocks"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="update files in place")
    mode.add_argument(
        "--check", action="store_true", help="fail if files are out of date"
    )
    parser.add_argument(
        "--failure-threshold",
        choices=("WARN", "ERROR"),
        default="ERROR",
        help="check mode threshold: WARN fails on warnings and errors; ERROR fails on errors only (default)",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="optional markdown files/directories to validate; if omitted, all markdown with structure blocks is scanned",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    ignore_config = build_ignore_config(repo_root)
    changed_paths: list[Path] = []
    warning_records: list[tuple[Path, AnnotationWarning]] = []

    for markdown in _find_candidate_markdown_scoped(
        repo_root, ignore_config, args.paths
    ):
        changed, updated, annotation_warnings = process_markdown(
            markdown, repo_root, ignore_config
        )
        if not changed:
            if annotation_warnings:
                warning_records.extend(
                    (markdown, warning) for warning in annotation_warnings
                )
            continue

        if annotation_warnings:
            warning_records.extend(
                (markdown, warning) for warning in annotation_warnings
            )

        changed_paths.append(markdown)
        if args.write:
            markdown.write_text(updated, encoding="utf-8")

    if args.check and changed_paths:
        print("ERROR: Markdown structure blocks are out of date:", file=sys.stderr)
        for path in changed_paths:
            print(f"  - {path.relative_to(repo_root)}", file=sys.stderr)
        print(
            "Run: python3 scripts/docs/sync_readme_structure.py --write",
            file=sys.stderr,
        )

    if warning_records:
        stream = sys.stderr if args.check else sys.stdout
        print("WARN: Unused annotation entries detected:", file=stream)
        for markdown, warning in warning_records:
            joined_keys = ", ".join(warning.unused_keys)
            section_suffix = f", section={warning.section}" if warning.section else ""
            print(
                "  - "
                f"{markdown.relative_to(repo_root)} "
                f"(path={warning.spec_path}, annotations={warning.annotations_path}{section_suffix}): "
                f"{joined_keys}",
                file=stream,
            )

    if args.check:
        has_errors = bool(changed_paths)
        has_warnings = bool(warning_records)
        if has_errors:
            return 1
        if has_warnings and args.failure_threshold == "WARN":
            return 1
        return 0

    if args.write and changed_paths:
        print("Updated markdown structure blocks:")
        for path in changed_paths:
            print(f"  - {path.relative_to(repo_root)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
