import * as vscode from 'vscode';
import { parseLoopbackUrl, type Mode } from '@vibe-visual-editor/protocol';

export const EXTENSION_ID = 'andreykats.vibe-visual-editor';

/**
 * The one place a dev server URL becomes the iframe URL. Locally this is the
 * URL itself; in remote workspaces `asExternalUri` sets up port forwarding.
 */
export async function frameUrlFor(url: string): Promise<string> {
  const parsed = parseLoopbackUrl(url);
  if (!parsed) throw new Error(`Not a loopback http(s) URL: ${url}`);
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(parsed.href));
  // asExternalUri drops the fragment on some platforms; keep the app's hash route.
  const result = new URL(external.toString(true));
  if (!result.hash && parsed.hash) result.hash = parsed.hash;
  return result.href;
}

/** `vscode://andreykats.vibe-visual-editor/open?url=…` link that opens the preview. */
export function openLink(url: string, mode?: Mode): string {
  const query = new URLSearchParams({ url });
  if (mode) query.set('mode', mode);
  return `${vscode.env.uriScheme}://${EXTENSION_ID}/open?${query.toString()}`;
}
