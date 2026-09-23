// Prints the CHANGELOG.md section of one version (without its `## [X.Y.Z]`
// heading) so the release workflow can publish it as the GitHub release body.
// Exits 1 when the section is missing or empty, which fails the release.
//
//   node .github/scripts/changelog-release-notes.mjs 0.7.0      # or v0.7.0
//
// The app parses the same file (frontend/src/lib/changelog/parse-changelog.ts).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = (process.argv[2] ?? '').trim().replace(/^v/i, '');
if (!version) {
  console.error('usage: changelog-release-notes.mjs <version>');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lines = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);

const heading = /^##\s+\[v?([^\]]+)\]/;
const start = lines.findIndex(line => heading.exec(line)?.[1].trim() === version);
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section.`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && /^##?\s/.test(line));
if (end === -1) end = lines.length;

const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`The CHANGELOG.md section for ${version} is empty.`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
