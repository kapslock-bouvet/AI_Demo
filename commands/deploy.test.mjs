import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./deploy.sh', import.meta.url));
const workflow = fileURLToPath(new URL('../.github/workflows/react.yml', import.meta.url));

function repository(t, { withWorkflow = true, pushMain = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hello-kapil-deploy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = path.join(directory, 'remote.git');
  const work = path.join(directory, 'work');
  const git = (...args) => execFileSync('git', args, {
    cwd: work,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  mkdirSync(work);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Deployment Test');
  git('config', 'user.email', 'deployment-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('remote', 'add', 'origin', remote);
  writeFileSync(path.join(work, 'app.txt'), 'main\n');
  if (withWorkflow) {
    mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
    copyFileSync(workflow, path.join(work, '.github', 'workflows', 'react.yml'));
  }
  git('add', '.');
  git('commit', '-m', 'Initial main');
  if (pushMain) {
    git('push', 'origin', 'main');
  }
  const bin = path.join(directory, 'bin');
  const calls = path.join(directory, 'gh-calls.txt');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = auth ] && [ "$2" = status ]; then
  exit "\${GH_TEST_AUTH_STATUS:-0}"
fi
if [ "$1" = workflow ] && [ "$2" = run ]; then
  printf '%s\\n' "$@" > "$GH_TEST_CALLS"
  git ls-remote --exit-code --tags origin "refs/tags/$5" >/dev/null
  tag_commit="$(git rev-parse "$5^{commit}")"
  prod_commit="$(git ls-remote --heads origin refs/heads/Prod | cut -f1)"
  [ "$tag_commit" = "$prod_commit" ]
  exit "\${GH_TEST_DISPATCH_STATUS:-0}"
fi
echo "Unexpected gh command" >&2
exit 1
`, { mode: 0o755 });
  const runDeploy = (extraEnv = {}) => spawnSync('bash', [script], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GH_TEST_CALLS: calls,
      GH_TEST_AUTH_STATUS: '0',
      GH_TEST_DISPATCH_STATUS: '0',
      ...extraEnv,
    },
  });
  return { git, runDeploy, calls, work };
}

test('checks out Prod from remote main, pushes it, then tags and dispatches', (t) => {
  const { work, git, runDeploy, calls } = repository(t);
  const main = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'feature');
  writeFileSync(path.join(work, 'app.txt'), 'feature\n');
  git('commit', '-am', 'Local feature');
  const feature = git('rev-parse', 'HEAD');

  const result = runDeploy();
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;
  const tag = output.match(/Created and pushed tag: ([1-9][0-9]*\.0)/)?.[1];
  assert.equal(tag, '1.0', output);
  assert.equal(git('cat-file', '-t', `refs/tags/${tag}`), 'tag');
  assert.equal(git('rev-parse', `${tag}^{commit}`), main);
  assert.match(git('ls-remote', 'origin', `refs/tags/${tag}^{}`), new RegExp(`^${main}\\s`));
  assert.equal(git('rev-parse', 'HEAD'), main);
  assert.equal(git('rev-parse', 'feature'), feature);
  assert.equal(git('branch', '--show-current'), 'Prod');
  assert.equal(git('rev-parse', 'main'), main);
  assert.equal(git('status', '--short'), '');
  assert.match(git('ls-remote', '--heads', 'origin', 'refs/heads/Prod'), new RegExp(`^${main}\\s`));
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    'workflow', 'run', 'react.yml', '--ref', tag,
  ]);
  assert.match(output, /Dispatched workflow: react\.yml/);
  assert.match(output, /Source branch: Prod/);
});

test('fast-forwards existing local and remote Prod to the latest remote main', (t) => {
  const { work, git, runDeploy } = repository(t);
  git('branch', 'Prod');
  git('push', 'origin', 'Prod');
  writeFileSync(path.join(work, 'app.txt'), 'updated main\n');
  git('commit', '-am', 'Update main');
  const main = git('rev-parse', 'HEAD');
  git('push', 'origin', 'main');

  const result = runDeploy();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('rev-parse', 'Prod'), main);
  assert.equal(git('rev-parse', '1.0^{commit}'), main);
  assert.match(git('ls-remote', '--heads', 'origin', 'refs/heads/Prod'), new RegExp(`^${main}\\s`));
});

for (const remote of [false, true]) {
  test(`stops before switching or tagging when ${remote ? 'remote' : 'local'} Prod diverges`, (t) => {
    const { work, git, runDeploy } = repository(t);
    git('switch', '-c', 'Prod');
    writeFileSync(path.join(work, 'app.txt'), 'production-only commit\n');
    git('commit', '-am', 'Change Prod only');
    const prod = git('rev-parse', 'HEAD');
    if (remote) {
      git('push', 'origin', 'Prod');
    }
    git('switch', 'main');
    if (remote) {
      git('branch', '-m', 'Prod', 'remote-only-fixture');
    }

    const result = runDeploy();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Prod has commits outside origin\/main/);
    assert.equal(git('branch', '--show-current'), 'main');
    assert.equal(git('tag', '--list'), '');
    assert.equal(git('ls-remote', '--tags', 'origin'), '');
    if (remote) {
      assert.match(git('ls-remote', '--heads', 'origin', 'refs/heads/Prod'), new RegExp(`^${prod}\\s`));
    } else {
      assert.equal(git('rev-parse', 'Prod'), prod);
    }
  });
}

test('stops without switching, tagging, or discarding worktree changes', (t) => {
  const { work, git, runDeploy } = repository(t);
  writeFileSync(path.join(work, 'app.txt'), 'staged change\n');
  git('add', 'app.txt');
  writeFileSync(path.join(work, 'untracked.txt'), 'untracked change\n');
  const status = git('status', '--short');

  const result = runDeploy();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A clean worktree is required/);
  assert.equal(git('status', '--short'), status);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--heads', 'origin', 'refs/heads/Prod'), '');
});

test('increments successive deployments as 1.0, 2.0, and 3.0', (t) => {
  const { runDeploy, git } = repository(t);

  for (const tag of ['1.0', '2.0', '3.0']) {
    const result = runDeploy();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`Created and pushed tag: ${tag}\n`));
    assert.match(git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), /refs\/tags\//);
  }
});

test('increments the highest numeric remote version and ignores other tags', (t) => {
  const { runDeploy, git } = repository(t);
  for (const tag of ['2.0', '9.0', '10.0', 'deploy-old', 'v99.0', '01.0', '0.0', '99.1']) {
    git('tag', tag);
    git('push', 'origin', `refs/tags/${tag}`);
  }
  git('tag', '999.0');

  const result = runDeploy();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created and pushed tag: 11\.0\n/);
  assert.equal(git('ls-remote', '--tags', 'origin', 'refs/tags/999.0'), '');
});

test('does not tag when origin/main is missing', (t) => {
  const { git, runDeploy } = repository(t, { pushMain: false });

  const result = runDeploy();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot fetch origin\/main/);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test('does not tag when the workflow has not been pushed to main', (t) => {
  const { git, runDeploy } = repository(t, { withWorkflow: false });

  const result = runDeploy();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /push the React workflow to main/);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test('does not tag when GitHub authentication fails', (t) => {
  const { git, runDeploy } = repository(t);

  const result = runDeploy({ GH_TEST_AUTH_STATUS: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gh auth login/);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test('reports dispatch failure and keeps the pushed tag for retry', (t) => {
  const { git, runDeploy, calls } = repository(t);

  const result = runDeploy({ GH_TEST_DISPATCH_STATUS: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /workflow dispatch failed/);
  assert.doesNotMatch(result.stdout, /Dispatched workflow/);
  const tag = git('tag', '--list');
  assert.ok(tag);
  assert.match(git('ls-remote', '--tags', 'origin'), new RegExp(`refs/tags/${tag}`));
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    'workflow', 'run', 'react.yml', '--ref', tag,
  ]);
  assert.ok(result.stderr.includes(`gh workflow run react.yml --ref ${tag}`));
});
