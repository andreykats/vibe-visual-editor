import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const repoModules = fileURLToPath(new URL('../../../node_modules', import.meta.url));
const tsc = path.join(repoModules, 'typescript/bin/tsc');

/**
 * The packed tarball, installed into an app that has only the plugin's declared
 * dependencies. Catches anything the package needs but doesn't ship, such as
 * types from the unpublished protocol package.
 */
describe('packed @vibe-visual-editor/vite-plugin', () => {
  let app: string;
  let installed: string;

  beforeAll(() => {
    app = mkdtempSync(path.join(os.tmpdir(), 'vve-consumer-'));
    const [{ filename }] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', app], { cwd: pkgDir, encoding: 'utf8' }));
    installed = path.join(app, 'node_modules/@vibe-visual-editor/vite-plugin');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(app, filename), '-C', installed, '--strip-components=1']);

    const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      const link = path.join(app, 'node_modules', dep);
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(path.join(repoModules, dep), link, 'dir');
    }

    // At least as strict as the apps it's installed into, and lib .d.ts files are checked too.
    writeFileSync(
      path.join(app, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2023', 'DOM'],
          types: [],
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          isolatedModules: true,
          verbatimModuleSyntax: true,
          skipLibCheck: false,
          noEmit: true,
        },
        include: ['vite.config.ts'],
      }),
    );
    writeFileSync(
      path.join(app, 'vite.config.ts'),
      [
        `import { defineConfig } from 'vite';`,
        `import vibeVisualEditor, { hAdapter, type SourceAdapter } from '@vibe-visual-editor/vite-plugin';`,
        ``,
        `const adapters: SourceAdapter[] = [hAdapter({ factory: 'h', from: '/src/ui/dom.ts' })];`,
        `export default defineConfig({ plugins: [vibeVisualEditor({ adapters })] });`,
        ``,
      ].join('\n'),
    );
  }, 60_000);

  afterAll(() => {
    if (app) rmSync(app, { recursive: true, force: true });
  });

  it('type-checks in a strict app', () => {
    let output = '';
    try {
      execFileSync(process.execPath, [tsc, '-p', app], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      output = String((err as { stdout?: string }).stdout ?? err);
    }
    expect(output).toBe('');
  }, 60_000);

  it('loads and builds a plugin', async () => {
    const mod = await import(pathToFileURL(path.join(installed, 'dist/index.js')).href);
    const plugin = mod.default({ adapters: [mod.hAdapter({ factory: 'h', from: '/src/ui/dom.ts' })] });
    expect(plugin).toMatchObject({ name: expect.any(String), apply: 'serve' });
  });
});
