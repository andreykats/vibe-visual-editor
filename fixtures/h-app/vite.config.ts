import { defineConfig } from 'vite';
import vibeVisualEditor, { hAdapter } from '@vibe-visual-editor/vite-plugin';

const trusted = process.env.VIBE_VISUAL_EDITOR_TRUSTED_ORIGIN;

export default defineConfig({
  // A non-root base, as on GitHub Pages project sites, so base handling is exercised.
  base: '/h-app/',
  plugins: [
    vibeVisualEditor({
      adapters: [hAdapter({ factory: 'h', from: '/src/ui/dom.ts' })],
      trustedParentOrigins: trusted ? [trusted] : [],
    }),
  ],
});
