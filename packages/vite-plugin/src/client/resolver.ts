import { ResolveResponseSchema, type ResolveResponse } from '@vibe-visual-editor/protocol';
import { locOf } from './locs';

const NOT_EDITABLE: ResolveResponse = { editable: false, candidates: [] };

/** Cached text -> literal resolution against the dev server's index. */
export class Resolver {
  private cache = new Map<string, Promise<ResolveResponse>>();

  constructor() {
    // The index changes whenever Vite re-transforms a module.
    import.meta.hot?.on('vibe-visual-editor:index-changed', () => this.clear());
    import.meta.hot?.on('vite:afterUpdate', () => this.clear());
  }

  clear(): void {
    this.cache.clear();
  }

  resolve(node: Text): Promise<ResolveResponse> {
    const parent = node.parentElement;
    const elementLoc = parent ? locOf(parent) : undefined;
    const key = `${elementLoc ? `${elementLoc.file}:${elementLoc.start}` : ''}\u0000${node.data}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.fetch(node.data, elementLoc);
      this.cache.set(key, pending);
      pending.catch(() => this.cache.delete(key));
    }
    return pending;
  }

  private async fetch(text: string, elementLoc: ReturnType<typeof locOf>): Promise<ResolveResponse> {
    if (text.trim() === '') return NOT_EDITABLE;
    const res = await fetch('/__vibe-visual-editor/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, elementLoc }),
    });
    if (!res.ok) throw new Error(`resolve failed: HTTP ${res.status}`);
    return ResolveResponseSchema.parse(await res.json());
  }
}
