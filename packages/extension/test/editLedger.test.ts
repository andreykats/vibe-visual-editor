import { describe, expect, it } from 'vitest';
import { EditLedger, isActive, type LedgerEntry } from '../src/editLedger';

function entry(start: number, raw = "'Videos'", key = 'k'): LedgerEntry {
  return { key, file: '/f.ts', start, end: start + raw.length, quote: "'", originalRaw: raw, originalValue: raw.slice(1, -1), currentRaw: raw, values: new Map() };
}

describe('EditLedger', () => {
  it('tracks our own replacement and undo/redo of it', () => {
    const l = new EditLedger();
    const e = entry(10);
    e.values.set("'Clips'", 'Clips');
    l.add(e);
    expect(l.applyChanges('/f.ts', [{ offset: 10, length: 8, text: "'Clips'" }]).stateChanged).toBe(true);
    expect(isActive(e)).toBe(true);
    expect(e.end).toBe(17);
    expect(l.pending()).toEqual([{ literalId: 'k', value: 'Clips', original: 'Videos' }]);
    // Undo restores the original: inactive, still tracked.
    l.applyChanges('/f.ts', [{ offset: 10, length: 7, text: "'Videos'" }]);
    expect(isActive(e)).toBe(false);
    expect(l.pending()).toEqual([]);
    expect(l.get('k')).toBe(e);
  });

  it('accepts minimized diffs inside the literal', () => {
    const l = new EditLedger();
    const e = entry(0);
    e.values.set("'Vids'", 'Vids');
    l.add(e);
    // 'Videos' -> 'Vids': VS Code may report only the changed middle.
    l.applyChanges('/f.ts', [{ offset: 4, length: 2, text: '' }]);
    expect(e.currentRaw).toBe("'Vids'");
  });

  it('shifts ranges for changes before, and ignores changes after', () => {
    const l = new EditLedger();
    const e = entry(10);
    l.add(e);
    l.applyChanges('/f.ts', [
      { offset: 30, length: 0, text: 'after' },
      { offset: 0, length: 2, text: 'abcd' },
      { offset: 10, length: 0, text: 'X' }, // insertion right at the start counts as before
    ]);
    expect([e.start, e.end]).toEqual([13, 21]);
    l.applyChanges('/f.ts', [{ offset: 21, length: 0, text: 'Y' }]); // insertion at the end counts as after
    expect([e.start, e.end]).toEqual([13, 21]);
  });

  it('drops an entry when someone else edits inside or across it', () => {
    const l = new EditLedger();
    l.add(entry(10, "'Videos'", 'a'));
    l.add(entry(40, "'Other'", 'b'));
    const inside = l.applyChanges('/f.ts', [{ offset: 12, length: 1, text: 'Z' }]);
    expect(inside.dropped.map((e) => e.key)).toEqual(['a']);
    const across = l.applyChanges('/f.ts', [{ offset: 35, length: 10, text: '' }]);
    expect(across.dropped.map((e) => e.key)).toEqual(['b']);
    expect(l.all()).toEqual([]);
  });

  it('ignores other files', () => {
    const l = new EditLedger();
    const e = entry(10);
    l.add(e);
    l.applyChanges('/other.ts', [{ offset: 0, length: 0, text: 'xxxx' }]);
    expect(e.start).toBe(10);
  });

  it('keeps undo and redo stacks, and forgets ops for removed entries', () => {
    const l = new EditLedger();
    l.add(entry(0, "'a'", 'a'));
    l.add(entry(10, "'b'", 'b'));
    l.recordEdit({ key: 'a', from: "'a'", to: "'A'" });
    l.recordEdit({ key: 'b', from: "'b'", to: "'B'" });
    expect(l.takeUndo()?.key).toBe('b');
    expect(l.takeRedo()?.key).toBe('b');
    l.remove((e) => e.key === 'b');
    expect(l.takeUndo()?.key).toBe('a');
    expect(l.takeUndo()).toBeUndefined();
    l.recordEdit({ key: 'a', from: "'A'", to: "'AA'" });
    expect(l.takeRedo()).toBeUndefined();
  });
});
