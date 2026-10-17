import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import type { Plugin, ViteDevServer } from 'vite';
import {
  AnalyzeRequestSchema,
  formatIssues,
  PROTOCOL_VERSION,
  ResolveRequestSchema,
  type AnalyzeResponse,
  type DevServerInfo,
  type HealthResponse,
  type SourceAdapter,
} from '@vibe-visual-editor/protocol';
import { ParseError } from './indexer';
import { cleanId } from './paths';
import { SourceIndex } from './sourceIndex';

export interface VibeVisualEditorOptions {
  adapters: SourceAdapter[];
  /**
   * Extra parent-frame origins the page client will handshake with, besides
   * VS Code webviews. Only needed for test harnesses.
   */
  trustedParentOrigins?: string[];
}

const RUNTIME_ID = 'virtual:vibe-visual-editor/runtime';
const CLIENT_ID = 'virtual:vibe-visual-editor/client';
const CONFIG_ID = 'virtual:vibe-visual-editor/config';
const RESOLVED_PREFIX = '\0';
export const INDEX_CHANGED_EVENT = 'vibe-visual-editor:index-changed';
const MAX_BODY = 6 * 1024 * 1024;

/** Records each tagged element's creation site in a page-global WeakMap read by the client. */
const RUNTIME_CODE = `const key = Symbol.for('vibe-visual-editor.locs');
const locs = (globalThis[key] ??= new WeakMap());
export function __le(el, loc) {
  if (typeof el === 'object' && el !== null) locs.set(el, loc);
  return el;
}
`;

function readClientBundle(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, 'client.js'), path.join(here, '..', 'dist', 'client.js')]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error('Vibe Visual Editor: client bundle not found. Run `npm run build -w @vibe-visual-editor/vite-plugin`.');
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function loopbackHost(configured: string | boolean | undefined): string {
  if (configured === '127.0.0.1') return '127.0.0.1';
  if (configured === '::1') return '[::1]';
  return 'localhost';
}

export function vibeVisualEditor(options: VibeVisualEditorOptions): Plugin {
  if (!options?.adapters?.length) throw new Error('Vibe Visual Editor: at least one adapter is required');
  let index: SourceIndex | undefined;
  let server: ViteDevServer | undefined;

  const handleApi = async (req: IncomingMessage, res: ServerResponse, route: string): Promise<void> => {
    const idx = index!;
    if (route === 'health' && req.method === 'GET') {
      const body: HealthResponse = { protocolVersion: PROTOCOL_VERSION, adapters: idx.adapters.map((a) => a.name), root: idx.root };
      return sendJson(res, 200, body);
    }
    if (route === 'resolve' && req.method === 'POST') {
      const parsed = ResolveRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, formatIssues(parsed.error));
      return sendJson(res, 200, idx.resolve(parsed.data));
    }
    if (route === 'analyze' && req.method === 'POST') {
      const parsed = AnalyzeRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, formatIssues(parsed.error));
      if (!path.isAbsolute(parsed.data.file)) throw new HttpError(400, 'file must be absolute');
      try {
        const body: AnalyzeResponse = { literals: idx.analyzeDetached(parsed.data.file, parsed.data.code) };
        return sendJson(res, 200, body);
      } catch (err) {
        if (err instanceof ParseError) throw new HttpError(422, err.message);
        throw err;
      }
    }
    throw new HttpError(404, `Unknown endpoint ${req.method} /__vibe-visual-editor/${route}`);
  };

  return {
    name: 'vibe-visual-editor',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      index = new SourceIndex(config.root, options.adapters);
    },

    resolveId: {
      filter: { id: /^virtual:vibe-visual-editor\// },
      handler(id) {
        if (id === RUNTIME_ID || id === CLIENT_ID || id === CONFIG_ID) return RESOLVED_PREFIX + id;
        return null;
      },
    },

    load: {
      filter: { id: /^\0virtual:vibe-visual-editor\// },
      handler(id) {
        if (id === RESOLVED_PREFIX + RUNTIME_ID) return RUNTIME_CODE;
        if (id === RESOLVED_PREFIX + CLIENT_ID) return readClientBundle();
        if (id === RESOLVED_PREFIX + CONFIG_ID) {
          return `export default ${JSON.stringify({ trustedParentOrigins: options.trustedParentOrigins ?? [] })};`;
        }
        return null;
      },
    },

    transform: {
      filter: { id: { include: /\.[cm]?[jt]sx?$/, exclude: [/[\\/]node_modules[\\/]/, /^\0/] } },
      handler(code, id) {
        const file = cleanId(id);
        if (!path.isAbsolute(file) || !index) return null;
        const reindex = index.has(file);
        let analysis;
        try {
          analysis = index.update(file, code);
        } catch (err) {
          index.remove(file);
          if (err instanceof ParseError) return null;
          throw err;
        }
        if (reindex) server?.ws.send({ type: 'custom', event: INDEX_CHANGED_EVENT, data: { file } });
        if (!analysis || analysis.creationSites.length === 0) return null;

        const s = new MagicString(code);
        for (const site of analysis.creationSites) {
          s.prependRight(site.start, '__le(');
          s.appendLeft(site.end, `, ${JSON.stringify(site)})`);
        }
        s.prepend(`import { __le } from '${RUNTIME_ID}';\n`);
        return { code: s.toString(), map: s.generateMap({ hires: 'boundary', source: file, includeContent: true }) };
      },
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [{ tag: 'script', attrs: { type: 'module' }, children: `import '${CLIENT_ID}';`, injectTo: 'head-prepend' }];
      },
    },

    configureServer(devServer) {
      server = devServer;
      devServer.middlewares.use((req, res, next) => {
        const match = /^\/__vibe-visual-editor\/([a-z]+)(?:\?.*)?$/.exec(req.url ?? '');
        if (!match) return next();
        handleApi(req, res, match[1]!).catch((err: unknown) => {
          const status = err instanceof HttpError ? err.status : 500;
          sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        });
      });

      const httpServer = devServer.httpServer;
      if (!httpServer) return;
      const infoDir = path.join(devServer.config.root, '.vibe-visual-editor');
      const infoFile = path.join(infoDir, 'server.json');
      const cleanup = () => rmSync(infoFile, { force: true });
      httpServer.on('listening', () => {
        const address = httpServer.address() as AddressInfo | null;
        if (!address) return;
        const protocol = devServer.config.server.https ? 'https' : 'http';
        const host = loopbackHost(devServer.config.server.host);
        const info: DevServerInfo = {
          url: `${protocol}://${host}:${address.port}${devServer.config.base}`,
          root: devServer.config.root,
          pid: process.pid,
          protocolVersion: PROTOCOL_VERSION,
        };
        try {
          mkdirSync(infoDir, { recursive: true });
          writeFileSync(infoFile, JSON.stringify(info, null, 2));
        } catch (err) {
          devServer.config.logger.warn(`Vibe Visual Editor: could not write ${infoFile}: ${String(err)}`);
        }
      });
      httpServer.on('close', cleanup);
      process.once('exit', cleanup);
    },
  };
}
