#!/usr/bin/env python3
"""Auto-resolve PR review threads that are covered by a commit and tests.

Conservative policy implemented:
- Only attempt to resolve threads for which the PR head's lightweight checks
   are green.
- Require either: (A) a tests/ file was added/modified in the PR, or
    (B) an explicit marker `FixesReviewThread: <thread-id>` appears in the PR body or commit messages.

This script is intended to be run from a GitHub Action. It uses the
`GITHUB_PR_AUTORESOLVE_TOKEN` secret for GraphQL requests.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except Exception:  # pragma: no cover - tests may not have requests installed
    requests = None

GITHUB_API = "https://api.github.com"
GITHUB_GRAPHQL = "https://api.github.com/graphql"


def _repo_owner_name(repo: str) -> Tuple[str, str]:
    owner, name = repo.split("/", 1)
    return owner, name


def _get_headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        # Use the stable GitHub API media type
        "Accept": "application/vnd.github+json",
    }


# Use `requests.post` directly; tests are updated to provide a requests-like stub.


def combined_status(repo: str, sha: str, token: str) -> str:
    """
    Return combined status for a commit considering both Check Runs (modern API) and legacy commit statuses.

    - First, consult the Checks API for all check runs on the commit.
        - If any check run is failing, timed out, cancelled, or action required, return "failure".
        - If any check run is pending or has no conclusion, return "pending".
        - If all check runs are successful or neutral, return "success".
        - If the Checks API is unavailable or returns no runs, fall back to the legacy combined status endpoint.
    - The legacy status endpoint is used for older workflows and returns "success", "pending", or "failure".

    This ensures threads are only auto-resolved when all required checks have passed, matching conservative policy.
    """
    owner, name = _repo_owner_name(repo)
    # First, consult the Checks API for check runs
    checks_url = f"{GITHUB_API}/repos/{owner}/{name}/commits/{sha}/check-runs"
    if requests is None:
        raise RuntimeError("requests library is required for combined_status")
    try:
        r = requests.get(checks_url, headers=_get_headers(token))
        if r.status_code == 200:
            data = r.json()
            runs = data.get("check_runs", [])
            if runs:
                # If any run is not completed, treat as pending
                for run in runs:
                    if run.get("status") != "completed":
                        print(
                            f"Checks API: run pending: {run.get('name')} ({run.get('status')})"
                        )
                        return "pending"

                # Collect conclusions and classify outcomes
                conclusions = [run.get("conclusion") for run in runs]
                failing = {"failure", "timed_out", "cancelled", "action_required"}

                # Any explicit failing conclusion -> failure
                if any(c in failing for c in conclusions if c is not None):
                    print("Checks API: one or more check runs failed")
                    return "failure"

                # If any conclusion is None (unexpected), treat as pending
                if any(c is None for c in conclusions):
                    print("Checks API: some check runs have no conclusion yet; treating as pending")
                    return "pending"

                # Special-case: all conclusions are 'neutral' — treat as success but log
                if all(c == "neutral" for c in conclusions):
                    print("Checks API: all check runs concluded 'neutral'; treating as success")
                    return "success"

                # Otherwise, treat as success (includes 'success' and mixed 'success'/'neutral')
                print(f"Checks API: {len(runs)} runs all passed/neutral")
                return "success"
        else:
            print(
                f"Checks API returned status {r.status_code}; falling back to legacy status"
            )
    except Exception as exc:
        print(f"WARN: failed to consult Checks API: {exc}")

    # Fallback: legacy combined status endpoint
    url = f"{GITHUB_API}/repos/{owner}/{name}/commits/{sha}/status"
    r2 = requests.get(url, headers=_get_headers(token))
    r2.raise_for_status()
    return r2.json().get("state", "")


def pr_files(repo: str, pr: int, token: str) -> List[str]:
    owner, name = _repo_owner_name(repo)
    url = f"{GITHUB_API}/repos/{owner}/{name}/pulls/{pr}/files"
    files: List[str] = []
    page = 1
    while True:
        r = requests.get(
            url, headers=_get_headers(token), params={"page": page, "per_page": 100}
        )
        r.raise_for_status()
        data = r.json()
        if not data:
            break
        files.extend([f["filename"] for f in data])
        page += 1
    return files


def pr_body_and_commits(repo: str, pr: int, token: str) -> Tuple[str, List[str]]:
    owner, name = _repo_owner_name(repo)
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{name}/pulls/{pr}", headers=_get_headers(token)
    )
    r.raise_for_status()
    pr_body = r.json().get("body") or ""

    # commits
    commits: List[str] = []
    page = 1
    while True:
        r = requests.get(
            f"{GITHUB_API}/repos/{owner}/{name}/pulls/{pr}/commits",
            headers=_get_headers(token),
            params={"page": page, "per_page": 100},
        )
        r.raise_for_status()
        data = r.json()
        if not data:
            break
        commits.extend([c.get("commit", {}).get("message", "") for c in data])
        page += 1
    return pr_body, commits


def graphql_query(
    repo: str, query: str, variables: Dict[str, Any], token: str
) -> Dict[str, Any]:
    headers = _get_headers(token)
    r = requests.post(
        GITHUB_GRAPHQL, json={"query": query, "variables": variables}, headers=headers
    )
    r.raise_for_status()
    result = r.json()
    if "errors" in result:
        raise RuntimeError(json.dumps(result["errors"]))
    return result["data"]


def list_review_threads(repo: str, pr: int, token: str) -> List[Dict[str, Any]]:
    owner, name = _repo_owner_name(repo)
    query = """
    query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
                                            reviewThreads(first: 100) {
                                                nodes {
                                                        id
                                                        isResolved
                                                        isOutdated
                                                        path
                                                        start { line }
                                                        # Request comment line fields when available; prefer
                                                        # `line` or `originalLine` (file-line numbers) before
                                                        # falling back to `position` (patch index).
                                                        comments(first: 10) { nodes { databaseId line originalLine position } }
                                                }
                                        }
        }
      }
    }
    """
    vars: Dict[str, str | int] = {"owner": owner, "name": name, "number": pr}
    data = graphql_query(repo, query, vars, token)
    nodes = data["repository"]["pullRequest"]["reviewThreads"]["nodes"]
    # Normalize nodes: prefer `start.line` when present. Otherwise, look for
    # a file-line on comments (`line` or `originalLine`) and fall back to the
    # patch `position` index. We prefer the first comment that contains a
    # usable value to keep behavior deterministic.
    for n in nodes:
        start_line = None
        if n.get("start") and n.get("start", {}).get("line") is not None:
            start_line = n["start"]["line"]
        else:
            comments = n.get("comments", {}).get("nodes", [])
            for c in comments:
                # Prefer file-line values
                if c.get("line") is not None:
                    start_line = c.get("line")
                    break
                if c.get("originalLine") is not None:
                    start_line = c.get("originalLine")
                    break
                if c.get("position") is not None:
                    start_line = c.get("position")
                    break
        if start_line is not None:
            n.setdefault("start", {})["line"] = start_line
    return nodes


def post_thread_reply(
    repo: str, pr: int, in_reply_to: int, body: str, token: str
) -> None:
    """Post a reply to a pull request review comment (thread-level reply) using REST API.

    `in_reply_to` should be the numeric comment id (databaseId).
    """
    if requests is None:
        raise RuntimeError("requests library is required to post thread replies")
    owner, name = _repo_owner_name(repo)
    url = f"{GITHUB_API}/repos/{owner}/{name}/pulls/{pr}/comments"
    payload: Dict[str, str | int] = {"body": body, "in_reply_to": in_reply_to}
    r = requests.post(url, headers=_get_headers(token), json=payload)
    r.raise_for_status()


def mark_thread_resolved(repo: str, thread_id: str, token: str) -> None:
    query = """
    mutation($threadId: ID!) {
      markPullRequestReviewThreadResolved(input: {threadId: $threadId}) {
        clientMutationId
      }
    }
    """
    graphql_query(repo, query, {"threadId": thread_id}, token)


def post_pr_comment(repo: str, pr: int, body: str, token: str) -> None:
    owner, name = _repo_owner_name(repo)
    url = f"{GITHUB_API}/repos/{owner}/{name}/issues/{pr}/comments"
    r = requests.post(url, headers=_get_headers(token), json={"body": body})
    r.raise_for_status()


def git_fetch_base(base_ref: str) -> None:
    # Fetch base ref so diffs against it work locally
    proc = subprocess.run(
        ["git", "fetch", "origin", f"{base_ref}:{base_ref}"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(f"git fetch failed (ref={base_ref}):", proc.stdout, proc.stderr)
        raise RuntimeError("git fetch failed")


def parse_unified_diff_hunks(diff_text: str) -> Dict[str, List[Tuple[int, int]]]:
    # Returns mapping file -> list of (start_line, end_line) for new-file ranges (+c,d)
    result: Dict[str, List[Tuple[int, int]]] = {}
    cur_file: Optional[str] = None
    for line in diff_text.splitlines():
        if line.startswith("+++"):
            # +++ b/path or +++ /dev/null
            parts = line.split()
            if len(parts) >= 2:
                path = parts[1]
                if path.startswith("b/"):
                    cur_file = path[2:]
                else:
                    cur_file = path
                result.setdefault(cur_file, [])
        elif line.startswith("@@"):
            # @@ -a,b +c,d @@
            m = re.search(r"\+([0-9]+)(?:,([0-9]+))?", line)
            if m and cur_file is not None:
                start = int(m.group(1))
                length = 1
                if m.group(2) is not None:
                    length = int(m.group(2))
                # In unified diff, "+start,0" indicates an insertion point with no added lines.
                # For this function (ranges of added lines), skip zero-length hunks.
                if length == 0:
                    continue
                end = start + length - 1
                result[cur_file].append((start, end))
    return result


def main() -> int:
    repo = os.environ.get("REPOSITORY") or os.environ.get("GITHUB_REPOSITORY")
    pr = int(os.environ.get("PR_NUMBER", "0"))
    head_sha = os.environ.get("HEAD_SHA")
    base_ref = os.environ.get("BASE_REF")
    token = os.environ.get("GITHUB_PR_AUTORESOLVE_TOKEN")

    if not all([repo, pr, head_sha, base_ref, token]):
        print(
            "Missing required env vars (REPOSITORY, PR_NUMBER, HEAD_SHA, BASE_REF, GITHUB_PR_AUTORESOLVE_TOKEN)"
        )
        return 1

    # 1) check combined status
    state = combined_status(repo, head_sha, token)
    print(f"Commit {head_sha} combined status: {state}")
    if state != "success":
        print("Checks are not green; skipping auto-resolve")
        return 0

    # 2) list PR files and detect test changes
    files = pr_files(repo, pr, token)
    has_test_changes = any(f.startswith("tests/") for f in files)
    print(f"PR files: {len(files)}; test changes: {has_test_changes}")

    # 3) read PR body and commits for explicit markers
    pr_body, commit_messages = pr_body_and_commits(repo, pr, token)
    explicit_markers: List[str] = []
    marker_re = re.compile(r"FixesReviewThread:\s*([A-Za-z0-9:\/\-_.]+)")
    for m in marker_re.finditer(pr_body):
        explicit_markers.append(m.group(1))
    for msg in commit_messages:
        for m in marker_re.finditer(msg):
            explicit_markers.append(m.group(1))

    # 4) fetch base and compute diff hunks
    git_fetch_base(base_ref)
    # produce diff between base_ref and head_sha
    diff_cmd = ["git", "diff", "--unified=0", f"{base_ref}...{head_sha}"]
    diff = subprocess.run(diff_cmd, capture_output=True, text=True)
    if diff.returncode != 0:
        print("git diff failed:", diff.stdout, diff.stderr)
        raise RuntimeError("git diff failed")
    hunks = parse_unified_diff_hunks(diff.stdout)

    # 5) list review threads
    try:
        threads = list_review_threads(repo, pr, token)
    except Exception as e:
        print("Failed to list review threads:", e)
        return 1

    resolved: List[str] = []
    skipped: List[str] = []
    would_resolve: List[Dict[str, Any]] = []

    for t in threads:
        tid = t.get("id")
        is_resolved = t.get("isResolved")
        path = t.get("path")
        start = None
        try:
            if t.get("start"):
                start_val = t.get("start", {}).get("line")
                if start_val is not None:
                    start = int(start_val)
        except Exception as e:
            print(f"Warning: Failed to parse thread start line for thread {tid}: {e}")
            start = None

        if not tid or is_resolved:
            skipped.append(tid or "<no-id>")
            continue

        # Note: Threads without a numeric `start` line (file-level comments
        # or otherwise unspecified positions) are intentionally not
        # auto-resolved. We cannot reliably determine whether the PR's
        # changes addressed a file-level comment, so skip them and record
        # them as skipped. This mirrors the conservative policy documented
        # in the module docstring. If you want to explicitly resolve file-level
        # threads, use a commit message or PR body marker: FixesReviewThread:<thread_id>
        if start is None:
            skipped.append(tid or "<no-id>")
            continue

        # match to hunks
        # Ensure path and start are valid before using them with hunks dict and numeric comparisons
        if path is None:
            path_hunks: List[Tuple[int, int]] = []
        else:
            path_hunks = hunks.get(path, [])
        hit = False
        if start is not None:
            for s, e in path_hunks:
                if s <= start <= e:
                    hit = True
                    break

        # candidate if hit
        candidate = hit

        # apply heuristics: require test changes OR explicit marker
        # Require either the full thread id or an explicit suffix match (the part
        # after the final underscore). This reduces accidental substring matches.
        def _extract_thread_suffix(thread_id: str) -> str:
            # Extract just the suffix after the last underscore for comparison
            return thread_id.split("_")[-1] if "_" in thread_id else thread_id

        marker_present = any(
            (str(tid) == mid) or (_extract_thread_suffix(str(tid)) == mid)
            for mid in explicit_markers
        )
        if candidate and (has_test_changes or marker_present):
            try:
                reason = (
                    "tests"
                    if has_test_changes
                    else "marker"
                    if marker_present
                    else "unknown"
                )
                if os.environ.get("DRY_RUN", "0") == "1":
                    info: dict[str, Any] = {
                        "id": tid,
                        "path": path,
                        "line": start,
                        "reason": reason,
                    }
                    would_resolve.append(info)
                    print(
                        f"DRY RUN: would resolve {tid} @ {path}:{start} (reason: {reason})"
                    )
                else:
                    # Post a per-thread PR comment indicating the thread is being resolved
                    comment_body = f"Auto-resolve: addressing review thread {tid} at {path}:{start} in commit {head_sha}."
                    # Prefer posting a thread-level reply if we can find a comment id
                    try:
                        comments = t.get("comments", {}).get("nodes", [])
                        if comments:
                            # Prefer replying to the last comment in the thread so the
                            # audit message appears at the most recent position in the
                            # conversation. Fall back to PR-level comment if no
                            # databaseId is available.
                            last_dbid = None
                            for c in reversed(comments):
                                dbid = c.get("databaseId")
                                if dbid:
                                    last_dbid = dbid
                                    break
                            if last_dbid:
                                post_thread_reply(
                                    repo, pr, last_dbid, comment_body, token
                                )
                            else:
                                post_pr_comment(repo, pr, comment_body, token)
                        else:
                            post_pr_comment(repo, pr, comment_body, token)
                    except Exception as e:
                        print(
                            f"Warning: failed to post thread-level reply for {tid}: {e}"
                        )
                        # fallback to PR-level comment
                        try:
                            post_pr_comment(repo, pr, comment_body, token)
                        except Exception as e2:
                            print(
                                f"Warning: failed to post per-thread comment for {tid}: {e2}"
                            )
                    # Mark the thread resolved via GraphQL
                    mark_thread_resolved(repo, tid, token)
                    resolved.append(tid)
            except Exception as e:
                print(f"Failed to resolve {tid}: {e}")
        else:
            skipped.append(tid)

    # 6) post audit comment
    if os.environ.get("DRY_RUN", "0") == "1":
        if would_resolve:
            print("DRY RUN summary: the following threads would be resolved:")
            for w in would_resolve:
                print(json.dumps(w))
        else:
            print("DRY RUN summary: no threads would be resolved")

    if resolved:
        body = (
            "Auto-resolve report:\n\n"
            + f"Resolved threads: {json.dumps(resolved, indent=2)}\n\n"
            + f"Skipped threads: {json.dumps(skipped, indent=2)}\n\n"
            + f"Commit: {head_sha}\n"
            + f"Tests changed: {has_test_changes}\n"
        )
        try:
            post_pr_comment(repo, pr, body, token)
        except Exception as e:
            print("Failed to post audit comment:", e)

    print(f"Done. Resolved: {len(resolved)}; Skipped: {len(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
