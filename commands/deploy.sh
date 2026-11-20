#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "Usage: bash commands/deploy.sh" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

if ! command -v gh >/dev/null; then
  echo "GitHub CLI (gh) is required to start the deployment workflow." >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "Node.js is required to calculate the next deployment version." >&2
  exit 1
fi

if ! gh auth status; then
  echo "Authenticate GitHub CLI with gh auth login before deploying." >&2
  exit 1
fi

status="$(git status --porcelain)"
if [ -n "$status" ]; then
  echo "A clean worktree is required to switch to Prod. Commit or stash your changes before deploying." >&2
  exit 1
fi

if ! git fetch --no-tags origin refs/heads/main; then
  echo "Cannot fetch origin/main. Check the remote, access, and whether main has been pushed." >&2
  exit 1
fi

commit="$(git rev-parse 'FETCH_HEAD^{commit}')"
if ! git cat-file -e "$commit:.github/workflows/react.yml"; then
  echo "Commit and push the React workflow to main before deploying." >&2
  exit 1
fi

remote_prod="$(git ls-remote --heads origin refs/heads/Prod)"
if [ -n "$remote_prod" ]; then
  if ! git fetch --no-tags origin refs/heads/Prod; then
    echo "Cannot fetch origin/Prod. No deployment is confirmed." >&2
    exit 1
  fi
  remote_prod="$(git rev-parse 'FETCH_HEAD^{commit}')"
  if ! git merge-base --is-ancestor "$remote_prod" "$commit"; then
    echo "origin/Prod has commits outside origin/main. Resolve the divergence before deploying." >&2
    exit 1
  fi
fi

if git show-ref --verify --quiet refs/heads/Prod; then
  if ! git merge-base --is-ancestor refs/heads/Prod "$commit"; then
    echo "Local Prod has commits outside origin/main. Resolve the divergence before deploying." >&2
    exit 1
  fi
  git switch Prod
else
  git switch --create Prod "$commit"
fi

git merge --ff-only "$commit"
commit="$(git rev-parse 'refs/heads/Prod^{commit}')"

if ! git push --set-upstream origin refs/heads/Prod:refs/heads/Prod; then
  echo "Cannot push Prod. No release tag was created; resolve the branch push failure before deploying." >&2
  exit 1
fi

tag="$(git ls-remote --tags --refs origin | node --input-type=module -e '
import { readFileSync } from "node:fs";

let latest = 0n;
for (const line of readFileSync(0, "utf8").split("\n")) {
  const match = line.match(/\trefs\/tags\/([1-9][0-9]*)\.0$/);
  if (match) {
    const major = BigInt(match[1]);
    if (major > latest) latest = major;
  }
}
console.log(`${latest + 1n}.0`);
')"

git tag -a "$tag" "$commit" -m "Deploy $commit from Prod"

if ! git push origin "refs/tags/$tag:refs/tags/$tag"; then
  echo "Tag push failed. Local tag $tag remains; check the remote before retrying. No deployment is confirmed." >&2
  exit 1
fi

printf 'Created and pushed tag: %s\nSource branch: Prod\nSource commit: %s\n' "$tag" "$commit"

if ! gh workflow run react.yml --ref "$tag"; then
  echo "Tag $tag was pushed, but workflow dispatch failed. No deployment is confirmed." >&2
  echo "Retry the dispatch with: gh workflow run react.yml --ref $tag" >&2
  exit 1
fi

printf 'Dispatched workflow: react.yml\n'
