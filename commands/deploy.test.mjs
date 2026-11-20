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

test('tags remote main, then dispatches that tag without deploying local changes', (t) => {
  const { work, git, runDeploy, calls } = repository(t);
  const main = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'feature');
  writeFileSync(path.join(work, 'app.txt'), 'feature\n');
  git('commit', '-am', 'Local feature');
  const feature = git('rev-parse', 'HEAD');
  writeFileSync(path.join(work, 'app.txt'), 'uncommitted\n');

  const result = runDeploy();
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;
  const tag = output.match(/Created and pushed tag: ([1-9][0-9]*\.0)/)?.[1];
  assert.equal(tag, '1.0', output);
  assert.equal(git('cat-file', '-t', `refs/tags/${tag}`), 'tag');
  assert.equal(git('rev-parse', `${tag}^{commit}`), main);
  assert.match(git('ls-remote', 'origin', `refs/tags/${tag}^{}`), new RegExp(`^${main}\\s`));
  assert.equal(git('rev-parse', 'HEAD'), feature);
  assert.equal(git('branch', '--show-current'), 'feature');
  assert.match(git('status', '--short'), /app\.txt/);
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    'workflow', 'run', 'react.yml', '--ref', tag,
  ]);
  assert.match(output, /Dispatched workflow: react\.yml/);
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
