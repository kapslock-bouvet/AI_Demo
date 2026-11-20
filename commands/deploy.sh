#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "Usage: bash commands/deploy.sh" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

if ! git fetch --no-tags origin refs/heads/main; then
  echo "Cannot fetch origin/main. Check the remote, access, and whether main has been pushed." >&2
  exit 1
fi

commit="$(git rev-parse 'FETCH_HEAD^{commit}')"
if ! git cat-file -e "$commit:.github/workflows/react.yml"; then
  echo "Commit and push the React workflow to main before deploying." >&2
  exit 1
fi

short_commit="$(git rev-parse --short=12 "$commit")"
tag="deploy-$(date -u +%Y%m%d-%H%M%S)-$short_commit"

git tag -a "$tag" "$commit" -m "Deploy $commit from origin/main"

if ! git push origin "refs/tags/$tag:refs/tags/$tag"; then
  echo "Tag push failed. Local tag $tag remains; check the remote before retrying. No deployment is confirmed." >&2
  exit 1
fi

printf 'Created and pushed tag: %s\nSource commit: %s\n' "$tag" "$commit"
