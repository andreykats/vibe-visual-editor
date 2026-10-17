// Validates a release tag and prints what it releases.
//
//   node scripts/release-tag.mjs extension-v0.1.1
//
// The tag must be extension-vX.Y.Z or vite-plugin-vX.Y.Z and match the version in
// that package's package.json. Extension releases also need a CHANGELOG entry.
// Prints KEY=value lines for $GITHUB_OUTPUT: package, version, dir.
import { readFileSync } from 'node:fs';
import { changelogSection } from './changelog-section.mjs';

const PACKAGES = { extension: 'packages/extension', 'vite-plugin': 'packages/vite-plugin' };

const tag = process.argv[2] ?? '';
const match = /^(extension|vite-plugin)-v(\d+\.\d+\.\d+)$/.exec(tag);
if (!match) fail(`"${tag}" is not a release tag. Expected extension-vX.Y.Z or vite-plugin-vX.Y.Z.`);
const [, pkg, version] = match;
const dir = PACKAGES[pkg];

let manifest;
try {
  manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8'));
} catch (err) {
  fail(`Can't read ${dir}/package.json: ${err.message}`);
}
if (manifest.version !== version) {
  fail(`${tag} doesn't match ${manifest.name}@${manifest.version}. Bump "version" in ${dir}/package.json, or fix the tag.`);
}
if (pkg === 'extension' && changelogSection(version) === null) {
  fail(`packages/extension/CHANGELOG.md has no "## ${version}" section.`);
}

console.log(`package=${pkg}`);
console.log(`version=${version}`);
console.log(`dir=${dir}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
