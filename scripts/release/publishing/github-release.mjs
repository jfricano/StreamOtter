// Called only AFTER exact registry/dist-tag and registry-installed-package tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { REPOSITORY, selection, run } from './release.mjs';
const chosen = JSON.parse(readFileSync(process.argv[2], 'utf8'));
selection(chosen.tag, chosen.distTag);
assert.equal(chosen.repository, REPOSITORY);
assert.match(chosen.sourceSha, /^[a-f0-9]{40}$/);
assert.equal(JSON.parse(run('gh', ['api', `repos/${REPOSITORY}/commits/${chosen.tag}`])).sha, chosen.sourceSha, 'release tag moved before GitHub release');
const releases = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${REPOSITORY}/releases?per_page=100`])).flat();
const existing = releases.find(r => r.tag_name === chosen.tag);
if (existing) {
  assert.equal(existing.draft, false);
  assert.equal(existing.prerelease, chosen.version.includes('-'));
  assert.ok(existing.body?.includes(chosen.sourceSha), 'existing GitHub release does not record approved source; owner review required');
  console.log(`Verified existing release ${existing.html_url}`);
} else {
  const notes = join(tmpdir(), 'streamotter-release-notes.md');
  writeFileSync(notes, `Source: ${chosen.sourceSha}\n\n[Changelog](https://github.com/${REPOSITORY}/blob/${chosen.sourceSha}/CHANGELOG.md)\n\nAll six packages passed exact registry integrity, ${chosen.distTag} tag, and registry install checks including TLS Kafka. Source release limitations remain as documented in the handoff.\n\nArtifact manifest:\n\n\`\`\`json\n${readFileSync(process.argv[3], 'utf8')}\`\`\`\n`);
  run('gh', ['release', 'create', chosen.tag, '--repo', REPOSITORY, '--verify-tag', '--target', chosen.sourceSha, '--title', `StreamOtter ${chosen.version}`, '--notes-file', notes, ...(chosen.version.includes('-') ? ['--prerelease'] : [])]);
}
// Complete a retry where release creation succeeded but manifest upload failed.
run('gh', ['release', 'upload', chosen.tag, process.argv[3], '--repo', REPOSITORY, '--clobber']);
