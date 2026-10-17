import * as vscode from 'vscode';
import {
  EnvelopeSchema,
  PageMessageSchema,
  PROTOCOL_VERSION,
  formatIssues,
  parseLoopbackUrl,
  type Candidate,
  type HostMessage,
  type Mode,
  type PageMessage,
  type PreviewStatus,
  type Unversioned,
} from '@vibe-visual-editor/protocol';
import { EditError, EditService } from './editService';
import { selectionLabel, type SelectionStore } from './selectionStore';
import { frameUrlFor } from './urls';
import { previewHtml } from './webviewHtml';
import { PersistedStateSchema, UiMessageSchema, type HostToWebview, type ToolbarState } from './webviewProtocol';

export const VIEW_TYPE = 'vibeVisualEditor.preview';

export interface PreviewDeps {
  extensionUri: vscode.Uri;
  selection: SelectionStore;
  log: vscode.LogOutputChannel;
}

/** One preview tab: a webview with a toolbar and the dev server in an iframe. */
export class PreviewPanel implements vscode.Disposable {
  /** Page URL as last reported by the page (or as navigated to). */
  url: string;
  mode: Mode;
  status: PreviewStatus = 'connecting';
  private statusDetail: string | undefined;
  /** Origin the webview's iframe (and CSP) was created for. */
  private frameOrigin: string;
  readonly edits: EditService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly helloEmitter = new vscode.EventEmitter<{ url: string }>();
  readonly onDidHello = this.helloEmitter.event;
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;
  /** Completed handshakes (one per page load). */
  helloCount = 0;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly panel: vscode.WebviewPanel,
    frameUrl: string,
    mode: Mode,
    private readonly deps: PreviewDeps,
  ) {
    this.url = frameUrl;
    this.mode = mode;
    this.frameOrigin = new URL(frameUrl).origin;
    this.edits = new EditService(() => this.frameOrigin, deps.log);
    panel.webview.options = { enableScripts: true, enableForms: true, localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'media'), vscode.Uri.joinPath(deps.extensionUri, 'dist')] };
    panel.webview.html = previewHtml(panel.webview, deps.extensionUri, frameUrl, mode);
    panel.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'media', 'icon.svg');
    this.updateTitle();
    this.disposables.push(
      this.edits,
      this.helloEmitter,
      panel.webview.onDidReceiveMessage((m) => this.onUiMessage(m)),
      panel.onDidDispose(() => this.dispose()),
      this.edits.onDidChange(() => {
        this.toFrame({ type: 'le:pending', edits: this.edits.pending() });
        this.postState();
      }),
      this.edits.onDidSave((literalIds) => this.toFrame({ type: 'le:saved', literalIds })),
      deps.selection.onDidChange(() => this.postState()),
    );
  }

  get origin(): string {
    return this.frameOrigin;
  }

  dispose(): void {
    clearTimeout(this.readyTimer);
    this.deps.selection.clear(this);
    for (const d of this.disposables) d.dispose();
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
  }

  reveal(preserveFocus = false): void {
    this.panel.reveal(undefined, preserveFocus);
  }

  /** Points the iframe at `url`. A different origin rebuilds the webview so its CSP allows it. */
  async navigate(url: string): Promise<void> {
    const frameUrl = await frameUrlFor(url);
    const origin = new URL(frameUrl).origin;
    this.url = frameUrl;
    this.setStatus('connecting');
    if (origin !== this.frameOrigin) {
      if (this.edits.pendingCount > 0) {
        void vscode.window.showWarningMessage('Vibe Visual Editor: unsaved preview edits stay in their files; Save or Discard them from the editor.');
      }
      this.frameOrigin = origin;
      this.panel.webview.html = previewHtml(this.panel.webview, this.deps.extensionUri, frameUrl, this.mode);
    } else {
      this.post({ type: 'host:navigate', url: frameUrl });
    }
    this.updateTitle();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== 'select') this.deps.selection.clear(this);
    this.toFrame({ type: 'le:setMode', mode });
    this.postState();
  }

  reload(): void {
    this.setStatus('connecting');
    this.post({ type: 'host:reload' });
  }

  async save(): Promise<void> {
    await this.run(async () => {
      const n = await this.edits.save();
      if (n === 0) void vscode.window.setStatusBarMessage('Vibe Visual Editor: nothing to save', 2000);
    });
  }

  async discard(): Promise<void> {
    await this.run(() => this.edits.discard());
  }

  async undo(): Promise<void> {
    await this.run(() => this.edits.undo());
  }

  async redo(): Promise<void> {
    await this.run(() => this.edits.redo());
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (err) {
      const message = err instanceof EditError ? err.message : String(err);
      this.deps.log.error(message);
      void vscode.window.showErrorMessage(`Vibe Visual Editor: ${message}`);
    }
  }

  // ------------------------------------------------------------- webview

  private onUiMessage(raw: unknown): void {
    const parsed = UiMessageSchema.safeParse(raw);
    if (!parsed.success) return this.deps.log.warn(`Ignoring malformed webview message: ${formatIssues(parsed.error)}`);
    const msg = parsed.data;
    switch (msg.type) {
      case 'ui:ready':
        return this.postState();
      case 'ui:frame':
        return void this.onFrameMessage(msg.data);
      case 'ui:frameLoaded':
        return;
      case 'ui:pluginMissing':
        if (this.status === 'connecting') this.setStatus('plugin-missing');
        return;
      case 'ui:setMode':
        return this.setMode(msg.mode);
      case 'ui:navigate':
        if (!parseLoopbackUrl(msg.url)) {
          void vscode.window.showErrorMessage('Vibe Visual Editor only opens http(s) URLs on localhost, 127.0.0.1 or [::1].');
          return this.postState();
        }
        return void this.navigate(msg.url);
      case 'ui:reload':
        return this.reload();
      case 'ui:save':
        return void this.save();
      case 'ui:discard':
        return void this.discard();
      case 'ui:copySelection':
        return void vscode.commands.executeCommand('vibeVisualEditor.copySelectionForChat');
      case 'ui:clearSelection':
        this.deps.selection.clear(this);
        return this.toFrame({ type: 'le:clearSelection' });
      case 'ui:openSource':
        return void this.openSelectionSource();
      case 'ui:openDocs':
        return void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'setup.md'));
    }
  }

  private async openSelectionSource(): Promise<void> {
    const site = this.deps.selection.get()?.descriptor.creationSite;
    if (!site) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(site.file));
    const pos = new vscode.Position(site.line - 1, site.column - 1);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.One });
  }

  private postState(): void {
    const sel = this.deps.selection.get();
    const site = sel?.descriptor.creationSite;
    const state: ToolbarState = {
      url: this.url,
      mode: this.mode,
      status: this.status,
      statusDetail: this.statusDetail,
      pendingCount: this.edits.pendingCount,
      selection: sel ? { label: selectionLabel(sel.descriptor), where: site ? `${site.rel}:${site.line}` : undefined } : null,
    };
    this.post({ type: 'host:state', state });
  }

  private post(msg: HostToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private toFrame(msg: Unversioned<HostMessage>): void {
    this.post({ type: 'host:toFrame', data: { ...msg, v: PROTOCOL_VERSION } });
  }

  private setStatus(status: PreviewStatus, detail?: string): void {
    this.status = status;
    this.statusDetail = detail;
    this.postState();
  }

  private updateTitle(): void {
    const u = new URL(this.url);
    this.panel.title = `Vibe Visual Editor: ${u.host}${u.pathname === '/' ? '' : u.pathname}${u.hash}`;
  }

  // --------------------------------------------------------------- page

  private async onFrameMessage(data: unknown): Promise<void> {
    const env = EnvelopeSchema.safeParse(data);
    if (!env.success) return;
    if (env.data.v !== PROTOCOL_VERSION) {
      return this.setStatus('protocol-mismatch', `The page's Vibe Visual Editor plugin speaks protocol v${env.data.v}; this extension speaks v${PROTOCOL_VERSION}. Update both to the same release`);
    }
    const parsed = PageMessageSchema.safeParse(data);
    if (!parsed.success) return this.deps.log.warn(`Ignoring malformed ${env.data.type} from the page: ${formatIssues(parsed.error)}`);
    const msg = parsed.data;
    switch (msg.type) {
      case 'le:hello':
        this.url = parseLoopbackUrl(msg.url) ? msg.url : this.url;
        this.setStatus('connecting');
        this.toFrame({ type: 'le:ack' });
        clearTimeout(this.readyTimer);
        this.readyTimer = setTimeout(() => {
          if (this.status === 'connecting') {
            this.setStatus('plugin-missing', 'The page found the Vibe Visual Editor plugin but did not accept the handshake from this webview');
          }
        }, 3000);
        return;
      case 'le:ready':
        clearTimeout(this.readyTimer);
        this.url = parseLoopbackUrl(msg.url) ? msg.url : this.url;
        this.helloCount++;
        this.toFrame({ type: 'le:setMode', mode: this.mode });
        this.toFrame({ type: 'le:pending', edits: this.edits.pending() });
        this.setStatus('connected');
        this.updateTitle();
        this.helloEmitter.fire({ url: this.url });
        return;
      case 'le:location':
        if (parseLoopbackUrl(msg.url)) this.url = msg.url;
        this.updateTitle();
        return this.postState();
      case 'le:edit':
        return this.onEdit(msg);
      case 'le:select':
        return this.deps.selection.set({ descriptor: msg.descriptor, previewUrl: this.url, owner: this });
      case 'le:clearSelection':
        return this.deps.selection.clear(this);
      case 'le:key':
        if (msg.action === 'save') return this.save();
        if (msg.action === 'undo') return this.undo();
        return this.redo();
      case 'le:error':
        return this.deps.log.error(`Page: ${msg.message}`);
    }
  }

  private async onEdit(msg: Extract<PageMessage, { type: 'le:edit' }>): Promise<void> {
    const candidate = msg.candidates.length === 1 ? msg.candidates[0] : await pickCandidate(msg.candidates);
    if (!candidate) {
      this.toFrame({ type: 'le:editRejected', requestId: msg.requestId, reason: 'Edit cancelled.' });
      return;
    }
    try {
      await this.edits.edit(candidate, msg.newValue);
      this.toFrame({ type: 'le:editApplied', requestId: msg.requestId, literalId: candidate.id, value: msg.newValue });
    } catch (err) {
      const reason = err instanceof EditError ? err.message : `Unexpected error: ${String(err)}`;
      this.deps.log.error(`Edit of ${JSON.stringify(candidate.value)} in ${candidate.rel} failed: ${reason}`);
      this.toFrame({ type: 'le:editRejected', requestId: msg.requestId, reason });
    }
  }
}

/** Several equally likely literals: let the user say which one they meant. */
async function pickCandidate(candidates: Candidate[]): Promise<Candidate | undefined> {
  const items = await Promise.all(
    candidates.map(async (c) => {
      let detail = c.raw;
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(c.file));
        detail = doc.lineAt(c.line - 1).text.trim();
      } catch {
        // Fall back to the literal itself.
      }
      return { label: `${c.rel}:${c.line}:${c.column}`, description: c.uses > 1 ? `used in ${c.uses} places` : undefined, detail, candidate: c };
    }),
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: `"${candidates[0]!.value}" appears ${candidates.length} times. Which one did you edit?`,
    matchOnDetail: true,
  });
  return picked?.candidate;
}

export class PreviewManager implements vscode.Disposable {
  private readonly panels = new Set<PreviewPanel>();
  private lastActive: PreviewPanel | undefined;

  constructor(private readonly deps: PreviewDeps) {}

  all(): PreviewPanel[] {
    return [...this.panels];
  }

  /** The focused preview, else the most recently focused one. */
  current(): PreviewPanel | undefined {
    for (const p of this.panels) if (p.panel.active) return p;
    return this.lastActive && this.panels.has(this.lastActive) ? this.lastActive : this.all().at(-1);
  }

  /** Opens `url`, reusing the preview already showing that origin. */
  async open(url: string, options: { mode?: Mode; preserveFocus?: boolean } = {}): Promise<PreviewPanel> {
    const frameUrl = await frameUrlFor(url);
    const origin = new URL(frameUrl).origin;
    const existing = this.all().find((p) => p.origin === origin);
    if (existing) {
      if (existing.url !== frameUrl) await existing.navigate(url);
      if (options.mode) existing.setMode(options.mode);
      existing.reveal(options.preserveFocus);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Vibe Visual Editor', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: options.preserveFocus ?? false }, {
      enableScripts: true,
      enableForms: true,
      retainContextWhenHidden: true,
    });
    return this.adopt(panel, frameUrl, options.mode ?? 'browse');
  }

  /** Revives a panel after a VS Code restart. */
  async restore(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const parsed = PersistedStateSchema.safeParse(state);
    const url = parsed.success ? parseLoopbackUrl(parsed.data.url)?.href : undefined;
    if (!url) {
      panel.dispose();
      return;
    }
    this.adopt(panel, await frameUrlFor(url), parsed.success ? parsed.data.mode : 'browse');
  }

  private adopt(panel: vscode.WebviewPanel, frameUrl: string, mode: Mode): PreviewPanel {
    const preview = new PreviewPanel(panel, frameUrl, mode, this.deps);
    this.panels.add(preview);
    this.lastActive = preview;
    panel.onDidChangeViewState(() => {
      if (panel.active) this.lastActive = preview;
    });
    preview.onDidDispose(() => this.panels.delete(preview));
    return preview;
  }

  dispose(): void {
    for (const p of this.panels) p.panel.dispose();
  }
}
