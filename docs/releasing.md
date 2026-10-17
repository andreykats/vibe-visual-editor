# Releasing

Two things are published:

- the VS Code extension `andreykats.vibe-visual-editor`, to the Visual Studio Marketplace
- the Vite plugin `@vibe-visual-editor/vite-plugin`, to npm

The other packages are internal and stay `private`. `protocol` is inlined into both published packages, and `mcp-bridge` is bundled into the extension.

## Versions

The two packages are versioned independently. They talk to each other over a wire protocol whose number is `PROTOCOL_VERSION` in `packages/protocol/src/version.ts`. When it changes, release both packages together and say so in the extension's changelog, because a mismatched pair shows "Vibe Visual Editor plugin version mismatch" in the preview.

Versions can't be reused on either registry, even after deleting a release.

## Releasing a version

Releases run in GitHub Actions ([`release.yml`](../.github/workflows/release.yml)) when you push a tag.

1. Bump `version` in the package's `package.json`.
   - **Extension:** also add a `## X.Y.Z` section to `packages/extension/CHANGELOG.md`. It becomes the GitHub Release notes, and the release fails without it.
2. Commit and push to `main`, and wait for CI to pass.
3. Tag the commit and push the tag:

   ```sh
   git tag extension-v0.1.1     # or vite-plugin-v0.1.1
   git push origin extension-v0.1.1
   ```

The workflow then:

1. checks that the tag matches the package version (`scripts/release-tag.mjs`)
2. runs the full test suite (`ci.yml`)
3. publishes:
   - the extension with `vsce publish --oidc`
   - the plugin with `npm publish` (provenance is added automatically)
4. creates a GitHub Release. Extension releases have the `.vsix` attached.

Both registries use **trusted publishing**: GitHub Actions proves which repository and workflow is publishing, and no token is stored anywhere.

## One-time setup

Trusted publishing is configured on each registry and names this repository and workflow:

| Field | Value |
|---|---|
| Owner | `andreykats` |
| Repository | `vibe-visual-editor` |
| Workflow | `release.yml` |
| Environment | (none) |

- **npm:** on https://www.npmjs.com/package/@vibe-visual-editor/vite-plugin, go to **Settings → Trusted Publisher → GitHub Actions** and enter the values above, with **Allow `npm publish`** checked (the workflow runs `npm publish`, not `npm stage publish`). Also set **Publishing access** to "Require two-factor authentication and disallow bypass 2fa tokens". npm states that trusted publishers keep working with every publishing-access option. See [npm: trusted publishers](https://docs.npmjs.com/trusted-publishers).
- **Marketplace:** on https://marketplace.visualstudio.com/manage, add a trusted publishing policy for the `andreykats` publisher with the values above. See the "Trusted publishing" section of the [vsce README](https://github.com/microsoft/vscode-vsce#trusted-publishing).

If the Marketplace policy isn't available to your publisher, the supported alternative is Microsoft Entra workload identity. Log in with `azure/login@v3` and a user-assigned managed identity that is a Contributor on the publisher, then run `vsce publish --azure-credential`. See [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). Azure DevOps personal access tokens are retired on 1 December 2026.

## Manual fallback

- **Extension:** run `npm run package` and upload `packages/extension/vibe-visual-editor.vsix` at https://marketplace.visualstudio.com/manage.
- **Plugin:** run `npm publish -w @vibe-visual-editor/vite-plugin` in a terminal. It asks you to approve in the browser (two-factor). npm only offers the browser approval in an interactive terminal.

The manifest sets `"preview": true`, which shows a Preview badge on the Marketplace listing. Remove it at 1.0.

## Icon

`packages/extension/media/icon.png` is rendered from `media/icon-marketplace.svg` by `node packages/extension/scripts/render-icon.mjs`. The Marketplace refuses SVG icons.
