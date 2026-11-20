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

The [React workflow](./.github/workflows/react.yml) runs only by explicit
manual dispatch. Branch pushes, tag pushes, and pull requests do not start it.
It prints `hellow kapil`
in the job log, tests the greeting and deployment command, builds the app,
and uploads the production files as the `hello-kapil-dist` artifact.
Only positive integer release tags (`1.0`, `2.0`, `3.0`, etc.) publish to GitHub
Pages. Other refs fail validation before building. Tag builds use the Pages base
path so JavaScript assets load correctly under the repository's site URL.
After a successful deployment, the workflow publishes a GitHub release for
the same tag with automatically generated release notes. GitHub summarizes
merged pull requests and contributors since the previous release; the first
release has no previous-release baseline. Failed deployments do not publish
a release. Only the release job has repository `contents: write` permission.

Commit and push these files to `main`, then invoke `/deploy` to start the workflow.

## `/deploy` command

The repository slash-command folder is [.github/skills](./.github/skills).
The [deploy skill](./.github/skills/deploy/SKILL.md) exposes `/deploy` in
Copilot Chat, backed by [commands/deploy.sh](./commands/deploy.sh).

Before the first deployment:

1. Commit and push the app, workflow, and command files to `main`.
2. In GitHub repository **Settings > Pages**, set **Source** to **GitHub Actions**.
3. Ensure the `github-pages` environment permits deployment from `*.0`
   tags if deployment branch/tag restrictions are enabled. The workflow also
   validates the exact numeric tag format.
4. Authenticate Git and GitHub CLI (`gh auth login`) with access to this repo.
   The tagging script also needs Node.js and Git `user.name` and `user.email`
   configured to create an annotated tag.
5. Start a fresh Copilot Chat session in this workspace, type `/`, and select
   `/deploy`.

The command fetches the latest remote `origin/main` and reads the tags on
`origin`. It creates `1.0` if there are no matching release tags, otherwise
increments the highest numeric major version: `1.0`, `2.0`, `3.0`, and so on.
It ignores timestamp tags and other formats, including `v1.0` and `1.1`.
Existing tags are not renamed or overwritten. Every new tag reserves its number,
even if that deployment later fails; retry dispatch for the same tag rather than
creating a new tag when retrying a failed release.

The command creates an annotated tag and pushes only that tag. It then explicitly
starts the workflow with
`gh workflow run react.yml --ref TAG`. GitHub Actions tests, builds, and deploys
that tagged commit. Local branches and uncommitted changes are not deployed or
automatically committed. Copilot watches the Actions run and reports its result,
the deployed site URL, and the GitHub release notes URL.
GitHub's environment protection rules may require approval before publishing.

You can also trigger the same pipeline from the terminal:

```sh
bash commands/deploy.sh
```

Unlike the Chat command, the script pushes the tag and dispatches the workflow
but does not watch CI.
If pushing fails, it reports the error and leaves the local tag for inspection.
If dispatch fails after the tag was pushed, it reports the error and prints
the dispatch command to retry for that same tag; do not create another tag.
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

These tests create and clean up isolated temporary Git repositories and mock
GitHub CLI; they do not call GitHub or start a real deployment.
