# CI helpers for review-resolution bot

This document describes how to create a GitHub App for the auto-resolve
script, how to add required repository secrets, and how to run a dry-run
locally and in CI.

Secrets expected by the workflow (either set of names is accepted):

- `REVIEW_RESOLUTION_BOT_APP_KEY` — the App private key PEM (preferred name you used)
- `REVIEW_RESOLUTION_BOT_APP_ID` — the numeric App ID

or

- `TEMPLE_APP_PRIVATE_KEY` — App private key PEM
- `TEMPLE_APP_ID` — App ID

The workflow will prefer the `REVIEW_RESOLUTION_BOT_*` secrets if both sets exist.

## Create the GitHub App (brief)

1. Go to GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
2. Set:
   - App name: `temple-auto-resolve`
   - Homepage URL: `https://github.com/squirrel289/temple`
   - Permissions:
     - Pull requests: Write
     - Issues: Write
     - Checks: Read
     - Repository contents: Read (optional)
3. Create the App, then **Install** it on the `squirrel289/temple` repository.
4. On the App page, generate a private key and download the PEM.
5. Copy the App ID value.

## Add repository secrets

In the repository: Settings → Secrets and variables → Actions → New repository secret

- Name: `REVIEW_RESOLUTION_BOT_APP_KEY` — Value: paste the full `private-key.pem` contents.
- Name: `REVIEW_RESOLUTION_BOT_APP_ID` — Value: the numeric App ID

## Local dry-run

Install dependencies in a virtualenv and run the script in dry-run mode:

```bash
python -m venv .sandbox-venv
source .sandbox-venv/bin/activate
pip install -r scripts/ci/requirements.txt

# write private key to file
cat > private-key.pem <<'PEM'
<paste the PEM contents here>
PEM

export REPOSITORY="squirrel289/temple"
export PR_NUMBER=4
export HEAD_SHA="<head-sha-from-pr>"
export BASE_REF="main"
export DRY_RUN=1

# Get installation id (requires App created and accessible)
python scripts/ci/github_app_helpers.py --app-id <APP_ID> --private-key private-key.pem --list-installations
# or lookup installation id for the repo
python scripts/ci/github_app_helpers.py --app-id <APP_ID> --private-key private-key.pem --repo squirrel289/temple

# create an installation token (replace <installation_id> with the value printed above)
export GITHUB_PR_AUTORESOLVE_TOKEN=$(python scripts/ci/github_app_helpers.py --app-id <APP_ID> --private-key private-key.pem --installation <installation_id>)

python scripts/ci/auto_resolve_reviews.py
```

## Trigger dry-run in GitHub Actions

- Push any change to the PR branch (e.g. `git commit --allow-empty -m "trigger auto-resolve dry-run" && git push`) to trigger the workflow.
- Or in the Actions UI open the workflow run for this PR and click "Re-run jobs".

## Notes
- The workflow uses short‑lived App installation tokens created at runtime; no long‑lived PAT is required.
- Keep the `DRY_RUN` variable set to `1` until you confirm behavior.

## Thread-reply behavior

When `auto_resolve_reviews.py` posts evidence that a review thread is being resolved it prefers a thread-level reply (so the reply appears inline in the review thread). The script attempts to read the review thread's `comments.nodes[].databaseId` value returned by the GraphQL `reviewThreads` query and calls the REST `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` endpoint with an `in_reply_to` payload. If a thread-level reply cannot be posted (missing ids or API error), the script falls back to publishing a PR-level comment.

### Required permissions

- GitHub App: `pull_requests: write` (required to post review comments and to call `markPullRequestReviewThreadResolved`).
- GitHub App: `issues: write` (optional/fallback for PR-level comments).

If you use a personal access token instead of a GitHub App, ensure it has the equivalent `repo`/`public_repo` scopes and write access to pull request comments.
