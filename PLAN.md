# Vibe Visual Editor: build plan

A VS Code extension plus a Vite dev plugin. It renders a running web app inside a VS Code editor tab. The user can click text on the page, retype it, and save the change back to the source file. The user can also select any element, and the selection becomes available to Claude Code or Codex as context.

This document is the full brief. It records what the user decided, which facts were checked against current docs, the architecture, the order to build in, and how each part is verified. Where something wasn't checked, it says so and tells you to check it before relying on it.

> **Status (2026-10-16):** M0–M4 are built and tested. Deviations from this brief, and why, are listed at the end. Spike results are in `docs/spikes.md`.

---

## 1. Goals and non-goals

### Goals (v1)
1. **Open the preview from chat.** When the user asks the agent to "show me the settings page" (or similar), the agent either opens the preview tab directly through an MCP tool, or replies with a link that opens it. The preview is a VS Code editor tab showing the live Vite dev server.
2. **Edit text in place.** In *Edit text* mode, hovering highlights text that can be edited. Clicking one turns it into an inline plain-text editor. Pressing Enter (or clicking away) commits the edit and Escape cancels it. The browser draws a `<select>`'s option list itself, so clicking a dropdown instead lists its options in a small panel of plain-text fields.
3. **Explicit save.** Committed edits become unsaved changes in the matching source files. The files show the usual dirty marker, and edits can be undone with Cmd+Z. Nothing reaches disk until the user presses the Save button in the preview toolbar or Cmd+S. A Discard button reverts only the preview's own edits.
4. **Layout and formatting are read-only.** Only the characters of text that comes from a string literal can change. Tags, attributes, classes, styles, structure and rich text cannot be edited.
5. **Select any element for the agent.** In *Select* mode, clicking any element (text or not) selects it. The agent can then read that selection through MCP when the user says things like "make the selected element red" or "move this button left". This works in both Claude Code and Codex.
6. **Pluggable source tracing.** Mapping rendered text back to its source sits behind an adapter interface. v1 shipped one adapter, for the `h()` element-builder pattern used by the first target app, a framework-free Vite app. 0.2 adds a React/JSX adapter, which tags elements with a `data-vve-loc` attribute instead of wrapping them.

### Non-goals (v1)
- Editing styles, layout, attributes, or structure. Requests for those go through the agent via selection.
- Text that is built at runtime (template literals with `${}`, concatenation, values from data or config). It is shown as **not editable**, but it can still be selected for the agent.
- Bundlers other than Vite. Frameworks other than the `h()` adapter.
- Marketplace publishing. v1 is a privately installed `.vsix`.
- Remote and SSH workspaces. Design so they aren't blocked (see §9), but don't test them in v1.

---

## 2. Decisions already made by the user (do not re-ask)

| Topic | Decision |
|---|---|
| Agents | **Claude Code and Codex.** Share the selection and the open-preview action through an MCP server that both agents use. |
| Rendering support | **The `h()` adapter first, behind a pluggable adapter interface.** |
| Saving | **Save button plus Cmd+S**, with unsaved changes kept as dirty documents and a Discard action. No auto-save in v1. |
| Distribution | **A new standalone repo, installed privately as a `.vsix`.** No Marketplace for now. |
| First bundler | **Vite** (the target app is on Vite 8, which is Rolldown-based). |

---

## 3. Facts checked against current docs (2026-10-16)

Use these and re-check anything that looks stale. The user's standing rule is to fetch official docs for any technology before using it, and to save the doc URLs to agent memory.

- **VS Code webviews** (https://code.visualstudio.com/api/extension-guides/webview)
  - Scripts are off unless `enableScripts: true`. Set a CSP with a `<meta>` tag using `webview.cspSource` and a nonce for scripts.
  - Messages go extension → webview with `webview.postMessage`, and webview → extension with `acquireVsCodeApi().postMessage` received by `onDidReceiveMessage`. Call `acquireVsCodeApi()` only once.
  - `retainContextWhenHidden` keeps the panel alive while hidden, at a memory cost.
  - `registerWebviewPanelSerializer` together with the `onWebviewPanel:<viewType>` activation event restores the panel after VS Code restarts.
- **VS Code's own Simple Browser** (https://github.com/microsoft/vscode/blob/main/extensions/simple-browser/src/simpleBrowserView.ts) is the reference for putting a localhost page in a webview.
  - It uses one `<iframe sandbox="allow-scripts allow-forms allow-same-origin allow-downloads">`.
  - Its CSP is `default-src 'none'; frame-src *; script-src 'nonce-…'; style-src ${cspSource}`.
  - It sets `enableScripts: true`, `enableForms: true` and `retainContextWhenHidden: true`.
  - **Copy this pattern.**
- **VS Code API** (https://code.visualstudio.com/api/references/vscode-api)
  - `window.registerUriHandler(handler)` handles `${env.uriScheme}://<publisher>.<name>/<path>?<query>`.
  - The handler's authority must be the extension ID, and only one handler can be registered for the whole time the extension is active.
  - The `onUri` activation event fires when such a URI arrives. If several windows are open, the topmost window receives it.
  - `env.asExternalUri(uri)` is a no-op locally. For remote workspaces it sets up port forwarding.
  - `window.createWebviewPanel(viewType, title, {viewColumn, preserveFocus}, options)`.
  - The `lm.registerMcpServerDefinitionProvider` API exists, but it only feeds VS Code's own chat. **It does not reach Claude Code or Codex, so don't rely on it.**
- **Vite plugin API** (https://vite.dev/guide/api-plugin)
  - `apply: 'serve'` restricts the plugin to dev.
  - `configureServer(server)` adds middleware with `server.middlewares.use`. It isn't called during builds.
  - `transformIndexHtml` can inject tags, and `order: 'pre'` sends injected scripts through the plugin pipeline.
  - `transform` should use the `{ filter: { id }, handler }` form and return `{ code, map }`.
  - For custom events, the client uses `import.meta.hot.send` and the server uses `server.ws.on`. The server pushes with `server.ws.send`. Prefix event names.
  - In Vite 8 the hooks are Rolldown hooks, and `this.meta.rolldownVersion` is available.
- **Claude Code MCP** (https://code.claude.com/docs/en/mcp)
  - Add a server at user scope with `claude mcp add --scope user …`. That covers stdio, and HTTP via `--transport http <url> --header "Authorization: Bearer …"`.
  - **Resources** can be @-mentioned as `@server:scheme://path` and are attached automatically. Claude Code also gives Claude tools to list and read resources.
  - **Prompts** appear as `/server:prompt` slash commands.
  - `list_changed` notifications are supported in interactive sessions.
  - Tool output warns above 10k tokens and is capped at 25k by default. Images returned by tools are shown to Claude inline.
  - Server `instructions` (up to about 4 KB) tell Claude when to use the tools. Tools are deferred behind tool search by default, so put the trigger words at the start of the description.
- **Codex MCP** (https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
  - Add a server with `codex mcp add <name> -- <command…>` for stdio or `--url <url>` for HTTP, or in `~/.codex/config.toml` under `[mcp_servers.<name>]`.
  - HTTP servers accept `http_headers` / `bearer_token_env_var`.
  - The CLI, desktop app and IDE extension share this config.
  - The defaults are a 10 s startup timeout and a 60 s tool timeout.
  - **The docs don't say whether Codex supports MCP resources or prompts, so design everything to work through tools alone.**
- **MCP TypeScript SDK**
  - The current package is `@modelcontextprotocol/server` (2.3.1 on npm today), with Node HTTP middleware in `@modelcontextprotocol/node`.
  - The stdio helper is `serveStdio(createServer)` from `@modelcontextprotocol/server/stdio`. It negotiates both the 2026-07-28 protocol and 2025-era `initialize` handshakes.
  - `createServer` must return a **new** `McpServer` on every call.
  - Tools are registered with `server.registerTool(...)`.
  - The quickstart is https://modelcontextprotocol.io/docs/develop/build-server. Read the SDK README for current signatures before coding.

**Not checked. Check these early (milestone 0 spikes):**
1. Whether a `vscode://…` link printed in chat is **clickable** in the Claude Code VS Code panel, the Claude Code terminal, and the Codex VS Code panel. If it isn't clickable, the link is secondary and the MCP `open_preview` tool is the main route.
2. Whether Codex starts stdio MCP servers with `cwd` set to the project directory. Multi-window routing (§6.4) depends on it. If it doesn't, look for a `cwd` config field or an environment variable, or fall back to "most recently focused window".
3. Whether a cross-origin iframe inside a webview can keep Vite's HMR WebSocket open. Simple Browser suggests yes.
4. How Cmd+S behaves when focus is inside the iframe. Assume key events in the cross-origin iframe never reach VS Code, so the page client has to forward them (§5.3).

---

## 4. Architecture

```
┌──────────────────────── VS Code window ────────────────────────┐
│  Extension host (Node)                                          │
│   ├─ PreviewPanel (WebviewPanel, one per preview tab)            │
│   │    webview HTML: toolbar + <iframe src=devServerUrl>         │
│   ├─ EditService   → WorkspaceEdit / save / discard              │
│   ├─ SelectionStore (latest selection per window)                │
│   ├─ UriHandler    vscode://andreykats.vibe-visual-editor/open?url=…      │
│   └─ Bridge IPC server (127.0.0.1, random port, token)           │
│          ▲ registered in ~/.vibe-visual-editor/windows/<pid>.json          │
└──────────┼──────────────────────────────────────────────────────┘
           │ HTTP + token
┌──────────┴───────────┐        stdio MCP          ┌──────────────┐
│ vibe-visual-editor-mcp (Node) │◀─────────────────────────▶│ Claude Code  │
│ spawned per agent    │◀─────────────────────────▶│ Codex        │
└──────────────────────┘                           └──────────────┘

Inside the iframe (origin http://localhost:5173):
  app page + injected client (from the Vite plugin)
   ├─ overlay: hover outlines, inline editor, selection highlight
   ├─ talks to the parent webview via window.parent.postMessage
   └─ resolves text → source via the dev-server endpoint /__vibe-visual-editor/*

Vite dev server + vibe-visual-editor plugin (apply: 'serve')
   ├─ transform: adapter indexes string literals and tags element creation sites
   ├─ middleware /__vibe-visual-editor/resolve, /__vibe-visual-editor/health
   └─ writes the discovery file .vibe-visual-editor/server.json (url, root, pid)
```

### Why the pieces are split this way
- **The page client does all DOM work.** The webview can't reach into the cross-origin iframe's DOM, so the hover, edit and select logic has to run inside the page. Only the Vite plugin can inject it there.
- **The extension does all file writes.** Edits go through `WorkspaceEdit` on `TextDocument`s. That gives dirty state, undo/redo, Cmd+S, the Discard action, and correct handling of files the user already has open with unsaved changes. Writes from the Vite plugin straight to disk would lose all of that.
- **The Vite plugin owns the source index.** It already sees every module's source during `transform`, so it is the natural place to build the map from rendered text to source location.
- **The MCP server runs as a stdio process per agent, connected to the extension (not an HTTP server inside the extension).** The reasons:
  1. Both agents support stdio, and configuring it is a single command.
  2. Each agent starts it with the project directory as `cwd`, so it can route to the VS Code window whose workspace contains that directory. A fixed-port HTTP server inside the extension would have only one window able to own the port.
  3. No token has to be stored in agent config files.
  - The stdio process finds windows by reading `~/.vibe-visual-editor/windows/*.json`, which holds `{pid, port, token, workspaceFolders, focusedAt}`. Clean up stale entries whose PID is gone.
  - The launcher needs a stable path that survives extension updates. On activation, the extension copies the bundled bridge to `~/.vibe-visual-editor/bin/vibe-visual-editor-mcp.mjs` and runs it with the user's `node`. If `node` isn't on PATH, use `process.execPath` from VS Code (Electron as Node, via `ELECTRON_RUN_AS_NODE=1`) and document it.

---

## 5. Components

### 5.1 Repo layout (npm workspaces, TypeScript, ESM)
```
vscode-vibe-visual-editor/
  packages/
    protocol/        shared types, message schemas (zod), literal escaping, version constant
    vite-plugin/     @vibe-visual-editor/vite-plugin: plugin + injected client + adapters
    extension/       VS Code extension (esbuild bundle) + webview assets
    mcp-bridge/      stdio MCP server, bundled into the extension
  fixtures/
    h-app/           minimal Vite app using an h() helper like the first target app's
  docs/              setup for Claude Code + Codex, adapter authoring guide
  PLAN.md
```
Name: **Vibe Visual Editor**. Extension ID `andreykats.vibe-visual-editor`. The `publisher` field is needed for the URI handler even in a private `.vsix`.

### 5.2 Vite plugin (`packages/vite-plugin`)

User config in the target app:
```ts
import vibeVisualEditor, { hAdapter } from '@vibe-visual-editor/vite-plugin';
plugins: [vibeVisualEditor({ adapters: [hAdapter({ factory: 'h', from: '/src/ui/dom.ts' })] })]
```

Behaviour:
- `apply: 'serve'` only. `npm run build` output must contain **no** Vibe Visual Editor code. Add a test that greps the build output.
- `transform` (`enforce: 'pre'`, so it sees the original TS): for each module the adapter accepts:
  1. **Index** every string literal (`'…'`, `"…"`, and template literals with no `${}`): `{ id, file, start, end, value, quote }`. Offsets are into the original source. Keep the index in memory per module and replace it when the module is transformed again.
  2. **Tag element creation sites.** Rewrite each call to the configured factory, `h(...)`, as `__le(h(...), "<moduleId>:<start>")`. `__le` records the element in a client-side `WeakMap<Element, Loc>` and returns it unchanged. Use `magic-string` and return a source map. Don't add DOM attributes, so the app's CSS, tests and snapshots stay unaffected.
  - Parser: use `oxc-parser` (TS-aware, gives spans). If it's impractical, use `@babel/parser` with the `typescript` plugin. Check the current API before choosing.
- `transformIndexHtml`: inject the client module, and only when the page is framed by the Vibe Visual Editor webview. The client checks `window.parent !== window` plus a handshake (§5.3) and does nothing otherwise. That way a normal browser tab on the same dev server is unaffected.
- Middleware:
  - `POST /__vibe-visual-editor/resolve {text, elementLoc}` → candidates (see "Resolution" below).
  - `GET /__vibe-visual-editor/health` → `{protocolVersion, adapters, root}`.
- On `listening`, write `<root>/.vibe-visual-editor/server.json` `{url, root, pid, protocolVersion}`, and delete it on close. Add `.vibe-visual-editor/` to the app's `.gitignore` (document it, don't edit their file silently).
- When an edited file is saved, Vite's normal HMR or full reload handles it. No special hot-update logic is needed.

**Resolution (h() adapter):** the rendered text node holds a plain string with no record of where it came from. For example, in the first target app `p('…')` is `const p = (text) => h('p', {class}, text)`, so the literal sits at the caller, not at the `h()` call. So resolve by **exact value match**:
1. Find indexed literals whose `value` exactly equals the text node's `data`. Normalize nothing except that the text node must be the element's whole text child.
2. Rank the matches: (a) inside the element's own `h()` call span, (b) the same module as the element's creation site, (c) any other module.
3. One top-ranked match → editable. Several equal-ranked matches → editable, and the extension shows a Quick Pick of the candidates with a code preview. No match → **not editable** (built at runtime).
4. Also report how many places use the literal. If it's a shared constant (`const TITLE = 'Videos'` used twice), the inline editor warns "Used in N places".

**Adapter interface** (in `protocol`, implemented in `vite-plugin/adapters/*`):
```ts
interface SourceAdapter {
  name: string;
  /** Cheap check: should this module be indexed? */
  include(id: string, code: string): boolean;
  /** Literal index + element-creation call spans to wrap. */
  analyze(code: string, id: string): { literals: LiteralEntry[]; creationSites: Span[] };
  /** Rank candidate literals for a rendered text node. */
  rank(candidates: LiteralEntry[], ctx: { elementLoc?: Loc }): RankedCandidate[];
}
```
A future JSX adapter would put creation sites on JSX elements and literals on JSXText and string attribute values used as children. Keep everything specific to `h()` out of the shared code.

### 5.3 Injected page client
- **Handshake:** on load, post `{type:'le:hello', protocolVersion}` to `window.parent` with `targetOrigin: '*'`. A webview origin isn't predictable, and the message contains nothing sensitive. Accept commands only from `window.parent`, check `event.source === window.parent`, and validate every message with the zod schemas from `protocol`. Do nothing until the webview replies `le:ack`.
- **Modes**, set by the toolbar:
  - `browse`: the page behaves normally. This is the default.
  - `edit`: hovering over **editable** text gives a solid outline. Hovering over **non-editable** text gives a dashed grey outline and the tooltip "Built at runtime: select it and ask the agent". Clicking editable text:
    - Wrap the text node in a temporary `<span contenteditable="plaintext-only">`. Never set `contenteditable` on the parent, because that would allow editing its structure.
    - Focus it and select its contents.
    - **Enter** or blur commits, **Escape** cancels.
    - **Shift+Enter** inserts a line break as a `\n` character (never `<br>`), written to the literal as an escaped `\n`. Paste is plain text only and keeps its line breaks. Whether a break shows depends on the element's `white-space`; when it would collapse to a space, the client says so after the commit.
    - Unwrap the span afterwards so the DOM structure is unchanged.
    - Swallow the click in the capture phase so app handlers don't fire. For example, clicking a button's label must not press the button.
  - `select`: hovering outlines any element. A click selects it (it gets a persistent highlight) and sends `le:select`. The click is swallowed. Esc clears the selection.
- **Element descriptor** for `le:select` (keep it small, since it goes into the agent's context):
  - `tag`, `id`, `classList`, `data-testid`, and up to 3 ARIA/role/label attributes
  - `textContent`, trimmed to 300 characters
  - a short unique CSS selector path
  - `outerHTML`, trimmed to 2 KB
  - `boundingRect`
  - computed styles: display, position, size, margin, padding, font-size/weight, color, background, gap/flex/grid, up to about 20 properties
  - `creationSite` from the WeakMap, `{file, line, column}`, plus the nearest ancestor's creation site if the element has none
  - `editableText`, if the element's text resolves to a literal
  - `pageUrl`, `route` (hash), and a timestamp
- **Keyboard forwarding:** while focus is in the iframe, catch Cmd/Ctrl+S, Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z and post them up as `le:key`. The webview passes them to the extension, which runs save/undo/redo. Call `preventDefault` so the browser doesn't open its own Save dialog.
- **Pending edits survive re-renders:** apps like the first target app rebuild their DOM on state changes, which would put the old text back before the user saves. Keep a `Map<literalId, newValue>` of unsaved edits. A `MutationObserver` re-applies them to text nodes that resolve to the same literal and marks them with a subtle "unsaved" underline. Clear the map on save, discard, or full reload.

### 5.4 VS Code extension (`packages/extension`)

**Contributions**
- Commands:
  - `vibeVisualEditor.openPreview`: takes a URL argument, or shows a Quick Pick of discovered dev servers from `**/.vibe-visual-editor/server.json`, or an input box.
  - `vibeVisualEditor.save`, `vibeVisualEditor.discard`, `vibeVisualEditor.setMode`.
  - `vibeVisualEditor.configureAgents` (§5.5).
  - `vibeVisualEditor.copySelectionForChat`: puts the descriptor on the clipboard as Markdown. This is the fallback for agents without MCP.
- Keybindings: `cmd+s` / `ctrl+s` → `vibeVisualEditor.save` when `activeWebviewPanelId == 'vibeVisualEditor.preview'`.
- Activation events: `onUri`, `onWebviewPanel:vibeVisualEditor.preview`, `onCommand:*`, and `workspaceContains:**/.vibe-visual-editor/server.json`.
- `registerWebviewPanelSerializer`, so the preview comes back after a reload.

**PreviewPanel webview**
- Toolbar:
  - **Browse / Edit text / Select** segmented control
  - URL field and Reload
  - "N unsaved edits" with **Save** and **Discard** buttons
  - the selected element's summary chip, with "Copy for chat" and "Clear"
  - a status dot (connected / plugin missing / protocol mismatch)
- Below the toolbar, the iframe follows Simple Browser's setup: sandbox flags as listed in §3 and CSP `frame-src` limited to the dev server origin (not `*`).
- If no `le:hello` arrives within 3 s of the iframe loading, show a banner: "Vibe Visual Editor plugin not detected on this dev server". Link to setup docs. Browse mode still works.

**EditService**
- On `le:edit {candidateIds | literal {file,start,end,value,quote}, newValue}`:
  1. Open the `TextDocument`. **Check** that the text at `[start,end)` still equals the original literal, including quotes. If it doesn't (the file changed since indexing), ask the plugin to re-resolve. If that also fails, show an error and change nothing. Never guess.
  2. Build the replacement with `protocol.escapeLiteral(newValue, quote)`. Keep the quote style. Escape `\`, the active quote, and newlines. For backtick literals also escape `` ` `` and `${`. Unit-test it for round trips.
  3. Apply it with `WorkspaceEdit.replace`, labelled "Vibe Visual Editor: rename text" so undo is meaningful. Don't save.
  4. Record `{uri, range, before, after}` on the panel's edit stack.
- **Save:** call `document.save()` for each document with pending Vibe Visual Editor edits. Only those documents: the user's other dirty files aren't Vibe Visual Editor's business.
- **Discard:** apply inverse edits in reverse order, checking each range first. Don't use `revert`, which would also throw away the user's own unsaved edits in that file.
- **External changes:** listen to `workspace.onDidChangeTextDocument`. If an edited range is changed by something other than Vibe Visual Editor, drop that entry from the stack and warn.
- **Restrictions:** only write to files inside the workspace folders, and only replace a range that is exactly one string literal.

**URI handler**
- `vscode://andreykats.vibe-visual-editor/open?url=<encoded>&mode=<browse|edit|select>`.
- Validate that `url` is `http(s)://localhost|127.0.0.1|[::1]:<port>`, and reject anything else. Then open or focus the matching panel.

**Bridge IPC server**
- `http.createServer` on `127.0.0.1:0`, with a random 32-byte token required in the `Authorization` header.
- Write `~/.vibe-visual-editor/windows/<pid>.json` with mode `0600`, and update `focusedAt` on `window.onDidChangeWindowState`.
- Endpoints: `POST /open`, `GET /selection`, `GET /state` (open previews, modes, pending edit count).

### 5.5 MCP bridge (`packages/mcp-bridge`) and agent setup

Use stdio with `serveStdio(createServer)`.

**Routing:** pick the window whose `workspaceFolders` contains `process.cwd()`, choosing the deepest match. If none match, use the most recently focused window and say so in the tool result.

**Tools.** Every tool must work without resources and prompts, because of Codex.

| Tool | Input | Behaviour |
|---|---|---|
| `open_preview` | `{ url?: string, path?: string, mode?: 'browse'\|'edit'\|'select' }` | Opens or focuses the preview. `path` is joined onto the discovered dev server URL, e.g. `"#/settings"`. If no URL is given and no dev server is discovered, return an error telling the agent to start it (`npm run dev`) and retry. Returns the URL it opened and a `vscode://` link as text. |
| `get_selection` | `{}` | Returns the latest element descriptor as compact Markdown plus a JSON block. If nothing is selected, say so and tell the agent to ask the user to click an element in Select mode. |
| `get_preview_state` | `{}` | Open previews, current mode, pending edit count, dev server status. |
| `get_selection_screenshot` *(stretch)* | `{}` | PNG of the selected element, returned as an image so Claude sees it inline. Needs a capture method. Defer unless a clean one turns up. |

**Resource:** `preview://selection` (`text/markdown`), so Claude Code users can type `@vibe-visual-editor:preview://selection`. Send `list_changed`/`updated` notifications when the selection changes.

**Prompt:** `/vibe-visual-editor:selected` puts the current selection into the conversation (Claude Code).

**Server `instructions`** (put the important words first): "Vibe Visual Editor: renders the user's running web app in a VS Code tab and shares the element they selected. When the user asks to see, show, render or open a page/screen, call open_preview. When they refer to 'the selected element', 'this', 'that button', or 'what I clicked', call get_selection first, then edit the source at its creationSite."

**`vibeVisualEditor.configureAgents` command:**
- Shows the exact commands, offers to run them in a terminal, and then checks the result:
  - `claude mcp add --scope user vibe-visual-editor -- node ~/.vibe-visual-editor/bin/vibe-visual-editor-mcp.mjs`
  - `codex mcp add vibe-visual-editor -- node ~/.vibe-visual-editor/bin/vibe-visual-editor-mcp.mjs` (look for the CLI at `/Applications/ChatGPT.app/Contents/Resources/codex` if `codex` isn't on PATH)
- Verify with `claude mcp list` and `codex mcp list`. User rule: always configure both agents, and Claude Code at user scope.

---

## 6. Message protocol (`packages/protocol`)

All messages carry `v: PROTOCOL_VERSION`. Validate them with zod at every boundary. Reject unknown types and mismatched versions, and show the mismatch in the status dot.

Page → webview: `le:hello`, `le:edit`, `le:select`, `le:clearSelection`, `le:key`, `le:error`.
Webview → page: `le:ack`, `le:setMode`, `le:editApplied {literalId}`, `le:editRejected {literalId, reason}`, `le:saved`, `le:discarded`.
Webview ↔ extension: the same payloads, passed through, plus toolbar commands.

### 6.4 Multi-window
Each window registers itself on its own. The bridge routes by `cwd` (§5.5). The URI handler goes to the topmost window, which is VS Code's behaviour. If that window's workspace doesn't contain the dev server's `root`, it still opens the preview there and shows a note. Don't try to forward it.

---

## 7. Milestones

Each milestone ends with its tests passing. Commit when a milestone is done and tested (the user's rule: commit to the current branch, never push unless asked, no self-credit in commit messages, short messages).

**M0: scaffold and spikes (½ day)**
- Set up the workspaces, TS config, esbuild for the extension, Vitest, Playwright, and `@vscode/test-electron`.
- Run spikes for the four unchecked items in §3 and record the results in `docs/spikes.md`. Adjust the plan if a spike fails, and tell the user if it changes anything user-visible.

**M1: preview panel**
- `openPreview` command, the webview with the iframe, toolbar shell, discovery Quick Pick, URI handler, and serializer.
- *Accept:* the `fixtures/h-app` dev server renders in a VS Code tab. HMR works in the tab. A `vscode://` link opens it.

**M2: Vite plugin, index and select**
- Adapter interface, `hAdapter` indexing and creation-site wrapping, injected client, handshake, Select mode, the element descriptor, and the selection chip in the toolbar.
- *Accept:* selecting an element shows its tag and creation site `file:line`, and that matches the source. A production build has no Vibe Visual Editor code. A normal browser tab on the same dev server shows no overlay.

**M3: text editing and save**
- Resolve endpoint, Edit mode, inline editor, EditService (check, escape, WorkspaceEdit), Save, Discard, Cmd+S/Z forwarding, pending-edit re-apply, and the ambiguity Quick Pick.
- *Accept:* rename a heading → the file goes dirty with a one-literal diff → Save → disk changed and the page reloads with the new text. Discard restores the original exactly. A runtime-built string shows as not editable. A file with the user's own unsaved edits elsewhere keeps them after Save and after Discard.

**M4: MCP bridge and agents**
- Window registry, bridge server, stdio MCP server (tools, resource, prompt), `configureAgents`, the bundled launcher copy.
- *Accept:* in Claude Code **and** Codex, "show me the settings page" opens the preview. "Make the selected element's text bold" leads the agent to call `get_selection` and edit the right source line.

**M5: harden and package**
- Error states and banners, stale registry cleanup, protocol-mismatch messaging, docs (`README`, setup for both agents, adapter guide), and `vsce package` → `.vsix`.
- *Accept:* a clean install from the `.vsix` on this Mac works end to end against the first target app.

---

## 8. Testing

- **Unit (Vitest):**
  - literal indexing for every quote kind and for comments or strings that look like code
  - `escapeLiteral` round trips (quotes, backslashes, unicode, `${`, emoji)
  - candidate ranking
  - routing (cwd → window)
  - zod schemas
- **Plugin integration (Vitest + Vite `createServer`):** transform output has source maps and correct wrapping; the resolve endpoint returns the expected candidates for `fixtures/h-app`; a build has no plugin code.
- **Page client (Playwright against the fixture's dev server, page framed by a test harness that plays the webview):** handshake, modes, the click is swallowed in edit/select mode, inline editor behaviour (Enter, Shift+Enter line breaks, Escape, paste), the descriptor's shape and size limits, and pending edits re-applied after a re-render.
- **Extension (`@vscode/test-electron`):** WorkspaceEdit applied, document dirty, save writes only the touched files, discard is exact, a changed range is rejected, the URI handler rejects non-localhost URLs.
- **MCP (MCP Inspector CLI, `npx @modelcontextprotocol/inspector --cli … --method tools/list`, plus scripted calls):** tool list, schemas, `get_selection` with and without a selection, routing.
- **Manual acceptance on real agents** (required before calling M4/M5 done, per the user's rule that anything touching a real service has to be seen working there): Claude Code in the VS Code panel, Claude Code in the terminal, and Codex in the VS Code panel.

---

## 9. Security and robustness

- Every dev endpoint and the client exist only in `serve` mode. Bind the bridge to 127.0.0.1 only, behind a token, with registry files at mode `0600`.
- The URI handler and `open_preview` accept only loopback URLs.
- File writes: only inside the workspace folders, only one checked string-literal range per edit, and nothing written to disk without an explicit Save.
- Validate every cross-boundary message (postMessage, HTTP, MCP input).
- Remote/SSH later: route the iframe URL through `env.asExternalUri`, and check whether webview `portMapping` is needed. Not in v1, but keep URL handling in one function so it can be added later.

---

## 10. First target app notes

- A framework-free Vite 8 + TypeScript app. The DOM is built with `h(tag, attrs, ...children)` from `src/ui/dom.ts`, and string children become `document.createTextNode(String(child))`. It is served under a non-root base, with hash routes such as `#/settings`.
- Section headings are plain literals like `h('h2', {}, 'Videos')`. These are the easy cases.
- Some views wrap the helper, e.g. `const p = (text, cls) => h('p', {class: cls}, text)`. That's why resolution works by exact value match and doesn't depend on the `h()` call site.
- **Gotcha:** its settings screen has an idle timer that goes back to the home view after a period without input. The page sees user input in the overlay as normal events, but long pauses while reading will still navigate away. Noted in the docs.
- **Gotcha:** some heading text is also quoted elsewhere, e.g. in log messages and an e2e test asserting the heading. Vibe Visual Editor edits only the clicked literal, and the "Used in N places" warning covers only identical literals. Updating references in prose is the agent's job, not the extension's.

---

## 11. Open questions to bring back to the user (don't block on them)
- Screenshot of the selected element for the agent (stretch tool): worth an extra dependency or capture approach?
- Should the selection persist across page reloads (re-find it by selector path)?

---

## Deviations made during the build

- **Adapter interface.** `analyze` receives the parsed program, and returns creation sites, excluded spans (tag names, attribute objects) and literal owners. The core does the generic literal indexing, so each adapter only states framework facts. See `docs/adapters.md`.
- **Locations carry `{file, rel, line, column, start, end}`** rather than `"<moduleId>:<start>"`, so the client can describe creation sites without another request.
- **Handshake gets a third step.** The client accepts `le:ack` only from a VS Code webview origin (or `trustedParentOrigins` set for test harnesses), pins later messages to that origin, and replies `le:ready`. The preview is "connected" only after `le:ready`. Otherwise any site framing the dev server could ack and receive descriptors.
- **Pending edits are synced as a whole set** (`le:pending`) from the extension, which owns them. `le:saved` carries the literal ids that reached disk. This replaces `le:discarded`, and lets a page reload re-apply edits that are still unsaved.
- **Re-resolve uses `/__vibe-visual-editor/analyze`.** When the document differs from disk (for example the user's own unsaved edits shifted offsets), the extension sends the document's current text to be analyzed, and matches the literal by value plus ordinal among equal literals. If the count differs, it refuses.
- **Activation uses `onStartupFinished`** instead of `workspaceContains`. The bridge must be registered before any preview exists, or before a dev server has written `server.json`, so that `open_preview` works from a cold start.
- **Undo/redo in the preview** (Cmd+Z while the preview is focused) steps through Vibe Visual Editor's own edit stack with new inverse `WorkspaceEdit`s. VS Code can't run `undo` on a document that isn't in the active editor. Undo in the text editor itself works as usual.
- **Discard leaves a file marked modified** even when its text matches disk again (see `docs/spikes.md`).
- **Not done:** resource `updated` notifications when the selection changes (the resource is read fresh each time), and the screenshot stretch tool.
