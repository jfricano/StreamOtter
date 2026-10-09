import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease } from '../../apps/docs/integrations/release-channel.mjs';
import { spawnSync } from 'node:child_process';
import { select, protectedEnvironment } from './select.mjs';

test('docs previews and stable releases select exact main sources; missing apps, prereleases, moved tags and off-main sources are refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'streamotter-site-source-'));
  const exec = (cmd,args) => {
    const r = spawnSync(cmd,args,{ cwd:root,encoding:'utf8' });
    assert.equal(r.status,0,r.stderr);
    return r.stdout.trim();
  };
  try {
    exec('git',['init','-b','main']);
    exec('git',['config','user.email','test@example.invalid']);
    exec('git',['config','user.name','Test']);
    mkdirSync(join(root,'packages/streamotter'),{recursive:true});
    writeFileSync(join(root,'packages/streamotter/package.json'),'{"version":"0.1.0"}');
    exec('git',['add','.']); exec('git',['-c','commit.gpgsign=false','commit','-m','release before docs']);
    const old=exec('git',['rev-parse','HEAD']);
    exec('git',['tag','v0.1.0']); exec('git',['update-ref','refs/remotes/origin/main',old]);
    assert.throws(()=>select('docs','production',old,'v0.1.0',exec));
    mkdirSync(join(root,'apps/docs'),{recursive:true});
    mkdirSync(join(root,'apps/blog'),{recursive:true});
    writeFileSync(join(root,'apps/docs/package.json'),'{}');
    writeFileSync(join(root,'apps/blog/package.json'),'{}');
    writeFileSync(join(root,'packages/streamotter/package.json'),'{"version":"1.0.0"}');
    exec('git',['add','.']); exec('git',['-c','commit.gpgsign=false','commit','-m','new release with docs']);
    const prePolicy=exec('git',['rev-parse','HEAD']);
    exec('git',['update-ref','refs/remotes/origin/main',prePolicy]);
    assert.throws(()=>select('docs','preview',prePolicy,'',exec));
    mkdirSync(join(root,'apps/docs/integrations'),{recursive:true});
    writeFileSync(join(root,'apps/docs/integrations/release-channel.mjs'),'// preview policy fixture');
    exec('git',['add','.']); exec('git',['-c','commit.gpgsign=false','commit','-m','approved preview policy']);
    const sha=exec('git',['rev-parse','HEAD']);
    exec('git',['tag','v1.0.0']); exec('git',['update-ref','refs/remotes/origin/main',sha]);
    const release = select('docs','production',sha,'v1.0.0',exec);
    assert.deepEqual(release,{sha,ref:'refs/tags/v1.0.0',docsChannel:'release'});
    assert.deepEqual(select('docs','preview',sha,'v1.0.0',exec),release);
    assert.deepEqual(select('docs','preview',sha,'',exec),{sha,ref:sha,docsChannel:'preview'});
    assert.throws(()=>select('docs','production',sha,'',exec),/requires a stable release tag/);
    assert.throws(()=>select('docs','preview',sha,'v1.0.0-rc.1',exec),/require a stable tag/);
    exec('git',['tag','v1.0.1']);
    assert.throws(()=>select('docs','production',sha,'v1.0.1',exec),/must match the source version/);
    // A fresh checkout of the returned ref must retain the tag at HEAD for Astro's release guard.
    exec('git',['clone','--no-checkout',root,join(root,'checkout')]);
    const checked = (cmd,args) => {
      const r=spawnSync(cmd,args,{cwd:join(root,'checkout'),encoding:'utf8'});
      assert.equal(r.status,0,r.stderr); return r.stdout.trim();
    };
    checked('git',['checkout','--detach',release.ref]);
    assert.equal(checked('git',['rev-parse','HEAD']),sha);
    checkRelease('1.0.0',checked('git',['tag','--points-at','HEAD']).split('\n'));
    assert.deepEqual(select('blog','production',sha,'',exec),{sha,ref:sha,docsChannel:''});
    assert.throws(()=>select('docs','preview',sha,'v0.1.0',exec));
    exec('git',['tag','--force','v1.0.0',old]);
    assert.throws(()=>select('docs','production',sha,'v1.0.0',exec),/tag moved/);
    exec('git',['update-ref','refs/remotes/origin/main',old]);
    assert.throws(()=>select('docs','preview',sha,'',exec));
    assert.throws(()=>select('blog','production',sha,'',exec));
    assert.throws(()=>select('blog','preview','main','',exec));
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('deployment refuses a missing owner gate, admin bypass, tag allowance or self-review deadlock', () => {
  const env={name:'blog-production',can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{login:'jfricano'}}]}],deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}};
  const policies={branch_policies:[{type:'branch',name:'main'}]};
  protectedEnvironment(env,policies,'blog-production');
  assert.throws(()=>protectedEnvironment({...env,can_admins_bypass:true},policies,'blog-production'));
  assert.throws(()=>protectedEnvironment({...env,protection_rules:[]},policies,'blog-production'));
  assert.throws(()=>protectedEnvironment(env,{branch_policies:[{type:'tag',name:'*'}]},'blog-production'));
  const deadlock=structuredClone(env); deadlock.protection_rules[0].prevent_self_review=true;
  assert.throws(()=>protectedEnvironment(deadlock,policies,'blog-production'));
});

test('preflight returns the channel/ref only after exact-source CI and the owner gate pass', async () => {
  const { preflight, REPO } = await import('./select.mjs');
  const saved = { GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF: process.env.GITHUB_REF, GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME };
  Object.assign(process.env, { GITHUB_REPOSITORY: REPO, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' });
  const sha = 'a'.repeat(40);
  let conclusion = 'success';
  let checkSha = sha;
  const exec = (cmd, args) => {
    if (cmd === 'git') return '{}'; // Untagged fixture: ancestry and app presence passed.
    const path = args[1];
    const name = 'docs-preview';
    if (path.endsWith('/deployment-branch-policies')) return JSON.stringify({ branch_policies: [{ type: 'branch', name: 'main' }] });
    if (path.endsWith(`/environments/${name}`)) return JSON.stringify({ name, can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'jfricano' } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
    if (path.includes('/actions/workflows/ci.yml/runs')) return JSON.stringify({ workflow_runs: [{ head_sha: sha, event: 'push', head_branch: 'main', run_number: 1, run_attempt: 1, status: 'completed', conclusion, check_suite_id: 123 }] });
    if (path.includes('/check-suites/123/check-runs')) return JSON.stringify({ check_runs: ['Verify (Node 24)', 'Verify (Node 26)', 'Docs site'].map(name => ({ name, head_sha: checkSha, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' })) });
    assert.fail(`unexpected command ${cmd} ${args.join(' ')}`);
  };
  try {
    assert.deepEqual(preflight('docs', 'preview', sha, '', exec), { sha, ref: sha, docsChannel: 'preview' });
    conclusion = 'failure';
    assert.throws(() => preflight('docs', 'preview', sha, '', exec), /successful exact-source CI/);
    conclusion = 'success'; checkSha = 'b'.repeat(40);
    assert.throws(() => preflight('docs', 'preview', sha, '', exec), /missing green/);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
