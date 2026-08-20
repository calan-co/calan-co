#!/usr/bin/env python3
"""
scripts/ci/sim_asv_env.py

Small helper to simulate ASV's repository / build_dir resolution and report
whether the resolved path appears installable (has setup.py or pyproject.toml).

Usage:
  python scripts/ci/sim_asv_env.py --working-dir temple --output report.json

This is intentionally lightweight and prints both human-readable and JSON
results so it can be used in CI debug runs or locally during development.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Any


def inspect_path(p: Path) -> Dict[str, Any]:
    return {
        "path": str(p),
        "exists": p.exists(),
        "is_dir": p.is_dir(),
        "setup.py": (p / "setup.py").exists(),
        "pyproject.toml": (p / "pyproject.toml").exists(),
        "listing": sorted([x.name for x in p.iterdir()])
        if p.exists() and p.is_dir()
        else None,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--working-dir",
        default="temple",
        help="ASV working-directory (relative to repo root)",
    )
    p.add_argument(
        "--repo-field",
        default=None,
        help="Override the ASV 'repo' field (if not set in conf)",
    )
    p.add_argument(
        "--json", dest="json_out", help="Write full JSON report to this path"
    )
    args = p.parse_args()

    repo_root = Path.cwd()
    working_dir = (repo_root / args.working_dir).resolve()

    report: Dict[str, Any] = {}
    report["repo_root"] = inspect_path(repo_root)
    report["working_dir"] = inspect_path(working_dir)

    # Try to read ASV config from working_dir/asv.conf.json
    conf_path = working_dir / "asv.conf.json"
    conf = None
    if conf_path.exists():
        try:
            conf = json.loads(conf_path.read_text())
            report["asv_conf"] = {
                "path": str(conf_path),
                "content_keys": list(conf.keys()),
            }
        except Exception as e:
            report["asv_conf_error"] = str(e)
    else:
        report["asv_conf"] = {"path": str(conf_path), "found": False}

    # Determine repo field
    repo_field = args.repo_field
    if not repo_field and isinstance(conf, dict):
        repo_field = conf.get("repo")

    report["repo_field"] = repo_field

    # Common candidate resolutions to simulate what ASV might try
    candidates = {}

    # 1) Resolve repo relative to working_dir
    if repo_field:
        try:
            resolved = (working_dir / repo_field).resolve()
            candidates["resolved_from_working_dir"] = inspect_path(resolved)
        except Exception as e:
            candidates["resolved_from_working_dir_error"] = str(e)

    # 2) Resolve repo as parent of working_dir (common when repo == '..')
    parent = working_dir.parent.resolve()
    candidates["parent_of_working_dir"] = inspect_path(parent)

    # 3) Resolve repo as repo_root (in-case workflow cloned at repo root)
    candidates["repo_root"] = inspect_path(repo_root)

    # 4) Simulate nested checkout: repo checked out under <repo_root>/<repo_name>/
    nested = repo_root / repo_root.name
    candidates["nested_checkout"] = inspect_path(nested)
    if repo_field:
        nested_resolved = nested / args.working_dir
        candidates["nested_working"] = inspect_path(nested_resolved)
        try:
            nested_repo = (nested_resolved / repo_field).resolve()
            candidates["nested_resolved_repo"] = inspect_path(nested_repo)
        except Exception as e:
            # Record resolution errors for diagnostics instead of silently ignoring
            candidates["nested_resolved_repo_error"] = str(e)

    report["candidates"] = candidates

    # Summary heuristics
    def is_installable(info: Dict[str, Any]) -> bool:
        return bool(info.get("setup.py") or info.get("pyproject.toml"))

    summary = {}
    for k, v in candidates.items():
        if isinstance(v, dict):
            summary[k] = {"exists": v["exists"], "installable": is_installable(v)}
    report["summary"] = summary

    # Print human readable output
    print("ASV install simulation report")
    print(
        "Repo root:",
        report["repo_root"]["path"],
        "exists=",
        report["repo_root"]["exists"],
    )
    print(
        "Working dir:",
        report["working_dir"]["path"],
        "exists=",
        report["working_dir"]["exists"],
    )
    if repo_field:
        print("ASV repo field:", repo_field)
    else:
        print("ASV repo field: <not set in conf or overridden>")

    print("\nCandidate resolutions:")
    for name, info in candidates.items():
        if not isinstance(info, dict):
            print(f" - {name}: {info}")
            continue
        print(
            f" - {name}: exists={info['exists']}, setup.py={info['setup.py']}, pyproject={info['pyproject.toml']}"
        )

    print("\nSummary (installable?):")
    for name, s in summary.items():
        print(f" - {name}: exists={s['exists']}, installable={s['installable']}")

    # Optionally write JSON
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2))
        print(f"\nWrote JSON report to {args.json_out}")

    # Exit code: 0 if any candidate appears installable, else 2
    any_installable = any(v.get("installable") for v in summary.values())
    return 0 if any_installable else 2


if __name__ == "__main__":
    raise SystemExit(main())
