// Select immutable sources before build; this script runs from workflow main, never the selected source.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const REPO = 'jfricano/StreamOtter';
export function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
export function protectedEnvironment(env, policies, name) {
  assert.equal(env.name, name);
  assert.equal(env.can_admins_bypass, false, 'administrator bypass must be disabled');
  const rules = env.protection_rules.filter(rule => rule.type === 'required_reviewers');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].prevent_self_review, false);
  assert.deepEqual(rules[0].reviewers.map(r => [r.type, r.reviewer.login]), [['User', 'jfricano']]);
  assert.deepEqual(env.deployment_branch_policy, { protected_branches: false, custom_branch_policies: true });
  assert.deepEqual(policies.branch_policies.map(p => [p.type, p.name]), [['branch', 'main']]);
}
export function select(app, destination, sha, tag, exec = run) {
  assert.ok(['docs', 'blog'].includes(app));
  assert.ok(['preview', 'production'].includes(destination));
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'approved source must be a full SHA');
  exec('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
  let ref = sha;
  let docsChannel = '';
  if (app === 'docs') {
    assert.ok(tag || destination === 'preview', 'docs production requires a stable release tag');
    docsChannel = tag ? 'release' : 'preview';
    if (!tag) {
      // Earlier main sources cannot honor the approved unreleased-preview policy.
      exec('git', ['show', `${sha}:apps/docs/integrations/release-channel.mjs`]);
    }
    if (tag) {
      assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'docs release builds require a stable tag');
      ref = `refs/tags/${tag}`;
      assert.equal(exec('git', ['rev-parse', `${ref}^{commit}`]), sha, 'tag moved or differs from approved source');
      const pkg = JSON.parse(exec('git', ['show', `${sha}:packages/streamotter/package.json`]));
      assert.equal(`v${pkg.version}`, tag, 'release label must match the source version');
    }
  } else {
    assert.equal(tag, '', 'blog selects a main SHA, not a release tag');
  }
  exec('git', ['show', `${sha}:apps/${app}/package.json`]); // Existing release tags without the app fail here.
  return { sha, ref, docsChannel };
}
export function preflight(app, destination, sha, tag, exec = run) {
  assert.equal(process.env.GITHUB_REPOSITORY, REPO);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.ok(['preview', 'production'].includes(destination));
  const source = select(app, destination, sha, tag, exec);
  const name = `${app}-${destination}`;
  const api = path => JSON.parse(exec('gh', ['api', `repos/${REPO}/${path}`]));
  protectedEnvironment(api(`environments/${name}`), api(`environments/${name}/deployment-branch-policies`), name);
  const runs = api(`actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`).workflow_runs;
  const latest = runs.filter(r => r.head_sha === sha && r.event === 'push' && r.head_branch === 'main')
    .sort((a,b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  assert.ok(latest, 'source needs its own main push CI run');
  assert.equal(latest.status, 'completed');
  assert.equal(latest.conclusion, 'success', 'wait for successful exact-source CI');
  const checks = api(`check-suites/${latest.check_suite_id}/check-runs?filter=latest&per_page=100`).check_runs;
  for (const required of ['Verify (Node 24)', 'Verify (Node 26)', app === 'docs' ? 'Docs site' : 'Blog site']) {
    assert.ok(checks.some(c => c.name === required && c.head_sha === sha && c.app?.slug === 'github-actions' && c.status === 'completed' && c.conclusion === 'success'), `missing green ${required}`);
  }
  return source;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = preflight(process.env.SITE_APP, process.env.DESTINATION, process.env.SOURCE_SHA, process.env.RELEASE_TAG ?? '');
  appendFileSync(process.env.GITHUB_OUTPUT, `sha=${source.sha}\nref=${source.ref}\ndocs_channel=${source.docsChannel}\n`);
}
