import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Mode } from '@vibe-visual-editor/protocol';

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Toolbar plus one sandboxed iframe on the dev server, following VS Code's Simple Browser. */
export function previewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, frameUrl: string, mode: Mode): string {
  const nonce = randomBytes(16).toString('base64');
  const origin = new URL(frameUrl).origin;
  const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, file)).toString();
  const csp = [
    "default-src 'none'",
    `frame-src ${origin}`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');
  const config = escapeAttr(JSON.stringify({ url: frameUrl, origin, mode }));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta id="vibe-visual-editor-config" data-config="${config}">
  <link rel="stylesheet" href="${media('media/webview.css')}">
</head>
<body>
  <header class="toolbar">
    <div class="modes" role="radiogroup" aria-label="Mode">
      <button data-mode="browse" role="radio">Browse</button>
      <button data-mode="edit" role="radio">Edit text</button>
      <button data-mode="select" role="radio">Select</button>
    </div>
    <span class="status" id="status" title="Connecting"></span>
    <form class="address" id="address"><input id="url" type="text" spellcheck="false" aria-label="URL"></form>
    <button id="reload" title="Reload">⟳</button>
    <div class="edits" id="edits" hidden>
      <span id="edit-count"></span>
      <button id="save" class="primary">Save</button>
      <button id="discard">Discard</button>
    </div>
    <div class="selection" id="selection" hidden>
      <button id="selection-chip" class="chip" title="Open source"></button>
      <button id="copy">Copy for chat</button>
      <button id="clear" title="Clear selection">✕</button>
    </div>
  </header>
  <div class="banner" id="banner" hidden><span id="banner-text"></span> <a href="#" id="banner-docs">Setup docs</a></div>
  <iframe id="frame" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
    allow="autoplay; clipboard-read; clipboard-write" src="${escapeAttr(frameUrl)}"></iframe>
  <script nonce="${nonce}" src="${media('dist/webview.js')}"></script>
</body>
</html>`;
}
