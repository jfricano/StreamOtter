import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PACKAGES, REPOSITORY, selection, environmentProtected, releaseCI, select, validatePacked, inventory, publish, verify, waitForVersion, registryVersion, loadManifest, run } from './release.mjs';
const chosen = { schema: 1, repository: REPOSITORY, sourceSha: 'a'.repeat(40), ...selection('v0.2.0-rc.1', 'latest') };
const m = { ...chosen, packages: PACKAGES.map(([name], index) => ({ name, version: chosen.version, file: `package-${index}.tgz`, integrity: `sha512-test${index}` })) };
const matching = p => ({ name: p.name, version: p.version, dist: { integrity: p.integrity } });
const lookup = async name => matching(m.packages.find(p => p.name === name));
const retry = { attempts: 3, pause: async () => {} };
// Mirrors the official REST response's shape; notably no can_admins_bypass field.
const environment = { id: 1, node_id: 'MDExOkVudmlyb25tZW50MQ==', name: 'npm-release', url: 'https://api.github.com/repos/jfricano/StreamOtter/environments/npm-release', html_url: 'https://github.com/jfricano/StreamOtter/deployments/activity_log?environments_filter=npm-release', created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z', protection_rules: [{ id: 1, type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'jfricano', id: 1 } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
const policies = { total_count: 1, branch_policies: [{ id: 1, name: 'main', type: 'branch' }] };

test('release selection accepts explicit RC tags; stable is latest only', () => {
  assert.equal(selection('v1.2.3-rc.1', 'next').version, '1.2.3-rc.1');
  assert.equal(selection('v1.2.3', 'latest').distTag, 'latest');
  assert.throws(() => selection('v1.2.3', 'next'));
  for (const tag of ['main', '--help', 'v01.2.3', 'v1.2.3-rc.01', 'v1.2.3;touch /tmp/attack', 'v1.2.3$(echo x)', 'v1.2.3\nfoo', 'refs/tags/v1.2.3']) assert.throws(() => selection(tag, 'latest'));
  for (const tag of ['latest;echo x', '--otp=123', 'canary', 'latest\n']) assert.throws(() => selection('v1.2.3-rc.1', tag));
});
test('environment fixture without nonexistent bypass property passes; missing/weakened protection fails', () => {
  environmentProtected(environment, policies);
  environmentProtected({...environment,can_admins_bypass:false}, policies);
  assert.throws(() => environmentProtected({...environment,can_admins_bypass:true},policies));
  for (const change of [e => e.name = 'other', e => e.protection_rules = [], e => e.protection_rules[0].prevent_self_review = true, e => e.protection_rules[0].reviewers[0].reviewer.login = 'other', e => e.protection_rules[0].reviewers.push({type:'User',reviewer:{login:'other'}}), e => e.deployment_branch_policy = null]) {
    const e = structuredClone(environment); change(e); assert.throws(() => environmentProtected(e, policies));
  }
  assert.throws(() => environmentProtected(environment, {branch_policies: [{name: '*', type: 'branch'}]}));
});
test('bad release input does not even invoke git; selected source must be main ancestor and same six versions', () => {
  const commands = [];
  assert.throws(() => select('.', 'v1.2.3;whoami', 'latest', (...args) => commands.push(args)));
  assert.equal(commands.length, 0);
  const fake = (cmd, args) => {
    commands.push([cmd, args]);
    if (args[0] === 'rev-parse') return chosen.sourceSha;
    if (args[0] === 'show') return JSON.stringify({name: PACKAGES.find(([,p]) => args[1].endsWith(`${p}/package.json`))[0], version: chosen.version});
    return '';
  };
  assert.deepEqual(select('.', chosen.tag, chosen.distTag, fake), chosen);
  assert.ok(commands.some(([cmd,args]) => cmd === 'git' && args.join(' ') === `merge-base --is-ancestor ${chosen.sourceSha} origin/main`));
  assert.throws(() => select('.', chosen.tag, chosen.distTag, (cmd,args) => args[0] === 'show' ? JSON.stringify({name:'@streamotter/contracts',version:'0.1.0-rc.3'}) : fake(cmd,args)));
});
test('pack validation rejects leaked workspace dependencies, wrong exports, version and sensitive filenames', () => {
  const pkg = { name:'@streamotter/client', version:chosen.version, repository:{url:'git+https://github.com/jfricano/StreamOtter.git'}, exports:{'.':'./dist/index.js'}, dependencies:{'@streamotter/contracts': chosen.version} };
  const source = { ...pkg, publishConfig:{exports:pkg.exports} };
  const entries=['package/package.json','package/README.md','package/LICENSE','package/dist/index.js'];
  validatePacked(pkg,source,chosen.version,entries);
  for (const edit of [p => p.dependencies['@streamotter/contracts']='workspace:*', p => p.dependencies['@streamotter/contracts']='^'+chosen.version, p => p.version='0.1.0', p => p.exports={'.':{'streamotter-source':'./src/index.ts'}}]) { const p=structuredClone(pkg);edit(p);assert.throws(()=>validatePacked(p,source,chosen.version,entries)); }
  for (const file of ['package/../outside','../outside','package/.npmrc','package/.env.production','package/key.pem']) assert.throws(()=>validatePacked(pkg,source,chosen.version,[...entries,file]));
});
test('full inventory detects late mismatch before ANY publication', async () => {
  const commands=[];
  await assert.rejects(publish(m,'.', async name => name === 'streamotter' ? {name,version:chosen.version,dist:{integrity:'sha512-wrong'}} : null, (...args)=>commands.push(args),retry));
  assert.equal(commands.length,0);
  await assert.rejects(inventory(m,async name => ({...await lookup(name),deprecated:'broken'})));
});
test('partial release resumes only absent versions with exact argv, no dist-tag mutation', async () => {
  const records=new Map(m.packages.slice(0,2).map(p=>[p.name,matching(p)]));
  const commands=[];
  await publish(m,'.',async name=>records.get(name)??null,(cmd,args)=>{
    commands.push([cmd,args]);
    const p=m.packages.find(p=>args[1] === resolve(p.file));
    assert.ok(p);records.set(p.name,matching(p));return '';
  },retry);
  assert.equal(commands.length,4);
  for (const [cmd,args] of commands) {
    assert.equal(cmd,'npm');assert.deepEqual(args.slice(2),['--access','public','--tag','latest','--provenance','--ignore-scripts','--registry','https://registry.npmjs.org/']);
    assert.equal(args[0],'publish');
  }
});
test('ambiguous failed publish stops after one call, never retries publish blindly', async () => {
  let calls=0;
  await assert.rejects(publish(m,'.',async()=>null,()=>{calls++;throw Error('connection closed after upload');},retry));
  assert.equal(calls,1);
});
test('bounded propagation waits only for 404; matching arrives, mismatch and timeout fail', async () => {
  let count=0,pauses=0;
  const p=m.packages[0];
  await waitForVersion(p,async()=>++count<3?null:matching(p),{attempts:3,pause:async()=>pauses++});
  assert.equal(pauses,2);
  await assert.rejects(waitForVersion(p,async()=>null,retry),/timed out/);
  let mismatches=0;
  await assert.rejects(waitForVersion(p,async()=>{mismatches++;return {name:p.name,version:p.version,dist:{integrity:'bad'}};},retry));
  assert.equal(mismatches,1);
});
test('registry errors are not treated as missing packages', async () => {
  assert.equal(await registryVersion(m.packages[0].name,chosen.version,async()=>({status:404,ok:false})),null);
  await assert.rejects(registryVersion(m.packages[0].name,chosen.version,async()=>({status:503,ok:false})));
  await assert.rejects(registryVersion('malicious',chosen.version,async()=>assert.fail('must not fetch')));
});
test('final verification refuses changed dist-tag', async () => {
  await verify(m,lookup,async()=>({ok:true,json:async()=>({latest:chosen.version})}));
  await assert.rejects(verify(m,lookup,async()=>({ok:true,json:async()=>({latest:'0.1.0-rc.3'})})));
});
test('real archives: manifest package identity/hash/SRI/path tampering is rejected', () => {
  const work=mkdtempSync(join(tmpdir(),'publishing-test-'));
  try {
    const artifact=join(work,'artifacts');mkdirSync(artifact);
    const packed=[];
    for (let i=0;i<PACKAGES.length;i++) {
      const name=PACKAGES[i][0],stage=join(work,`s${i}`);mkdirSync(join(stage,'package'),{recursive:true});
      writeFileSync(join(stage,'package/package.json'),JSON.stringify({name,version:chosen.version}));
      const file=`package-${i}.tgz`;run('tar',['-czf',join(artifact,file),'-C',stage,'package']);
      const bytes=readFileSync(join(artifact,file));
      packed.push({name,version:chosen.version,file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')});
    }
    const manifest={...chosen,packages:packed};
    const save=v=>writeFileSync(join(artifact,'manifest.json'),JSON.stringify(v));save(manifest);
    assert.equal(loadManifest(artifact,chosen).packages.length,6);
    for (const edit of [v=>v.sourceSha='bad',v=>v.packages[0].sha256='bad',v=>v.packages[0].integrity='sha512-bad',v=>v.packages[0].file='../evil.tgz',v=>v.packages[0].name='other',v=>v.packages[0].size=0,v=>v.packages[0].version='1.0.0']) {const v=structuredClone(manifest);edit(v);save(v);assert.throws(()=>loadManifest(artifact,chosen));}
    save(manifest);writeFileSync(join(artifact,packed[0].file),'tampered');assert.throws(()=>loadManifest(artifact,chosen));
  } finally {rmSync(work,{recursive:true,force:true});}
});
test('workflow publishes only by dispatch from main; approval precedes OIDC and source installation', () => {
  const workflow=readFileSync(new URL('../../../.github/workflows/publish.yml',import.meta.url),'utf8');
  const triggers=workflow.split('\non:\n')[1].split('\npermissions:')[0];
  assert.match(triggers,/workflow_dispatch:/);
  assert.ok(!/\n  (push|pull_request|release|schedule|workflow_run|workflow_call):/.test(triggers));
  assert.equal((workflow.match(/id-token: write/g)??[]).length,1);
  const publishJob=workflow.split('\n  publish:\n')[1].split('\n  verify_registry:\n')[0];
  const verifyJob=workflow.split('\n  verify_registry:\n')[1].split('\n  github_release:\n')[0];
  const releaseJob=workflow.split('\n  github_release:\n')[1];
  assert.match(publishJob,/environment:\n      name: npm-release/);
  assert.match(publishJob,/needs: prepare/);
  assert.match(verifyJob,/STREAMOTTER_INSTALL_FROM: registry/);
  assert.match(releaseJob,/needs: \[prepare, publish, verify_registry\]/);
  assert.ok(!/id-token:|contents: write/.test(verifyJob));
  assert.ok(!/pnpm install|pnpm test:install|contents: write/.test(publishJob));
  assert.ok(!/id-token:|pnpm install/.test(releaseJob));
  assert.ok(!/\$\{\{ inputs\./.test(workflow.split('steps:')[1]), 'inputs must reach commands through environment, not shell expansion');
  assert.ok(!/STREAMOTTER_ALLOW_SKIP|^\s+(?:NODE_AUTH_TOKEN|NPM_TOKEN):/m.test(workflow));
});


test('exact main release CI must pass both pinned matrix nodes; old or partial CI fails', () => {
  const sha=chosen.sourceSha;
  const runs={workflow_runs:[{head_sha:sha,head_branch:'main',event:'push',run_number:1,run_attempt:1,status:'completed',conclusion:'success',check_suite_id:7}]};
  const checks={check_runs:['Verify (Node 24)','Verify (Node 26)'].map(name=>({name,head_sha:sha,status:'completed',conclusion:'success',app:{slug:'github-actions'}}))};
  const api=(command,args)=>JSON.stringify(args[1].includes('/actions/')?runs:checks);
  releaseCI(sha,api);
  const failed=structuredClone(checks);failed.check_runs[1].conclusion='failure';
  assert.throws(()=>releaseCI(sha,(command,args)=>JSON.stringify(args[1].includes('/actions/')?runs:failed)));
  const old=structuredClone(runs);old.workflow_runs[0].head_sha='b'.repeat(40);
  assert.throws(()=>releaseCI(sha,(command,args)=>JSON.stringify(args[1].includes('/actions/')?old:checks)));
  assert.throws(()=>releaseCI(sha,(command,args)=>JSON.stringify(args[1].includes('/actions/')?runs:{check_runs:checks.check_runs.slice(0,1)})));
});
