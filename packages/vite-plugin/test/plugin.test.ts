import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, createServer, type ViteDevServer } from 'vite';

const fixture = fileURLToPath(new URL('../../../fixtures/h-app', import.meta.url));

describe('plugin against fixtures/h-app', () => {
  let server: ViteDevServer;
  let base: string;

  beforeAll(async () => {
    server = await createServer({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), server: { port: 0 }, logLevel: 'silent' });
    await server.listen();
    const addr = server.httpServer!.address() as { port: number };
    base = `http://localhost:${addr.port}`;
  });
  afterAll(async () => {
    await server?.close();
  });

  const post = async (route: string, body: unknown) => {
    const res = await fetch(`${base}/__vibe-visual-editor/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('writes the discovery file', () => {
    const info = JSON.parse(readFileSync(path.join(fixture, '.vibe-visual-editor/server.json'), 'utf8'));
    expect(info).toMatchObject({ root: fixture, pid: process.pid, protocolVersion: 1 });
    expect(info.url).toBe(`${base}/h-app/`);
  });

  it('reports health', async () => {
    const res = await fetch(`${base}/__vibe-visual-editor/health`);
    expect(await res.json()).toEqual({ protocolVersion: 1, adapters: ['h(h)'], root: fixture });
  });

  it('wraps creation sites and returns a source map', async () => {
    const result = await server.transformRequest('/src/views/settings.ts');
    expect(result!.code).toContain('virtual:vibe-visual-editor/runtime');
    expect(result!.code).toMatch(/__le\(h\("h2", \{\}, "Videos"\), \{/);
    expect(result!.map).toBeTruthy();
    expect((result!.map as { sources: string[] }).sources.some((s) => s.endsWith('settings.ts'))).toBe(true);
  });

  it('injects the client into index.html', async () => {
    const html = await (await fetch(`${base}/h-app/`)).text();
    expect(html).toContain('html-proxy');
    const proxy = await (await fetch(`${base}/h-app/index.html?html-proxy&index=0.js`)).text();
    expect(proxy).toContain('virtual:vibe-visual-editor/client');
  });

  it('resolves rendered text to candidates', async () => {
    await server.transformRequest('/src/main.ts');
    await server.transformRequest('/src/views/home.ts');
    await server.transformRequest('/src/strings.ts');
    const home = await post('resolve', { text: 'Welcome home' });
    expect(home.body.candidates).toHaveLength(1);
    expect(home.body.candidates[0]).toMatchObject({ rel: 'src/views/home.ts', raw: "'Welcome home'", uses: 1 });
    const shared = await post('resolve', { text: 'Shared label' });
    expect(shared.body.candidates[0]).toMatchObject({ rel: 'src/strings.ts', binding: 'SHARED_LABEL', uses: 2 });
    expect((await post('resolve', { text: 'Pressed 0 times' })).body.editable).toBe(false);
  });

  it('analyzes arbitrary code without touching the index', async () => {
    const res = await post('analyze', { file: path.join(fixture, 'src/x.ts'), code: "const a = 'Z';" });
    expect(res.body.literals.map((l: { value: string }) => l.value)).toEqual(['Z']);
    expect((await post('resolve', { text: 'Z' })).body.editable).toBe(false);
  });

  it('validates input', async () => {
    expect((await post('resolve', { text: 5 })).status).toBe(400);
    expect((await post('analyze', { file: 'relative.ts', code: '' })).status).toBe(400);
    expect((await post('analyze', { file: '/abs/x.ts', code: 'const = ;' })).status).toBe(422);
    const wrongType = await fetch(`${base}/__vibe-visual-editor/resolve`, { method: 'POST', body: '{"text":"x"}' });
    expect(wrongType.status).toBe(415);
    expect((await fetch(`${base}/__vibe-visual-editor/nope`)).status).toBe(404);
  });
});

describe('production build', () => {
  it('contains no Vibe Visual Editor code', async () => {
    const outDir = path.join(fixture, 'dist');
    await build({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name));
    };
    walk(outDir);
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/vibe-visual-editor|__le\(|__vibe-visual-editor/);
    }
    expect(existsSync(path.join(outDir, 'index.html'))).toBe(true);
  });
});
