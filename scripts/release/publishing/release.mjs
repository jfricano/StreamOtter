// Entry points use spawnSync argv arrays, never shell interpolation. Only `publish` mutates npm.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
export const REPOSITORY = 'jfricano/StreamOtter';
export const PACKAGES = [
  ['@streamotter/contracts', 'packages/contracts'],
  ['@streamotter/client', 'packages/client'],
  ['@streamotter/gateway', 'packages/gateway'],
  ['@streamotter/workbench', 'apps/workbench'],
  ['@streamotter/cli', 'packages/cli'],
  ['streamotter', 'packages/streamotter'],
];
export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = (bytes, kind, encoding = 'hex') => createHash(kind).update(bytes).digest(encoding);
export function selection(tag, distTag) {
  assert.match(tag ?? '', /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/);
  assert.ok(['latest', 'next'].includes(distTag), 'distribution tag must be latest or next');
  const version = tag.slice(1);
  assert.ok(version.includes('-') || distTag === 'latest', 'stable versions require latest');
  return { tag, version, distTag };
}
export function environmentProtected(env, policies) {
  assert.equal(env.name, 'npm-release');
  // Current API may include this setting, although the documented response omits it.
  if (Object.hasOwn(env, 'can_admins_bypass')) assert.equal(env.can_admins_bypass, false, 'disable administrator bypass');
  const rules = env.protection_rules?.filter(r => r.type === 'required_reviewers');
  assert.equal(rules?.length, 1, 'npm-release must already have required reviewers');
  assert.equal(rules[0].prevent_self_review, false, 'sole maintainer must be able to approve');
  assert.equal(rules[0].reviewers?.length, 1, 'only Jason may approve this release');
  assert.equal(rules[0].reviewers[0].type, 'User');
  assert.equal(rules[0].reviewers[0].reviewer.login.toLowerCase(), 'jfricano');
  assert.deepEqual(env.deployment_branch_policy, { protected_branches: false, custom_branch_policies: true });
  assert.equal(policies.branch_policies?.length, 1);
  assert.equal(policies.branch_policies[0].name, 'main');
  assert.equal(policies.branch_policies[0].type, 'branch');
}
export function preflight(exec = run) {
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY);
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  environmentProtected(
    JSON.parse(exec('gh', ['api', `repos/${REPOSITORY}/environments/npm-release`])),
    JSON.parse(exec('gh', ['api', `repos/${REPOSITORY}/environments/npm-release/deployment-branch-policies`]))
  );
}
export function releaseCI(sha, exec = run) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  const runs = JSON.parse(exec('gh', ['api', `repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`])).workflow_runs;
  const run = runs.filter(r => r.head_sha === sha && r.head_branch === 'main' && r.event === 'push')
    .sort((a,b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  assert.ok(run, 'exact release commit needs its own main push CI run');
  assert.equal(run.status, 'completed', 'wait for release CI');
  assert.equal(run.conclusion, 'success', 'release CI must pass');
  const checks = JSON.parse(exec('gh', ['api', `repos/${REPOSITORY}/check-suites/${run.check_suite_id}/check-runs?filter=latest&per_page=100`])).check_runs;
  for (const name of ['Verify (Node 24)', 'Verify (Node 26)']) {
    const check = checks.find(c => c.name === name && c.head_sha === sha && c.app?.slug === 'github-actions');
    assert.ok(check, `missing exact release CI: ${name}`);
    assert.equal(check.status, 'completed');
    assert.equal(check.conclusion, 'success');
  }
}
export function select(root, tag, distTag, exec = run) {
  const chosen = selection(tag, distTag);
  // checkout must be main, with the tag already on origin; no tags are created here.
  exec('git', ['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main', `+refs/tags/${tag}:refs/tags/${tag}`], { cwd: root });
  const sha = exec('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: root });
  assert.match(sha, /^[a-f0-9]{40}$/);
  exec('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: root });
  assert.equal(exec('git', ['status', '--porcelain'], { cwd: root }), '', 'dirty source tree');
  for (const [name, path] of PACKAGES) {
    const manifest = JSON.parse(exec('git', ['show', `${sha}:${path}/package.json`], { cwd: root }));
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, chosen.version);
    assert.ok(!manifest.private);
  }
  // A release must contain this automation, not a pre-automation historical tag.
  exec('git', ['cat-file', '-e', `${sha}:.github/workflows/publish.yml`], { cwd: root });
  exec('git', ['cat-file', '-e', `${sha}:scripts/release/publishing/release.mjs`], { cwd: root });
  return { schema: 1, repository: REPOSITORY, sourceSha: sha, ...chosen };
}
export function validatePacked(pkg, source, version, entries) {
  assert.equal(pkg.name, source.name);
  assert.equal(pkg.version, version);
  assert.ok(!pkg.private);
  assert.ok(pkg.repository?.url?.includes('github.com/jfricano/StreamOtter'), 'repository metadata required');
  if (source.publishConfig?.exports) assert.deepEqual(pkg.exports, source.publishConfig.exports, 'pnpm must apply publishConfig.exports');
  assert.ok(!JSON.stringify(pkg.exports ?? {}).includes('streamotter-source'), 'source condition leaked');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, value] of Object.entries(pkg[field] ?? {})) {
      assert.ok(!/^(workspace:|file:|link:)/.test(value), `non-registry dependency ${name}`);
      if (PACKAGES.some(([n]) => n === name)) assert.equal(value, version, `internal dependency ${name} must be exact`);
    }
  }
  assert.ok(entries.includes('package/package.json') && entries.some(e => /^package\/README(?:\.md)?$/i.test(e)) && entries.includes('package/LICENSE'), 'missing package docs/license');
  assert.ok(entries.some(e => e.startsWith('package/dist/')), 'missing compiled distribution');
  for (const entry of entries) {
    assert.ok(entry.startsWith('package/') && !entry.split('/').some(p => p === '..' || p === '.'), 'unsafe archive entry');
    assert.ok(!/(^|\/)(\.npmrc|\.env(?:\..*)?|\.git|\.local-secrets)(\/|$)|\.(pem|key)$/i.test(entry), 'sensitive archive entry');
  }
}
export function pack(root, output, chosen, exec = run) {
  mkdirSync(output, { recursive: true });
  assert.equal(readdirSync(output).length, 0, 'use empty artifact directory');
  exec('pnpm', ['-r', ...PACKAGES.flatMap(([name]) => ['--filter', name]), 'pack', '--pack-destination', resolve(output)], { cwd: root });
  const files = readdirSync(output).sort();
  assert.equal(files.length, PACKAGES.length);
  const seen = new Map();
  for (const file of files) {
    assert.match(file, /^[a-z0-9][a-z0-9.-]*\.tgz$/);
    const full = join(output, file);
    assert.ok(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink());
    const pkg = JSON.parse(exec('tar', ['-xOzf', full, 'package/package.json']));
    const sourcePair = PACKAGES.find(([name]) => name === pkg.name);
    assert.ok(sourcePair, 'unknown package');
    assert.ok(!seen.has(pkg.name), 'duplicate package');
    const source = json(join(root, sourcePair[1], 'package.json'));
    const entries = exec('tar', ['-tzf', full]).split('\n');
    validatePacked(pkg, source, chosen.version, entries);
    const bytes = readFileSync(full);
    seen.set(pkg.name, { name: pkg.name, version: pkg.version, file, size: bytes.length, sha256: hash(bytes, 'sha256'), integrity: `sha512-${hash(bytes, 'sha512', 'base64')}` });
  }
  exec('git', ['diff', '--exit-code'], { cwd: root });
  assert.equal(exec('git', ['status', '--porcelain'], { cwd: root }), '', 'packing changed tracked source');
  const manifest = { ...chosen, packages: PACKAGES.map(([name]) => seen.get(name)) };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function loadManifest(directory, expected) {
  const m = json(join(directory, 'manifest.json'));
  assert.equal(m.schema, 1);
  assert.equal(m.repository, REPOSITORY);
  assert.match(m.sourceSha, /^[a-f0-9]{40}$/);
  assert.deepEqual(selection(m.tag, m.distTag), { tag: m.tag, version: m.version, distTag: m.distTag });
  if (expected) for (const key of ['sourceSha', 'tag', 'version', 'distTag']) assert.equal(m[key], expected[key]);
  assert.equal(m.packages.length, PACKAGES.length);
  assert.deepEqual(m.packages.map(p => p.name), PACKAGES.map(([n]) => n));
  const filenames = [];
  for (const p of m.packages) {
    assert.equal(p.version, m.version);
    assert.match(p.file, /^[a-z0-9][a-z0-9.-]*\.tgz$/);
    assert.ok(!filenames.includes(p.file), 'duplicate artifact');
    filenames.push(p.file);
    const full = join(directory, p.file);
    assert.ok(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink());
    assert.equal(realpathSync(full), join(realpathSync(directory), p.file));
    const bytes = readFileSync(full);
    assert.equal(bytes.length, p.size);
    assert.equal(hash(bytes, 'sha256'), p.sha256);
    assert.equal(`sha512-${hash(bytes, 'sha512', 'base64')}`, p.integrity);
    const pkg = JSON.parse(run('tar', ['-xOzf', full, 'package/package.json']));
    assert.equal(pkg.name, p.name);
    assert.equal(pkg.version, p.version);
  }
  assert.deepEqual(readdirSync(directory).sort(), [...filenames, 'manifest.json'].sort(), 'unexpected artifact files');
  return m;
}
export async function registryVersion(name, version, fetcher = fetch) {
  assert.ok(PACKAGES.some(([n]) => n === name));
  selection(`v${version}`, version.includes('-') ? 'next' : 'latest');
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  if (response.status === 404) return null;
  assert.ok(response.ok, `registry HTTP ${response.status}`);
  return response.json();
}
export function existingMatches(record, pkg) {
  if (record === null) return false;
  assert.equal(record.name, pkg.name);
  assert.equal(record.version, pkg.version);
  assert.equal(record.dist?.integrity, pkg.integrity, `published ${pkg.name} differs: HOLD release; rerun the original publish job with its retained artifacts`);
  assert.ok(!record.deprecated, `published ${pkg.name} is deprecated`);
  return true;
}
export async function inventory(m, lookup = registryVersion) {
  const results = [];
  // Inventory all six before any publish, to avoid publishing ahead of a later mismatch.
  for (const pkg of m.packages) results.push({ ...pkg, exists: existingMatches(await lookup(pkg.name, pkg.version), pkg) });
  return results;
}
export async function waitForVersion(pkg, lookup = registryVersion, options = {}) {
  const attempts = options.attempts ?? 13;
  const pause = options.pause ?? (() => new Promise(done => setTimeout(done, 10000)));
  for (let i = 0; i < attempts; i++) {
    const record = await lookup(pkg.name, pkg.version);
    if (record !== null) { existingMatches(record, pkg); return record; }
    if (i + 1 < attempts) await pause();
  }
  assert.fail(`registry propagation timed out for ${pkg.name}; retain artifacts, inventory before retry`);
}
export async function publish(m, directory, lookup = registryVersion, exec = run, retry = {}) {
  const results = await inventory(m, lookup);
  for (const pkg of results) {
    if (pkg.exists) { console.log(`Verified existing ${pkg.name}@${pkg.version}; skipped`); continue; }
    exec('npm', ['publish', resolve(directory, pkg.file), '--access', 'public', '--tag', m.distTag, '--provenance', '--ignore-scripts', '--registry', 'https://registry.npmjs.org/']);
    await waitForVersion(pkg, lookup, retry);
  }
  return results;
}
export async function verify(m, lookup = registryVersion, fetcher = fetch, retry = {}) {
  for (const pkg of m.packages) {
    await waitForVersion(pkg, lookup, retry);
    const response = await fetcher(`https://registry.npmjs.org/-/package/${encodeURIComponent(pkg.name)}/dist-tags`);
    assert.ok(response.ok, `dist-tags HTTP ${response.status}`);
    assert.equal((await response.json())[m.distTag], m.version, `dist-tag drift for ${pkg.name}: requires separately approved correction`);
  }
}
async function cli() {
  const [mode, rootArg, outputArg] = process.argv.slice(2);
  const root = resolve(rootArg ?? '.');
  const output = resolve(outputArg ?? '.');
  if (mode === 'preflight') return preflight();
  if (mode === 'select') {
    preflight();
    const chosen = select(root, process.env.RELEASE_TAG, process.env.NPM_DIST_TAG);
    releaseCI(chosen.sourceSha);
    writeFileSync(output, JSON.stringify(chosen, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `sha=${chosen.sourceSha}\nversion=${chosen.version}\n`, { flag: 'a' });
    return;
  }
  if (mode === 'pack') return pack(root, output, json(process.env.RELEASE_SELECTION));
  assert.ok(['check', 'publish', 'verify'].includes(mode), 'unknown command');
  const chosen = json(process.env.RELEASE_SELECTION);
  assert.equal(chosen.tag, process.env.RELEASE_TAG);
  assert.equal(chosen.distTag, process.env.NPM_DIST_TAG);
  if (process.env.EXPECTED_SOURCE_SHA) assert.equal(chosen.sourceSha, process.env.EXPECTED_SOURCE_SHA);
  const m = loadManifest(output, chosen);
  if (mode === 'check') return;
  if (mode === 'publish') {
    preflight();
    assert.deepEqual(select(root, m.tag, m.distTag), chosen, 'release tag moved after approval');
    releaseCI(chosen.sourceSha);
    assert.equal(process.version, 'v24.21.0');
    assert.equal(run('npm', ['--version']), '11.19.0');
    assert.ok(!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN, 'npm write tokens are not used');
    return publish(m, output);
  }
  return verify(m);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => { console.error(error.message); process.exitCode = 1; });
