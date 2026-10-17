import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WindowEntry } from '@vibe-visual-editor/protocol';
import { pickWindow, readWindows } from '../src/registry';

const win = (pid: number, folders: string[], focusedAt = 0): WindowEntry => ({
  pid,
  port: 4000 + (pid % 1000),
  token: 'f'.repeat(64),
  workspaceFolders: folders,
  focusedAt,
  protocolVersion: 1,
});

describe('pickWindow', () => {
  const a = win(1, ['/work/app'], 10);
  const b = win(2, ['/work'], 20);
  const c = win(3, ['/elsewhere'], 30);

  it('routes to the window whose folder contains cwd, deepest first', () => {
    expect(pickWindow([a, b, c], '/work/app/src')).toEqual({ entry: a, matched: true });
    expect(pickWindow([a, b, c], '/work/other')).toEqual({ entry: b, matched: true });
    expect(pickWindow([a, b, c], '/work/app')).toEqual({ entry: a, matched: true });
  });

  it('does not treat a sibling with a shared prefix as containing', () => {
    expect(pickWindow([a], '/work/application')).toEqual({ entry: a, matched: false });
  });

  it('breaks ties by focus and falls back to the most recently focused window', () => {
    const a2 = win(4, ['/work/app'], 99);
    expect(pickWindow([a, a2], '/work/app')!.entry).toBe(a2);
    expect(pickWindow([a, b, c], '/nowhere')).toEqual({ entry: c, matched: false });
    expect(pickWindow([], '/x')).toBeNull();
  });
});

describe('readWindows', () => {
  it('returns live, valid entries and deletes entries of dead windows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'le-reg-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'live.json'), JSON.stringify(win(process.pid, ['/w'])));
    const deadFile = path.join(dir, 'dead.json');
    writeFileSync(deadFile, JSON.stringify(win(2 ** 22 + 12345, ['/w'])));
    writeFileSync(path.join(dir, 'garbage.json'), '{not json');
    writeFileSync(path.join(dir, 'invalid.json'), JSON.stringify({ pid: 'x' }));
    const entries = readWindows(dir);
    expect(entries.map((e) => e.pid)).toEqual([process.pid]);
    expect(existsSync(deadFile)).toBe(false);
  });

  it('returns nothing when the directory does not exist', () => {
    expect(readWindows('/definitely/not/here')).toEqual([]);
  });
});
