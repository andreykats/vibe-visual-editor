// Serves the webview-stand-in harness on each port given on the command line.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

// The protocol version the page client expects, read from its source so a bump doesn't break the harness.
const version = /PROTOCOL_VERSION = (\d+)/.exec(readFileSync(new URL('../../packages/protocol/src/version.ts', import.meta.url), 'utf8'))?.[1];
if (!version) throw new Error('PROTOCOL_VERSION not found in packages/protocol/src/version.ts');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace('__VERSION__', version);
for (const port of process.argv.slice(2).map(Number)) {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bad port ${port}`);
  createServer((req, res) => {
    const target = new URL(req.url ?? '/', 'http://x').searchParams.get('target') ?? '';
    res.setHeader('Content-Type', 'text/html');
    res.end(html.replace('__TARGET__', JSON.stringify(target)));
  }).listen(port, '127.0.0.1');
}
