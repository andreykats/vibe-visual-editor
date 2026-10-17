// Prints the extension CHANGELOG section for a version, for release notes.
//
//   node scripts/changelog-section.mjs 0.1.1
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHANGELOG = new URL('../packages/extension/CHANGELOG.md', import.meta.url);

/** The body under "## <version>" (a suffix like "(preview)" is allowed), or null if there is none. */
export function changelogSection(version) {
  const lines = readFileSync(CHANGELOG, 'utf8').split('\n');
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const section = changelogSection(process.argv[2] ?? '');
  if (section === null) {
    console.error(`No "## ${process.argv[2]}" section in packages/extension/CHANGELOG.md.`);
    process.exit(1);
  }
  console.log(section);
}
