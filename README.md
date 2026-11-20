# Hello Kapil

A React app in [Forme](./Forme) that displays `hellow kapil`.

## Run locally

Use Node.js 22.12 or newer.

```sh
cd Forme
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Validate

```sh
cd Forme
npm test
npm run build
```

## GitHub Actions

The [React workflow](./.github/workflows/react.yml) runs on branch pushes, pull
requests, manual dispatch, and `deploy-*` tag pushes. It prints `hellow kapil`
in the job log, tests the greeting and deployment command, builds the app,
and uploads the production files as the `hello-kapil-dist` artifact.
Only `deploy-*` tags publish to GitHub Pages. Tag builds use the Pages base
path so JavaScript assets load correctly under the repository's site URL.
After a successful deployment, the workflow publishes a GitHub release for
the same tag with automatically generated release notes. GitHub summarizes
merged pull requests and contributors since the previous release; the first
release has no previous-release baseline. Failed deployments do not publish
a release. Only the release job has repository `contents: write` permission.

Commit and push these files to GitHub to trigger the workflow.

## `/deploy` command

The repository slash-command folder is [.github/skills](./.github/skills).
The [deploy skill](./.github/skills/deploy/SKILL.md) exposes `/deploy` in
Copilot Chat, backed by [commands/deploy.sh](./commands/deploy.sh).

Before the first deployment:

1. Commit and push the app, workflow, and command files to `main`.
2. In GitHub repository **Settings > Pages**, set **Source** to **GitHub Actions**.
3. Ensure the `github-pages` environment permits deployment from `deploy-*`
   tags if deployment branch/tag restrictions are enabled.
4. Authenticate Git and GitHub CLI (`gh auth login`) with access to this repo.
   The tagging script also needs Git `user.name` and `user.email` configured
   to create an annotated tag.
5. Start a fresh Copilot Chat session in this workspace, type `/`, and select
   `/deploy`.

The command fetches the latest remote `origin/main`, creates an annotated tag
such as `deploy-20261120-104600-0123456789ab` (UTC timestamp plus commit hash),
and pushes only that tag. GitHub Actions then tests, builds, and deploys that
tagged commit. Local branches and uncommitted changes are not deployed or
automatically committed. Copilot watches the Actions run and reports its result,
the deployed site URL, and the GitHub release notes URL.
GitHub's environment protection rules may require approval before publishing.

You can also trigger the same pipeline from the terminal:

```sh
bash commands/deploy.sh
```

Unlike the Chat command, the script only pushes the tag; it does not watch CI.
If pushing fails, it reports the error and leaves the local tag for inspection.
Never force-push or delete a remote deployment tag to retry a deployment.

### Add more commands

Add `.github/skills/<command-name>/SKILL.md` with YAML frontmatter containing
`name: <command-name>`, a `description`, and `disable-model-invocation: true`
for commands that should run only on explicit invocation. Put supporting scripts
in `commands/` and link them from the skill. No central command registry is needed.
The skill directory and its `name` must match.

Test the tagging command without pushing anything to GitHub:

```sh
node --test commands/deploy.test.mjs
```

These tests create and clean up isolated temporary Git repositories.
