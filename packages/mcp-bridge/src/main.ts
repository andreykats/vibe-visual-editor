import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createVibeVisualEditorServer } from './server';

// stdout is the MCP channel; anything else goes to stderr.
serveStdio(() => createVibeVisualEditorServer(), { onerror: (err) => console.error(`[vibe-visual-editor-mcp] ${err.message}`) });
