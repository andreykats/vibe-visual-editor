import type { HostToWebview, ToolbarState, UiMessage } from '../webviewProtocol';

declare function acquireVsCodeApi(): {
  postMessage(msg: UiMessage): void;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const config = JSON.parse(document.getElementById('vibe-visual-editor-config')!.dataset.config!) as { url: string; origin: string; mode: string };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const frame = $<HTMLIFrameElement>('frame');
const urlInput = $<HTMLInputElement>('url');
let state: ToolbarState | null = null;
let sawHello = false;
let helloTimer: ReturnType<typeof setTimeout> | undefined;

const post = (msg: UiMessage) => vscode.postMessage(msg);

window.addEventListener('message', (event) => {
  if (event.source === frame.contentWindow) {
    // From the page client inside the iframe: relay to the extension, which validates it.
    if (event.origin !== config.origin) return;
    if ((event.data as { type?: unknown })?.type === 'le:hello') sawHello = true;
    post({ type: 'ui:frame', data: event.data });
    return;
  }
  const msg = event.data as HostToWebview;
  switch (msg?.type) {
    case 'host:state':
      render(msg.state);
      break;
    case 'host:toFrame':
      frame.contentWindow?.postMessage(msg.data, config.origin);
      break;
    case 'host:navigate':
      frame.src = msg.url;
      break;
    case 'host:reload':
      reload();
      break;
  }
});

function reload(): void {
  // Re-assigning src reloads even when only the hash differs from the original.
  const src = state?.url ?? frame.src;
  frame.src = 'about:blank';
  setTimeout(() => (frame.src = src), 0);
}

frame.addEventListener('load', () => {
  if (frame.src === 'about:blank') return;
  post({ type: 'ui:frameLoaded' });
  clearTimeout(helloTimer);
  if (sawHello) {
    sawHello = false;
    return;
  }
  helloTimer = setTimeout(() => {
    if (!sawHello) post({ type: 'ui:pluginMissing' });
    sawHello = false;
  }, 3000);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.addEventListener('click', () => post({ type: 'ui:setMode', mode: button.dataset.mode as ToolbarState['mode'] }));
}
$('address').addEventListener('submit', (e) => {
  e.preventDefault();
  post({ type: 'ui:navigate', url: urlInput.value.trim() });
});
$('reload').addEventListener('click', () => post({ type: 'ui:reload' }));
$('save').addEventListener('click', () => post({ type: 'ui:save' }));
$('discard').addEventListener('click', () => post({ type: 'ui:discard' }));
$('copy').addEventListener('click', () => post({ type: 'ui:copySelection' }));
$('clear').addEventListener('click', () => post({ type: 'ui:clearSelection' }));
$('selection-chip').addEventListener('click', () => post({ type: 'ui:openSource' }));
$('banner-docs').addEventListener('click', (e) => {
  e.preventDefault();
  post({ type: 'ui:openDocs' });
});

const STATUS_TEXT: Record<ToolbarState['status'], string> = {
  connecting: 'Connecting to the page…',
  connected: 'Connected to the Vibe Visual Editor plugin',
  'plugin-missing': 'Vibe Visual Editor plugin not detected on this dev server',
  'protocol-mismatch': 'Vibe Visual Editor plugin version mismatch',
};

function render(next: ToolbarState): void {
  state = next;
  vscode.setState({ url: next.url, mode: next.mode });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    const on = button.dataset.mode === next.mode;
    button.classList.toggle('active', on);
    button.setAttribute('aria-checked', String(on));
    button.disabled = next.mode !== button.dataset.mode && button.dataset.mode !== 'browse' && next.status !== 'connected';
  }
  if (document.activeElement !== urlInput) urlInput.value = next.url;
  const status = $('status');
  status.className = `status ${next.status}`;
  status.title = next.statusDetail ?? STATUS_TEXT[next.status];

  const edits = $('edits');
  edits.hidden = next.pendingCount === 0;
  $('edit-count').textContent = `${next.pendingCount} unsaved edit${next.pendingCount === 1 ? '' : 's'}`;

  const sel = $('selection');
  sel.hidden = !next.selection;
  if (next.selection) {
    const chip = $<HTMLButtonElement>('selection-chip');
    chip.textContent = next.selection.where ? `${next.selection.label} · ${next.selection.where}` : next.selection.label;
    chip.disabled = !next.selection.where;
  }

  const banner = $('banner');
  const problem = next.status === 'plugin-missing' || next.status === 'protocol-mismatch';
  banner.hidden = !problem;
  if (problem) $('banner-text').textContent = `${next.statusDetail ?? STATUS_TEXT[next.status]}. Browse mode still works.`;
}

post({ type: 'ui:ready' });
