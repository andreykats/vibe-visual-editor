import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ElementDescriptor } from '@vibe-visual-editor/protocol';

const BUNDLE = fileURLToPath(new URL('../../extension/dist/mcp-bridge.mjs', import.meta.url));
const TOKEN = 'a'.repeat(64);

const descriptor: ElementDescriptor = {
  tag: 'button',
  classList: ['primary'],
  testId: 'save',
  attributes: { type: 'button' },
  textContent: 'Save',
  selector: '[data-testid="save"]',
  outerHTML: '<button class="primary" data-testid="save">Save</button>',
  boundingRect: { x: 1, y: 2, width: 80, height: 24 },
  styles: { color: 'rgb(0, 0, 0)' },
  creationSite: { file: '/p/src/view.ts', rel: 'src/view.ts', line: 12, column: 5, start: 100, end: 140 },
  creationSiteIsAncestor: false,
  pageUrl: 'http://localhost:5173/#/settings',
  route: '#/settings',
  timestamp: 1,
};

/** Stands in for a VS Code window's bridge server. */
function fakeWindow(state: { selection: ElementDescriptor | null; opened: unknown[] }): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
    if (req.url === '/selection') return send(200, { selection: state.selection, previewUrl: 'http://localhost:5173/' });
    if (req.url === '/state') {
      return send(200, {
        previews: [{ url: 'http://localhost:5173/', mode: 'select', status: 'connected', pendingEdits: 2, active: true }],
        devServers: [{ url: 'http://localhost:5173/', root: '/p', running: true }],
      });
    }
    if (req.url === '/open') {
      let body = '';
      for await (const c of req) body += c;
      const parsed = JSON.parse(body);
      state.opened.push(parsed);
      if (parsed.url === 'http://example.com/') return send(200, { ok: false, error: 'Refusing to open http://example.com/' });
      return send(200, { ok: true, url: `http://localhost:5173/${parsed.path ?? ''}`, link: 'vscode://andreykats.vibe-visual-editor/open?url=x' });
    }
    send(404, { error: 'nope' });
  });
}

async function connect(cwd: string, home: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BUNDLE], cwd, env: { ...process.env, VIBE_VISUAL_EDITOR_HOME: home } as Record<string, string> }));
  return client;
}

const textOf = (r: { content?: unknown }) => (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

describe('vibe-visual-editor-mcp over stdio', () => {
  const state = { selection: null as ElementDescriptor | null, opened: [] as unknown[] };
  let server: Server;
  let home: string;
  let project: string;
  let client: Client;

  beforeAll(async () => {
    if (!existsSync(BUNDLE)) throw new Error(`Build the extension first (npm run build -w vibe-visual-editor); missing ${BUNDLE}`);
    server = fakeWindow(state);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    home = mkdtempSync(path.join(tmpdir(), 'le-home-'));
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'le-proj-')));
    mkdirSync(path.join(project, 'src'));
    mkdirSync(path.join(home, 'windows'), { recursive: true });
    writeFileSync(
      path.join(home, 'windows', `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, port: (server.address() as AddressInfo).port, token: TOKEN, workspaceFolders: [project], focusedAt: 1, protocolVersion: 1 }),
    );
    client = await connect(path.join(project, 'src'), home);
  });

  afterAll(async () => {
    await client?.close();
    server?.close();
  });

  it('lists tools, the selection resource and the prompt', async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['get_preview_state', 'get_selection', 'open_preview']);
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual(['preview://selection']);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['selected']);
    expect(client.getInstructions()).toMatch(/^Vibe Visual Editor:/);
  });

  it('get_selection explains what to do when nothing is selected', async () => {
    state.selection = null;
    const r = await client.callTool({ name: 'get_selection', arguments: {} });
    expect(textOf(r)).toMatch(/Nothing is selected.*Select mode/);
  });

  it('get_selection returns Markdown with the creation site and a JSON block', async () => {
    state.selection = descriptor;
    const r = await client.callTool({ name: 'get_selection', arguments: {} });
    const t = textOf(r);
    expect(t).toContain('`src/view.ts:12:5`');
    expect(t).toContain('```json');
    expect(t).not.toContain('Note: no VS Code window');
  });

  it('open_preview forwards path and mode and returns the link', async () => {
    const r = await client.callTool({ name: 'open_preview', arguments: { path: '#/settings', mode: 'select' } });
    expect(textOf(r)).toContain('Opened http://localhost:5173/#/settings');
    expect(textOf(r)).toContain('vscode://andreykats.vibe-visual-editor/open');
    expect(state.opened.at(-1)).toEqual({ path: '#/settings', mode: 'select' });
  });

  it('open_preview surfaces refusals as tool errors', async () => {
    const r = await client.callTool({ name: 'open_preview', arguments: { url: 'http://example.com/' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Refusing');
  });

  it('rejects invalid tool input', async () => {
    const r = await client.callTool({ name: 'open_preview', arguments: { mode: 'paint' } });
    expect(r.isError).toBe(true);
  });

  it('get_preview_state summarizes previews and dev servers', async () => {
    const t = textOf(await client.callTool({ name: 'get_preview_state', arguments: {} }));
    expect(t).toContain('mode: select, connected, 2 unsaved edits, active');
    expect(t).toContain('(running) root /p');
  });

  it('serves the selection as a resource and a prompt', async () => {
    state.selection = descriptor;
    const res = await client.readResource({ uri: 'preview://selection' });
    expect((res.contents[0] as { text: string }).text).toContain('src/view.ts:12:5');
    const prompt = await client.getPrompt({ name: 'selected' });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain('src/view.ts:12:5');
  });

  it('notes the fallback when cwd is outside every window', async () => {
    const other = await connect(tmpdir(), home);
    try {
      const t = textOf(await other.callTool({ name: 'get_selection', arguments: {} }));
      expect(t).toMatch(/^Note: no VS Code window has .* open/);
    } finally {
      await other.close();
    }
  });

  it('reports a clear error when no window is running', async () => {
    const empty = await connect(project, mkdtempSync(path.join(tmpdir(), 'le-empty-')));
    try {
      const r = await empty.callTool({ name: 'get_selection', arguments: {} });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain('No VS Code window with the Vibe Visual Editor extension is running');
    } finally {
      await empty.close();
    }
  });
});
