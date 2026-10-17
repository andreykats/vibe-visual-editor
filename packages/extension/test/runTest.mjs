// Runs the integration suite in a real VS Code against a temp copy of fixtures/h-app served by Vite.
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(here, '..');
const repo = path.resolve(extension, '../..');

// Keep the prefix short: VS Code puts its IPC socket under user-data, and macOS caps socket paths at 104 bytes.
const work = realpathSync(mkdtempSync(path.join(tmpdir(), 'vve-it-')));
const workspace = path.join(work, 'h-app');
cpSync(path.join(repo, 'fixtures/h-app'), workspace, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|dist|\.vibe-visual-editor)$/.test(src),
});
symlinkSync(path.join(repo, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');

await build({
  entryPoints: [path.join(here, 'suite/index.ts')],
  outfile: path.join(here, 'out/suite.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: 'inline',
});

const server = await createServer({ root: workspace, configFile: path.join(workspace, 'vite.config.ts'), server: { port: 5311, strictPort: true }, logLevel: 'warn' });
await server.listen();

// Set when this script itself runs from inside VS Code; it would make the test instance start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

let code = 0;
try {
  await runTests({
    extensionDevelopmentPath: extension,
    extensionTestsPath: path.join(here, 'out/suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${path.join(work, 'user-data')}`],
    extensionTestsEnv: { VIBE_VISUAL_EDITOR_HOME: path.join(work, 'home'), VIBE_VISUAL_EDITOR_TEST_DEV_URL: 'http://localhost:5311/h-app/', VIBE_VISUAL_EDITOR_TEST_WORKSPACE: workspace },
  });
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  await server.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
