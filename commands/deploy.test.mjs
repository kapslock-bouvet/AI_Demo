import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  return { work, git };
}

test('pushes an annotated tag for remote main, not local branch or changes', (t) => {
  const { work, git } = repository(t);
  const main = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'feature');
  writeFileSync(path.join(work, 'app.txt'), 'feature\n');
  git('commit', '-am', 'Local feature');
  const feature = git('rev-parse', 'HEAD');
  writeFileSync(path.join(work, 'app.txt'), 'uncommitted\n');

  const output = execFileSync('bash', [script], { cwd: work, encoding: 'utf8' });
  const tag = output.match(/Created and pushed tag: (deploy-\d{8}-\d{6}-[a-f0-9]+)/)?.[1];
  assert.ok(tag, output);
  assert.equal(git('cat-file', '-t', `refs/tags/${tag}`), 'tag');
  assert.equal(git('rev-parse', `${tag}^{commit}`), main);
  assert.match(git('ls-remote', 'origin', `refs/tags/${tag}^{}`), new RegExp(`^${main}\\s`));
  assert.equal(git('rev-parse', 'HEAD'), feature);
  assert.equal(git('branch', '--show-current'), 'feature');
  assert.match(git('status', '--short'), /app\.txt/);
});

test('does not tag when origin/main is missing', (t) => {
  const { work, git } = repository(t, { pushMain: false });

  const result = spawnSync('bash', [script], { cwd: work, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot fetch origin\/main/);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test('does not tag when the workflow has not been pushed to main', (t) => {
  const { work, git } = repository(t, { withWorkflow: false });

  const result = spawnSync('bash', [script], { cwd: work, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /push the React workflow to main/);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});
