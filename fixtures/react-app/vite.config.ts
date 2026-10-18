import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vibeVisualEditor, { reactAdapter } from '@vibe-visual-editor/vite-plugin';

const trusted = process.env.VIBE_VISUAL_EDITOR_TRUSTED_ORIGIN;

export default defineConfig({
  base: '/react-app/',
  // react() comes first on purpose: the plugin must still see the original JSX.
  plugins: [react(), vibeVisualEditor({ adapters: [reactAdapter()], trustedParentOrigins: trusted ? [trusted] : [] })],
});
