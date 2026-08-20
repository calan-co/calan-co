#!/usr/bin/env python3
"""Compare detect-secrets scan JSON with baseline and emit status.

Defaults preserve existing behaviour (read `detect_secrets_curr.json`, write
`detect_secrets_status.txt` and `secrets-report.json`).

Added CLI options:
  --curr PATH       : path to current scan JSON (use '-' to read from stdin)
  --base PATH       : path to baseline (default: .secrets.baseline)
  --status-out PATH : path to write status (default: detect_secrets_status.txt)
  --no-write        : do not write files; print single-word status to stdout
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parents[2]


def load_json_path(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def load_json_file_like(f) -> Dict[str, Any]:
    try:
        return json.load(f)
    except Exception:
        return {}


def build_hashes(b: Dict[str, Any]):
    res = {}
    for fn, findings in b.get("results", {}).items():
        res[fn] = set(
            [f.get("hashed_secret") for f in findings if "hashed_secret" in f]
        )
    return res


def should_ignore(fn: str, f: Dict[str, Any], ignore_patterns) -> bool:
    for pat in ignore_patterns:
        if pat in fn or pat in (f.get("type", "") or ""):
            return True
    return False


def compare(curr: Dict[str, Any], base: Dict[str, Any], ignore_patterns):
    base_hashes = build_hashes(base)
    new = []
    for fn, findings in curr.get("results", {}).items():
        if fn not in base_hashes:
            filtered = [
                f for f in findings if not should_ignore(fn, f, ignore_patterns)
            ]
            if filtered:
                new.append({"file": fn, "count": len(filtered)})
        else:
            seen = base_hashes[fn]
            for f in findings:
                if should_ignore(fn, f, ignore_patterns):
                    continue
                if f.get("hashed_secret") not in seen:
                    new.append(
                        {
                            "file": fn,
                            "type": f.get("type"),
                            "line": f.get("line_number"),
                        }
                    )
    return new


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description="Compare detect-secrets scan JSON with baseline"
    )
    p.add_argument("--curr", type=str, default=str(ROOT / "detect_secrets_curr.json"))
    p.add_argument("--base", type=str, default=str(ROOT / ".secrets.baseline"))
    p.add_argument(
        "--status-out", type=str, default=str(ROOT / "detect_secrets_status.txt")
    )
    p.add_argument(
        "--no-write",
        action="store_true",
        help="Do not write files; print status to stdout",
    )
    p.add_argument(
        "--scan",
        action="store_true",
        help="Run detect-secrets scan in-process (avoids shelling out)",
    )
    p.add_argument(
        "--scan-args",
        nargs="*",
        help="Extra arguments to pass to detect-secrets scan (when using --scan)",
    )
    args = p.parse_args(argv)

    ignore_patterns = []
    ignore_file = ROOT / ".detect-secrets-ignore"
    if ignore_file.exists():
        for line in ignore_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                ignore_patterns.append(line)

    base_path = Path(args.base)
    if not base_path.exists():
        if args.no_write:
            print("no_baseline")
            return 0
        else:
            print("No .secrets.baseline found")
            Path(args.status_out).write_text("no_baseline")
            return 0

    # If requested, run detect-secrets scan in-process and capture JSON output
    curr = {}
    if args.scan:
        try:
            import runpy
            import io
            import contextlib

            scan_args = ["detect_secrets", "scan"]
            if args.scan_args:
                scan_args.extend(args.scan_args)

            # Run the detect-secrets module as __main__ in-process, capturing stdout
            buf = io.StringIO()
            old_argv = sys.argv
            try:
                sys.argv = scan_args
                with contextlib.redirect_stdout(buf):
                    runpy.run_module("detect_secrets", run_name="__main__")
            finally:
                sys.argv = old_argv

            out = buf.getvalue()
            try:
                curr = json.loads(out)
            except Exception:
                curr = {}
        except Exception:
            # Fall back to reading provided --curr input (file or stdin)
            curr = {}
            if args.curr == "-":
                curr = load_json_file_like(sys.stdin)
            else:
                curr_path = Path(args.curr)
                curr = load_json_path(curr_path) if curr_path.exists() else {}
    else:
        if args.curr == "-":
            curr = load_json_file_like(sys.stdin)
        else:
            curr_path = Path(args.curr)
            curr = load_json_path(curr_path) if curr_path.exists() else {}

    base = load_json_path(base_path)

    new = compare(curr, base, ignore_patterns)

    if args.no_write:
        if new:
            print("new")
            print(json.dumps(new))
        else:
            print("ok")
        return 0

    status_path = Path(args.status_out)
    if new:
        print("New secrets found:")
        print(new)
        (ROOT / "secrets-report.json").write_text(json.dumps(new))
        status_path.write_text("new")
    else:
        print("No new secrets found")
        status_path.write_text("ok")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
