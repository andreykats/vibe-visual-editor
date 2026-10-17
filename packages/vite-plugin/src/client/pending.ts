import type { Candidate, PendingEdit } from '@vibe-visual-editor/protocol';
import { textNodesIn } from './dom';
import type { Resolver } from './resolver';

const HIGHLIGHT = 'vibe-visual-editor-pending';

interface Entry extends PendingEdit {
  candidate?: Candidate;
  nodes: Set<Text>;
}

/**
 * Unsaved edits as shown in the page. The extension owns the truth and sends
 * the full set (`le:pending`); this class keeps rendered text nodes in line
 * with it, including nodes the app re-creates on re-render.
 */
export class PendingEdits {
  private readonly entries = new Map<string, Entry>();
  /** Original value -> literal ids with that original, for matching re-rendered nodes. */
  private readonly byOriginal = new Map<string, Set<string>>();
  private readonly literalOfNode = new WeakMap<Text, string>();
  private readonly observer: MutationObserver;
  private readonly highlight: Highlight | null;

  constructor(
    private readonly resolver: Resolver,
    private readonly ignore: Element,
  ) {
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.highlight = typeof Highlight === 'function' && 'highlights' in CSS ? new Highlight() : null;
    if (this.highlight) {
      CSS.highlights.set(HIGHLIGHT, this.highlight);
      const style = document.createElement('style');
      style.textContent = `::highlight(${HIGHLIGHT}) { text-decoration: underline dotted #f59e0b 2px; text-underline-offset: 3px; }`;
      document.head.appendChild(style);
    }
  }

  start(): void {
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  get count(): number {
    return this.entries.size;
  }

  literalOf(node: Text): string | undefined {
    const id = this.literalOfNode.get(node);
    return id && this.entries.has(id) ? id : undefined;
  }

  candidateOf(literalId: string): Candidate | undefined {
    return this.entries.get(literalId)?.candidate;
  }

  /** Records that `node` now shows the pending value of `candidate`. */
  track(node: Text, candidate: Candidate, value: string): void {
    const entry = this.ensure({ literalId: candidate.id, value, original: candidate.value });
    entry.candidate = candidate;
    entry.value = value;
    this.attach(entry, node);
    this.render();
  }

  /** Replaces the pending set with the extension's. Removed edits are reverted in the page. */
  sync(edits: PendingEdit[]): void {
    const next = new Map(edits.map((e) => [e.literalId, e]));
    for (const [id, entry] of this.entries) {
      if (!next.has(id)) {
        for (const node of entry.nodes) if (node.data === entry.value) this.write(node, entry.original);
        this.drop(id);
      }
    }
    const added: Entry[] = [];
    for (const edit of edits) {
      const known = this.entries.has(edit.literalId);
      const entry = this.ensure(edit);
      entry.value = edit.value;
      for (const node of entry.nodes) if (node.data !== edit.value) this.write(node, edit.value);
      if (!known) added.push(entry);
    }
    if (added.length > 0) this.adopt(textNodesIn(document.body, this.ignore));
    this.render();
  }

  /** The edits were saved: stop tracking without touching the text, which is now the source's. */
  forget(literalIds: readonly string[]): void {
    for (const id of literalIds) this.drop(id);
    this.render();
  }

  private ensure(edit: PendingEdit): Entry {
    let entry = this.entries.get(edit.literalId);
    if (!entry) {
      entry = { ...edit, nodes: new Set() };
      this.entries.set(edit.literalId, entry);
      let ids = this.byOriginal.get(edit.original);
      if (!ids) this.byOriginal.set(edit.original, (ids = new Set()));
      ids.add(edit.literalId);
    }
    return entry;
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const ids = this.byOriginal.get(entry.original);
    ids?.delete(id);
    if (ids?.size === 0) this.byOriginal.delete(entry.original);
  }

  private attach(entry: Entry, node: Text): void {
    entry.nodes.add(node);
    this.literalOfNode.set(node, entry.literalId);
    if (node.data !== entry.value) this.write(node, entry.value);
  }

  private write(node: Text, data: string): void {
    node.data = data;
  }

  /** Text nodes showing an original value: resolve them and re-apply the pending value if they are that literal. */
  private adopt(nodes: Text[]): void {
    for (const node of nodes) {
      const ids = this.byOriginal.get(node.data);
      if (!ids || this.literalOfNode.has(node)) continue;
      this.resolver
        .resolve(node)
        .then((res) => {
          const match = res.candidates.find((c) => ids.has(c.id));
          const entry = match && this.entries.get(match.id);
          if (!entry || node.data !== entry.original) return;
          entry.candidate ??= match;
          this.attach(entry, node);
          this.render();
        })
        .catch(() => {});
    }
  }

  private onMutations(records: MutationRecord[]): void {
    if (this.entries.size === 0) return;
    const fresh: Text[] = [];
    let changed = false;
    for (const r of records) {
      if (this.ignore.contains(r.target)) continue;
      if (r.type === 'characterData') {
        const node = r.target as Text;
        const id = this.literalOfNode.get(node);
        const entry = id ? this.entries.get(id) : undefined;
        if (entry && node.data === entry.original) this.write(node, entry.value);
        else if (!entry) fresh.push(node);
      } else {
        for (const added of r.addedNodes) fresh.push(...textNodesIn(added, this.ignore));
        if (r.removedNodes.length > 0) changed = true;
      }
    }
    if (fresh.length > 0) this.adopt(fresh);
    if (changed) this.render();
  }

  /** Prunes detached nodes and redraws the "unsaved" underline. */
  private render(): void {
    if (!this.highlight) return;
    this.highlight.clear();
    for (const entry of this.entries.values()) {
      for (const node of entry.nodes) {
        if (!node.isConnected) {
          entry.nodes.delete(node);
          continue;
        }
        const range = new Range();
        range.selectNodeContents(node);
        this.highlight.add(range);
      }
    }
  }
}
