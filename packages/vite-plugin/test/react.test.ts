import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, createServer, type ViteDevServer } from 'vite';

const fixture = fileURLToPath(new URL('../../../fixtures/react-app', import.meta.url));

describe('plugin against fixtures/react-app', () => {
  let server: ViteDevServer;
  let base: string;

  beforeAll(async () => {
    server = await createServer({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), server: { port: 0 }, logLevel: 'silent' });
    await server.listen();
    base = `http://localhost:${(server.httpServer!.address() as { port: number }).port}`;
    for (const m of ['/src/App.tsx', '/src/Card.tsx', '/src/strings.ts']) await server.transformRequest(m);
  });
  afterAll(async () => {
    await server?.close();
  });

  const resolve = async (text: string) => {
    const res = await fetch(`${base}/__vibe-visual-editor/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    return (await res.json()) as { editable: boolean; candidates: { rel: string; quote: string; raw: string }[] };
  };

  it('tags DOM elements with data-vve-loc, even though react() runs first, and registers the file once', async () => {
    const { code } = (await server.transformRequest('/src/App.tsx'))!;
    expect(code.match(/__leFile\(/g)).toHaveLength(1);
    expect(code).toMatch(/__leFile\("\w+", ".*App\.tsx", "src\/App\.tsx"\)/);
    expect(code).toMatch(/"data-vve-loc": "\w+:\d+:\d+:9:7"/); // the <h1> on line 9
    // Components aren't tagged: they don't render a DOM element of their own.
    expect(code).not.toMatch(/Card, \{[^}]*data-vve-loc/);
  });

  it('resolves JSX text, text props, entities and shared constants', async () => {
    expect((await resolve('Welcome to React')).candidates[0]).toMatchObject({ rel: 'src/App.tsx', quote: 'jsx', raw: 'Welcome to React' });
    expect((await resolve('Edit me in place')).candidates[0]).toMatchObject({ quote: 'jsx', raw: '\n        Edit me in place\n      ' });
    expect((await resolve('Card title')).candidates[0]).toMatchObject({ quote: 'jsx-attr', raw: '"Card title"' });
    expect((await resolve('Tom & Jerry')).candidates[0]).toMatchObject({ raw: 'Tom &amp; Jerry' });
    expect((await resolve('Shared title')).candidates[0]).toMatchObject({ rel: 'src/strings.ts' });
    expect((await resolve('Pressed 0 times')).editable).toBe(false);
  });
});

describe('React production build', () => {
  it('contains no Vibe Visual Editor code or attributes', async () => {
    const outDir = path.join(fixture, 'dist');
    await build({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    try {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
      expect(files.length).toBeGreaterThan(1);
      for (const f of files) {
        const text = readFileSync(path.join(f.parentPath, f.name), 'utf8');
        expect(text, f.name).not.toMatch(/vibe-visual-editor|data-vve-loc|__leFile/);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
