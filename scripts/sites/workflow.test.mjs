import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the workflow's own shell, including its failure behavior, without running Actions or uploading.
const workflow = readFileSync(new URL('../../.github/workflows/deploy-docs.yml', import.meta.url), 'utf8');
function shellStep(name) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split(/\n      - /)[0];
  assert.ok(step, `missing workflow step ${name}`);
  return step.split('        run: |\n')[1].split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
}
function shell(script, cwd, env) {
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env }
  });
}

test('workflow headers keep one noindex rule for either preview channel and omit it for production', () => {
  const root = mkdtempSync(join(tmpdir(), 'streamotter-site-headers-'));
  try {
    mkdirSync(join(root, 'apps/docs/dist'), { recursive: true });
    for (const [destination, existing, expected] of [
      ['preview', '/*\n  X-Robots-Tag: noindex\n', 1], // Astro unreleased preview already supplied it.
      ['preview', '', 1], // Tagged release build still goes to a noindex Pages preview.
      ['production', '', 0]
    ]) {
      writeFileSync(join(root, 'apps/docs/dist/_headers'), existing);
      const result = shell(shellStep('Add response policy and safe source receipt'), root, {
        DESTINATION: destination, SITE_APP: 'docs', SOURCE_SHA: 'a'.repeat(40), RELEASE_TAG: '', GITHUB_RUN_ID: '123'
      });
      assert.equal(result.status, 0, result.stderr);
      const headers = readFileSync(join(root, 'apps/docs/dist/_headers'), 'utf8');
      assert.equal((headers.match(/X-Robots-Tag: noindex/g) ?? []).length, expected);
      assert.match(headers, /X-Content-Type-Options: nosniff/);
      const receipt = JSON.parse(readFileSync(join(root, 'apps/docs/dist/deployment.json'), 'utf8'));
      assert.equal(receipt.destination, destination);
      assert.equal(receipt.source, 'a'.repeat(40));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('workflow refuses a tag checkout that moved after selection before setting the build channel', () => {
  const root = mkdtempSync(join(tmpdir(), 'streamotter-site-race-'));
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(root, 'fixture'), 'original');
    git(['add', '.']); git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'approved']);
    const approved = git(['rev-parse', 'HEAD']); git(['tag', 'v1.0.0']);
    writeFileSync(join(root, 'fixture'), 'changed');
    git(['add', '.']); git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'unapproved']);
    git(['tag', '--force', 'v1.0.0']); git(['checkout', '--detach', 'refs/tags/v1.0.0']);
    const environmentFile = join(root, 'github-env'); writeFileSync(environmentFile, '');
    const env = { SOURCE_SHA: approved, DOCS_CHANNEL: 'release', GITHUB_ENV: environmentFile };
    const refused = shell(shellStep('Verify selected checkout and set docs channel'), root, env);
    assert.notEqual(refused.status, 0);
    assert.equal(readFileSync(environmentFile, 'utf8'), '');
    git(['checkout', '--detach', approved]);
    const accepted = shell(shellStep('Verify selected checkout and set docs channel'), root, env);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(readFileSync(environmentFile, 'utf8'), 'DOCS_CHANNEL=release\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
