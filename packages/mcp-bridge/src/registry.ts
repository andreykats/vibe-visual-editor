import { readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { WindowEntrySchema, type WindowEntry } from '@vibe-visual-editor/protocol';

export function registryDir(): string {
  return path.join(process.env.VIBE_VISUAL_EDITOR_HOME ?? path.join(homedir(), '.vibe-visual-editor'), 'windows');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Valid entries for VS Code windows that are still running. Removes entries left by windows that died. */
export function readWindows(dir = registryDir()): WindowEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const entries: WindowEntry[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let parsed;
    try {
      parsed = WindowEntrySchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      continue; // being written right now, or garbage
    }
    if (!parsed.success) continue;
    if (!alive(parsed.data.pid)) {
      rmSync(file, { force: true });
      continue;
    }
    entries.push(parsed.data);
  }
  return entries;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function contains(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface Route {
  entry: WindowEntry;
  /** True when a workspace folder contains `cwd`; false when we fell back to the last focused window. */
  matched: boolean;
}

/**
 * The window whose workspace contains `cwd` (deepest folder wins, then the
 * most recently focused), else the most recently focused window.
 */
export function pickWindow(entries: readonly WindowEntry[], cwd: string): Route | null {
  const target = real(cwd);
  let best: { entry: WindowEntry; depth: number } | null = null;
  for (const entry of entries) {
    for (const folder of entry.workspaceFolders) {
      const f = real(folder);
      if (!contains(f, target)) continue;
      const depth = f.split(path.sep).length;
      if (!best || depth > best.depth || (depth === best.depth && entry.focusedAt > best.entry.focusedAt)) best = { entry, depth };
    }
  }
  if (best) return { entry: best.entry, matched: true };
  const recent = [...entries].sort((a, b) => b.focusedAt - a.focusedAt)[0];
  return recent ? { entry: recent, matched: false } : null;
}
