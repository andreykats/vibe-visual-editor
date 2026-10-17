# Releasing

Two things are published:

- the VS Code extension `andreykats.vibe-visual-editor`, to the Visual Studio Marketplace
- the Vite plugin `@vibe-visual-editor/vite-plugin`, to npm

The other packages are internal and stay `private`. `protocol` is inlined into both published packages, and `mcp-bridge` is bundled into the extension.

## Versions

The two packages are versioned independently. They talk to each other over a wire protocol whose number is `PROTOCOL_VERSION` in `packages/protocol/src/version.ts`. When it changes, release both packages together and say so in the extension's changelog, because a mismatched pair shows "Vibe Visual Editor plugin version mismatch" in the preview.

Versions can't be reused on either registry, even after deleting a release.

## Checklist

1. Run all four suites: `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run test:extension`.
2. Bump `version` in the package's `package.json`, and add an entry to `packages/extension/CHANGELOG.md` for an extension release.
3. Commit, and tag the release as `extension-vX.Y.Z` or `vite-plugin-vX.Y.Z`.

## Extension

```sh
npm run package   # builds through vscode:prepublish and writes packages/extension/vibe-visual-editor.vsix
```

Upload the `.vsix` at https://marketplace.visualstudio.com/manage. That needs only your Microsoft account, no token.

To publish from CI later, use Microsoft Entra workload identity with `vsce publish --azure-credential` (vsce 2.26.1 or later). Global Azure DevOps personal access tokens are retired on 1 December 2026. See [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

The manifest sets `"preview": true`, which shows a Preview badge on the listing. Remove it at 1.0.

## Vite plugin

```sh
npm login
npm publish -w @vibe-visual-editor/vite-plugin   # builds through prepublishOnly; publishConfig makes it public
```

The `@vibe-visual-editor` scope belongs to the npm organization of the same name.

## Icon

`packages/extension/media/icon.png` is rendered from `media/icon-marketplace.svg` by `node packages/extension/scripts/render-icon.mjs`. The Marketplace refuses SVG icons.
