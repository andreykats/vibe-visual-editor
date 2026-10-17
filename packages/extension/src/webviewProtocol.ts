import * as z from 'zod/mini';
import { ModeSchema, PreviewStatusSchema, type Mode, type PreviewStatus } from '@vibe-visual-editor/protocol';

/** Messages from the preview webview's own script to the extension. */
export const UiMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ui:ready') }),
  z.object({ type: z.literal('ui:frame'), data: z.unknown() }),
  z.object({ type: z.literal('ui:frameLoaded') }),
  z.object({ type: z.literal('ui:pluginMissing') }),
  z.object({ type: z.literal('ui:setMode'), mode: ModeSchema }),
  z.object({ type: z.literal('ui:navigate'), url: z.string().check(z.maxLength(4096)) }),
  z.object({ type: z.literal('ui:reload') }),
  z.object({ type: z.literal('ui:save') }),
  z.object({ type: z.literal('ui:discard') }),
  z.object({ type: z.literal('ui:copySelection') }),
  z.object({ type: z.literal('ui:clearSelection') }),
  z.object({ type: z.literal('ui:openSource') }),
  z.object({ type: z.literal('ui:openDocs') }),
]);
export type UiMessage = z.infer<typeof UiMessageSchema>;

export interface ToolbarState {
  url: string;
  mode: Mode;
  status: PreviewStatus;
  statusDetail?: string;
  pendingCount: number;
  selection: { label: string; where?: string } | null;
}

/** Messages from the extension to the webview script. */
export type HostToWebview =
  | { type: 'host:state'; state: ToolbarState }
  | { type: 'host:toFrame'; data: unknown }
  | { type: 'host:navigate'; url: string }
  | { type: 'host:reload' };

/** Persisted by the webview with setState, handed back on restore. */
export const PersistedStateSchema = z.object({ url: z.string(), mode: ModeSchema });
export type PersistedState = z.infer<typeof PersistedStateSchema>;
export type { PreviewStatus };
