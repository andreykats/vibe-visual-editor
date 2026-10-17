// Serves the webview-stand-in harness on each port given on the command line.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
for (const port of process.argv.slice(2).map(Number)) {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bad port ${port}`);
  createServer((req, res) => {
    const target = new URL(req.url ?? '/', 'http://x').searchParams.get('target') ?? '';
    res.setHeader('Content-Type', 'text/html');
    res.end(html.replace('__TARGET__', JSON.stringify(target)));
  }).listen(port, '127.0.0.1');
}
