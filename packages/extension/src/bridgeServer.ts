import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  formatIssues,
  OpenRequestSchema,
  PROTOCOL_VERSION,
  type OpenRequest,
  type OpenResponse,
  type SelectionResponse,
  type StateResponse,
  type WindowEntry,
} from '@vibe-visual-editor/protocol';

export interface BridgeHandlers {
  open(req: OpenRequest): Promise<OpenResponse>;
  selection(): SelectionResponse;
  state(): Promise<StateResponse>;
}

const MAX_BODY = 64 * 1024;

export function registryDir(): string {
  return path.join(process.env.VIBE_VISUAL_EDITOR_HOME ?? path.join(homedir(), '.vibe-visual-editor'), 'windows');
}

/**
 * Loopback HTTP endpoint the vibe-visual-editor-mcp process talks to. Each window
 * registers itself in `~/.vibe-visual-editor/windows/<pid>.json` (mode 0600) with its
 * port, a random token, and its workspace folders, so the MCP process can
 * route by its working directory.
 */
export class BridgeServer implements vscode.Disposable {
  private server: Server | undefined;
  private readonly token = randomBytes(32).toString('hex');
  private readonly file = path.join(registryDir(), `${process.pid}.json`);
  private focusedAt = vscode.window.state.focused ? Date.now() : 0;
  private port = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly handlers: BridgeHandlers,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  async start(): Promise<void> {
    const server = (this.server = createServer((req, res) => void this.handle(req, res)));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (server.address() as AddressInfo).port;
    this.writeRegistry();
    this.disposables.push(
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) {
          this.focusedAt = Date.now();
          this.writeRegistry();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.writeRegistry()),
    );
    this.log.info(`Bridge listening on 127.0.0.1:${this.port}`);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.server?.close();
    rmSync(this.file, { force: true });
  }

  private writeRegistry(): void {
    const entry: WindowEntry = {
      pid: process.pid,
      port: this.port,
      token: this.token,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      focusedAt: this.focusedAt,
      protocolVersion: PROTOCOL_VERSION,
    };
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file, JSON.stringify(entry), { mode: 0o600 });
    } catch (err) {
      this.log.error(`Could not write ${this.file}: ${String(err)}`);
    }
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const expected = Buffer.from(`Bearer ${this.token}`);
    const given = Buffer.from(header);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (!this.authorized(req)) return send(401, { error: 'unauthorized' });
      const route = `${req.method} ${req.url}`;
      if (route === 'GET /selection') return send(200, this.handlers.selection());
      if (route === 'GET /state') return send(200, await this.handlers.state());
      if (route === 'POST /open') {
        const parsed = OpenRequestSchema.safeParse(await readJson(req));
        if (!parsed.success) return send(400, { error: formatIssues(parsed.error) });
        return send(200, await this.handlers.open(parsed.data));
      }
      return send(404, { error: `unknown route ${route}` });
    } catch (err) {
      if (err instanceof BadRequest) return send(400, { error: err.message });
      this.log.error(`Bridge request failed: ${String(err)}`);
      return send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

class BadRequest extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new BadRequest('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequest('invalid JSON');
  }
}
