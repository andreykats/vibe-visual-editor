# Changelog

## 0.1.0 (preview)

First public preview.

- Preview a running Vite dev server in a VS Code tab, with Browse, Edit text and Select modes.
- Edit text in place: retype text that comes from a string literal, and the change becomes an unsaved edit in the source file. Save, Discard, Undo and Redo work from the preview.
- Shift+Enter adds a line break, written to the source as `\n`.
- Dropdown (`<select>`) options can be edited in a small panel next to the dropdown.
- Select an element and ask Claude Code or Codex about it. The bundled `vibe-visual-editor` MCP server gives agents `get_selection`, `get_preview_state` and `open_preview`.
- **Configure Claude Code and Codex** registers the MCP server with both agents.
- Requires the `@vibe-visual-editor/vite-plugin` in the app. v0.1 supports apps that build their DOM with an `h(tag, attrs, ...children)` helper.
