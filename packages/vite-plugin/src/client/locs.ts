import type { SourceLoc } from '@vibe-visual-editor/protocol';

const KEY = Symbol.for('vibe-visual-editor.locs');

function map(): WeakMap<object, SourceLoc> {
  const g = globalThis as unknown as Record<symbol, WeakMap<object, SourceLoc> | undefined>;
  return (g[KEY] ??= new WeakMap());
}

/** Creation site recorded by the plugin's `__le` wrapper. */
export function locOf(el: Element): SourceLoc | undefined {
  return map().get(el);
}

/** The element's own creation site, or the nearest tagged ancestor's. */
export function nearestLoc(el: Element): { loc: SourceLoc; isAncestor: boolean } | undefined {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const loc = map().get(cur);
    if (loc) return { loc, isAncestor: cur !== el };
  }
  return undefined;
}
