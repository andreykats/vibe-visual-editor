# @vibe-visual-editor/vite-plugin

The dev-server half of [Vibe Visual Editor](https://github.com/andreykats/vibe-visual-editor), a VS Code extension that shows your running Vite app in an editor tab. In the preview you can retype text and save it to the source, or select an element and ask Claude Code or Codex to change it.

This plugin maps rendered text back to the string literal in your source that produced it. It runs only in `vite` dev (`apply: 'serve'`): production builds contain none of its code. It also does nothing unless the page is open inside the Vibe Visual Editor preview, so a normal browser tab on the same dev server is unaffected.

## Install

```sh
npm install -D @vibe-visual-editor/vite-plugin
```

Then install the [Vibe Visual Editor extension](https://marketplace.visualstudio.com/items?itemName=andreykats.vibe-visual-editor) in VS Code.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vibeVisualEditor, { hAdapter } from '@vibe-visual-editor/vite-plugin';

export default defineConfig({
  plugins: [vibeVisualEditor({ adapters: [hAdapter({ factory: 'h', from: '/src/ui/dom.ts' })] })],
});
```

Add `.vibe-visual-editor/` to your `.gitignore`. While the dev server runs, the plugin writes `.vibe-visual-editor/server.json` there so the extension can find the server.

### Adapters

An adapter tells the plugin how your app creates elements. v0.1 ships one:

- **`hAdapter({ factory, from })`** for apps that build their DOM with an `h(tag, attrs, ...children)` helper. `factory` is the helper's exported name, and `from` is the root-relative path of the module that exports it.

Support for JSX frameworks is planned. [Writing a source adapter](https://github.com/andreykats/vibe-visual-editor/blob/main/docs/adapters.md) describes the interface (`SourceAdapter`, which this package exports as a type).

## Requirements

- Vite 7 or later.
- Node.js 20.19+ or 22.12+, as Vite requires.

## License

[MIT](https://github.com/andreykats/vibe-visual-editor/blob/main/LICENSE). Created by Andrey Kats.
