import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { select, protectedEnvironment } from './select.mjs';

test('release without docs is rejected; a matching tagged main source is accepted; moved tag and off-main SHA are refused', () => {
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
    writeFileSync(join(root,'packages/streamotter/package.json'),'{"version":"0.2.0-rc.1"}');
    exec('git',['add','.']); exec('git',['commit','-m','release before docs']);
    const old=exec('git',['rev-parse','HEAD']);
    exec('git',['tag','v0.2.0-rc.1']); exec('git',['update-ref','refs/remotes/origin/main',old]);
    assert.throws(()=>select('docs',old,'v0.2.0-rc.1',exec));
    mkdirSync(join(root,'apps/docs'),{recursive:true});
    mkdirSync(join(root,'apps/blog'),{recursive:true});
    writeFileSync(join(root,'apps/docs/package.json'),'{}');
    writeFileSync(join(root,'apps/blog/package.json'),'{}');
    writeFileSync(join(root,'packages/streamotter/package.json'),'{"version":"0.2.0-rc.2"}');
    exec('git',['add','.']); exec('git',['commit','-m','new release with docs']);
    const sha=exec('git',['rev-parse','HEAD']);
    exec('git',['tag','v0.2.0-rc.2']); exec('git',['update-ref','refs/remotes/origin/main',sha]);
    assert.equal(select('docs',sha,'v0.2.0-rc.2',exec),sha);
    assert.equal(select('blog',sha,'',exec),sha);
    assert.throws(()=>select('docs',sha,'v0.2.0-rc.1',exec));
    exec('git',['update-ref','refs/remotes/origin/main',old]);
    assert.throws(()=>select('blog',sha,'',exec));
    assert.throws(()=>select('blog','main','',exec));
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
