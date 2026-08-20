#!/usr/bin/env python3
"""Helpers to generate GitHub App JWT and request an installation token.

Usage patterns:
  - Create a JWT with your App private key and APP_ID
  - List installations to find the installation id for `squirrel289/temple`
  - Create an installation access token and print it

This script is intended to be run locally or inside CI (as a step that
creates an installation token for the workflow). It requires `pyjwt` and
`requests`.

Example:
  pip install pyjwt requests
  python scripts/ci/github_app_helpers.py --app-id 12345 --private-key private-key.pem --list-installations
  python scripts/ci/github_app_helpers.py --app-id 12345 --private-key private-key.pem --installation 67890

"""

from __future__ import annotations

import sys

import argparse
import time
from typing import Any

try:
    import jwt
except Exception:  # pragma: no cover - tests may not have jwt installed
    jwt = None

try:
    import requests
except Exception:  # pragma: no cover - tests may not have requests installed
    requests = None

GITHUB_API = "https://api.github.com"


def create_jwt(app_id: str, private_key_path: str) -> str:
    with open(private_key_path, "r") as f:
        private_key = f.read()
    now = int(time.time())
    # GitHub accepts either the numeric Application ID or the client ID (a string)
    # for the `iss` claim. Prefer converting to int when possible, otherwise
    # use the provided string (client id) as-is.
    try:
        iss_val = int(app_id)
    except Exception:
        iss_val = app_id
    payload = {"iat": now - 60, "exp": now + (10 * 60), "iss": iss_val}
    token = jwt.encode(payload, private_key, algorithm="RS256")
    if isinstance(token, bytes):
        token = token.decode()
    return token


def list_installations(jwt_token: str) -> Any:
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github+json",
    }
    r = requests.get(f"{GITHUB_API}/app/installations", headers=headers)
    r.raise_for_status()
    return r.json()


def get_installation_for_repo(jwt_token: str, owner: str, repo: str) -> Any:
    """Return installation id for a specific repository, or None if not installed."""
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github+json",
    }
    r = requests.get(f"{GITHUB_API}/repos/{owner}/{repo}/installation", headers=headers)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json().get("id")


def create_installation_token(jwt_token: str, installation_id: str) -> str:
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github+json",
    }
    r = requests.post(
        f"{GITHUB_API}/app/installations/{installation_id}/access_tokens",
        headers=headers,
    )
    r.raise_for_status()
    return r.json()["token"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--app-id", required=True, help="GitHub App ID")
    p.add_argument(
        "--private-key", required=True, help="Path to App private key PEM file"
    )
    p.add_argument(
        "--list-installations",
        action="store_true",
        help="List installations for this app",
    )
    p.add_argument(
        "--repo", help="Owner/repo to find installation for (e.g. squirrel289/temple)"
    )
    p.add_argument(
        "--installation", help="Installation ID to create an access token for"
    )
    args = p.parse_args()

    jwt_token = create_jwt(args.app_id, args.private_key)

    if args.list_installations:
        installs = list_installations(jwt_token)
        print("Installations:")
        for i in installs:
            print(
                f"- id: {i.get('id')} account: {i.get('account', {}).get('login')} repository_selection: {i.get('repository_selection')}"
            )
        return 0

    if args.repo:
        # Prefer the repository-installation lookup which returns the exact installation
        owner_repo = args.repo.split("/", 1)
        if len(owner_repo) != 2:
            print("Invalid repo format; expected owner/repo", file=sys.stderr)
            return 2
        owner, repo_name = owner_repo
        inst_id = get_installation_for_repo(jwt_token, owner, repo_name)
        if inst_id is None:
            # fall back to listing installations and matching account login
            installs = list_installations(jwt_token)
            for i in installs:
                acc = i.get("account", {}) or {}
                if acc.get("login") == owner:
                    print(i.get("id"))
                    return 0
            # not found
            return 2
        print(inst_id)
        return 0

    if args.installation:
        token = create_installation_token(jwt_token, args.installation)
        print(token)
        return 0

    print("Run with --list-installations or --installation <id>")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
