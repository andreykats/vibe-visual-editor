import type { PendingEdit, Quote } from '@vibe-visual-editor/protocol';

/** One content change, in the coordinates of the document before the change event. */
export interface TextChange {
  offset: number;
  length: number;
  text: string;
}

/** A literal Vibe Visual Editor has touched, tracked through later document changes. */
export interface LedgerEntry {
  /** Literal id from the dev server's index. */
  key: string;
  file: string;
  /** Current range of the literal in the document (UTF-16 offsets). */
  start: number;
  end: number;
  quote: Quote;
  originalRaw: string;
  originalValue: string;
  currentRaw: string;
  /** raw -> value for every non-original text this entry has held. */
  values: Map<string, string>;
}

export interface Op {
  key: string;
  from: string;
  to: string;
}

export const isActive = (e: LedgerEntry): boolean => e.currentRaw !== e.originalRaw;

/**
 * Bookkeeping for the preview's unsaved edits. Pure: the VS Code side feeds it
 * document changes, and it keeps each literal's range and state in step. Any
 * change it can't explain (someone else edited inside the literal) drops the
 * entry rather than guessing.
 */
export class EditLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];

  get(key: string): LedgerEntry | undefined {
    return this.entries.get(key);
  }

  add(entry: LedgerEntry): void {
    this.entries.set(entry.key, entry);
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }

  active(): LedgerEntry[] {
    return this.all().filter(isActive);
  }

  pending(): PendingEdit[] {
    return this.active().map((e) => ({ literalId: e.key, value: e.values.get(e.currentRaw) ?? e.originalValue, original: e.originalValue }));
  }

  /** Forgets entries (and their undo history). Returns the keys removed. */
  remove(predicate: (e: LedgerEntry) => boolean): string[] {
    const removed: string[] = [];
    for (const e of this.all()) {
      if (predicate(e)) {
        this.entries.delete(e.key);
        removed.push(e.key);
      }
    }
    if (removed.length > 0) {
      const gone = new Set(removed);
      this.undoStack = this.undoStack.filter((op) => !gone.has(op.key));
      this.redoStack = this.redoStack.filter((op) => !gone.has(op.key));
    }
    return removed;
  }

  recordEdit(op: Op): void {
    this.undoStack.push(op);
    this.redoStack = [];
  }

  takeUndo(): Op | undefined {
    const op = this.undoStack.pop();
    if (op) this.redoStack.push(op);
    return op;
  }

  takeRedo(): Op | undefined {
    const op = this.redoStack.pop();
    if (op) this.undoStack.push(op);
    return op;
  }

  /**
   * Moves entries in `file` past `changes`. A change that falls inside a
   * literal is accepted only if the literal ends up holding a text this entry
   * has held before (our own edit, undo, redo); otherwise the entry is dropped.
   * Returns the dropped entries, and whether any entry's state changed.
   */
  applyChanges(file: string, changes: readonly TextChange[]): { dropped: LedgerEntry[]; stateChanged: boolean } {
    const dropped: LedgerEntry[] = [];
    let stateChanged = false;
    for (const entry of this.entries.values()) {
      if (entry.file !== file) continue;
      let delta = 0;
      const inner: TextChange[] = [];
      let broken = false;
      for (const c of changes) {
        const cEnd = c.offset + c.length;
        if (cEnd <= entry.start) delta += c.text.length - c.length;
        else if (c.offset >= entry.end) continue;
        else if (c.offset >= entry.start && cEnd <= entry.end) inner.push(c);
        else broken = true;
      }
      if (!broken && inner.length > 0) {
        let text = entry.currentRaw;
        for (const c of [...inner].sort((a, b) => b.offset - a.offset)) {
          const rel = c.offset - entry.start;
          text = text.slice(0, rel) + c.text + text.slice(rel + c.length);
        }
        if (text === entry.originalRaw || entry.values.has(text)) {
          stateChanged ||= text !== entry.currentRaw;
          entry.currentRaw = text;
        } else {
          broken = true;
        }
      }
      if (broken) {
        dropped.push(entry);
        continue;
      }
      entry.start += delta;
      entry.end = entry.start + entry.currentRaw.length;
    }
    if (dropped.length > 0) {
      const keys = new Set(dropped.map((e) => e.key));
      this.remove((e) => keys.has(e.key));
      stateChanged = true;
    }
    return { dropped, stateChanged };
  }
}
