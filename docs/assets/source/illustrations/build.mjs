// Regenerates the standalone SVGs in docs/assets/illustrations/ and docs/assets/patterns/.
//   node docs/assets/source/illustrations/build.mjs [name-filter]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAL } from './lib.mjs';
import { SPOTS } from './spots.mjs';
import { DIAGRAMS } from './diagrams.mjs';
import { PATTERNS } from './patterns.mjs';

const assets = fileURLToPath(new URL('../../', import.meta.url));
const only = process.argv[2] ?? '';
const written = [];
for (const [name, fn] of Object.entries({ ...SPOTS, ...DIAGRAMS })) {
  if (!name.includes(only)) continue;
  writeFileSync(`${assets}illustrations/${name}.svg`, fn(PAL.light));
  writeFileSync(`${assets}illustrations/${name}-dark.svg`, fn(PAL.dark));
  written.push(name);
}
for (const [name, [fn, dark]] of Object.entries(PATTERNS)) {
  if (!name.includes(only)) continue;
  writeFileSync(`${assets}patterns/${name}.svg`, fn(PAL.light));
  if (dark) writeFileSync(`${assets}patterns/${name}-dark.svg`, fn(PAL.dark));
  written.push(name);
}
console.log(written.join(' '));
