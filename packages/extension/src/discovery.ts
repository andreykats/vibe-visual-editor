import * as vscode from 'vscode';
import { DevServerInfoSchema, parseLoopbackUrl, type DevServerInfo } from '@vibe-visual-editor/protocol';

export interface DevServer extends DevServerInfo {
  running: boolean;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Dev servers that registered `.vibe-visual-editor/server.json` in this workspace. */
export async function discoverDevServers(): Promise<DevServer[]> {
  const files = await vscode.workspace.findFiles('**/.vibe-visual-editor/server.json', '**/node_modules/**', 50);
  const servers: DevServer[] = [];
  for (const file of files) {
    try {
      const parsed = DevServerInfoSchema.safeParse(JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8')));
      if (!parsed.success || !parseLoopbackUrl(parsed.data.url)) continue;
      servers.push({ ...parsed.data, running: isProcessAlive(parsed.data.pid) });
    } catch {
      // Unreadable or half-written; skip it.
    }
  }
  return servers.sort((a, b) => Number(b.running) - Number(a.running));
}
