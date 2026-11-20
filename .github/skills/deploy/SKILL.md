---
name: deploy
description: Tag remote main and start GitHub Actions to test, build, deploy this React app to GitHub Pages, and publish a GitHub release with generated notes. Use when the user invokes /deploy.
disable-model-invocation: true
---

# Deploy

Run this command only when explicitly invoked by the user. Do not commit local
changes, push a branch, or change GitHub settings automatically.

1. Work from the repository root. Read [the deployment script](../../../commands/deploy.sh)
   and [the workflow](../../workflows/react.yml).
2. Check `gh auth status` and determine the repository with
   `gh repo view --json nameWithOwner --jq .nameWithOwner`.
   Check `gh api repos/OWNER/REPO/pages --jq .build_type`, replacing OWNER/REPO
   with that repository. It must return `workflow`. If Pages is not configured,
   stop and explain that Settings > Pages > Source must be set to GitHub Actions.
   Surface authentication, permission, and network failures without tagging.
3. Fetch `origin/main` with `git fetch --no-tags origin refs/heads/main` and
   inspect `git show FETCH_HEAD:.github/workflows/react.yml`. Verify that this
   remote workflow triggers on `deploy-*` tag pushes, deploys to Pages, and
   publishes a release with generated notes only after deployment succeeds.
   If not, stop and ask the user to commit and push these command/workflow files
   to `main` first. Explain that this deploys the latest remote `origin/main`,
   not the current branch or uncommitted changes.
   Run `bash commands/deploy.sh` exactly once.
   If it fails, stop and report the error; do not create another tag or force-push.
4. Use the tag printed by the script to find its Actions run:
   `gh run list --workflow react.yml --branch TAG --event push --limit 1 --json databaseId,url,status,conclusion`.
   If the run has not appeared, retry this lookup at most five times, waiting
   three seconds between lookups. Never rerun the tagging script to find a run.
5. When a run is found, watch it with `gh run watch RUN_ID --exit-status`.
   Report the tag, source commit, Actions URL, and result. Only claim successful
   deployment after the entire run succeeds; then retrieve the site URL using
   `gh api repos/OWNER/REPO/pages --jq .html_url`.
   Retrieve and report the release notes URL with
   `gh release view TAG --json url --jq .url`.
   The workflow creates the release; do not create a second release in Chat.
   If no run appears, report that the tag was pushed but CI has not been verified.
   If the run fails, report its failure and link to the run. Distinguish a failed
   deployment from a failed release-notes job after successful deployment.
