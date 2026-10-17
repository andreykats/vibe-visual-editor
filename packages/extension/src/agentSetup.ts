import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';

const SERVER_NAME = 'vibe-visual-editor';
const CODEX_APP_CLI = '/Applications/ChatGPT.app/Contents/Resources/codex';

export function launcherPath(): string {
  return path.join(process.env.VIBE_VISUAL_EDITOR_HOME ?? path.join(homedir(), '.vibe-visual-editor'), 'bin', 'vibe-visual-editor-mcp.mjs');
}

/**
 * Copies the bundled MCP bridge to a stable path, so agent configs keep
 * working across extension updates. Only rewrites it when the bundle changed.
 */
export async function installLauncher(extensionUri: vscode.Uri): Promise<string> {
  const source = vscode.Uri.joinPath(extensionUri, 'dist', 'mcp-bridge.mjs').fsPath;
  const target = launcherPath();
  const [next, current] = await Promise.all([readFile(source), readFile(target).catch(() => null)]);
  if (!current || !next.equals(current)) {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
    await chmod(target, 0o700);
  }
  return target;
}

function run(file: string, args: string[], timeoutMs = 30_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, env: process.env }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}`.trim() });
    });
  });
}

/** Resolves a command on the user's login-shell PATH (VS Code's own PATH can be minimal when launched from the Dock). */
async function which(command: string): Promise<string | undefined> {
  if (process.platform === 'win32') {
    const r = await run('where', [command]);
    return r.code === 0 ? r.out.split(/\r?\n/)[0] : undefined;
  }
  const shell = process.env.SHELL || '/bin/zsh';
  const r = await run(shell, ['-lc', `command -v ${command}`]);
  const found = r.out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('/'));
  return r.code === 0 ? found : undefined;
}

interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** `node <launcher>`; without Node on PATH, VS Code's own Electron binary running as Node. */
async function launchSpec(launcher: string): Promise<Launch> {
  const node = await which('node');
  if (node) return { command: node, args: [launcher], env: {} };
  return { command: process.execPath, args: [launcher], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

interface Agent {
  name: string;
  cli: string | undefined;
  add(l: Launch): string[];
  remove: string[];
  list: string[];
}

async function agents(): Promise<Agent[]> {
  const codex = (await which('codex')) ?? (existsSync(CODEX_APP_CLI) ? CODEX_APP_CLI : undefined);
  const envArgs = (flag: string, env: Record<string, string>) => Object.entries(env).flatMap(([k, v]) => [flag, `${k}=${v}`]);
  return [
    {
      name: 'Claude Code',
      cli: await which('claude'),
      add: (l) => ['mcp', 'add', '--scope', 'user', ...envArgs('-e', l.env), SERVER_NAME, '--', l.command, ...l.args],
      remove: ['mcp', 'remove', '--scope', 'user', SERVER_NAME],
      list: ['mcp', 'list'],
    },
    {
      name: 'Codex',
      cli: codex,
      add: (l) => ['mcp', 'add', ...envArgs('--env', l.env), SERVER_NAME, '--', l.command, ...l.args],
      remove: ['mcp', 'remove', SERVER_NAME],
      list: ['mcp', 'list'],
    },
  ];
}

const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** `Vibe Visual Editor: Configure Claude Code and Codex`: registers the MCP bridge with both agents and verifies it. */
export async function configureAgents(extensionUri: vscode.Uri, log: vscode.LogOutputChannel): Promise<void> {
  const launcher = await installLauncher(extensionUri);
  const spec = await launchSpec(launcher);
  const list = await agents();
  const commands = list.map((a) => [a.cli ?? (a.name === 'Codex' ? 'codex' : 'claude'), ...a.add(spec)].map(quote).join(' '));

  const choice = await vscode.window.showInformationMessage(
    'Vibe Visual Editor will register its MCP server with Claude Code (user scope) and Codex.',
    { modal: true, detail: commands.join('\n\n') },
    'Run now',
    'Copy commands',
  );
  if (choice === 'Copy commands') {
    await vscode.env.clipboard.writeText(commands.join('\n'));
    void vscode.window.showInformationMessage('Vibe Visual Editor: commands copied.');
    return;
  }
  if (choice !== 'Run now') return;

  log.show(true);
  const results: string[] = [];
  for (const agent of list) {
    if (!agent.cli) {
      log.warn(`${agent.name}: CLI not found on PATH; skipped.`);
      results.push(`${agent.name}: not installed`);
      continue;
    }
    // Re-adding replaces a stale registration (e.g. an old launcher path).
    await run(agent.cli, agent.remove);
    const added = await run(agent.cli, agent.add(spec));
    log.info(`${agent.name} add (exit ${added.code}): ${added.out}`);
    const listed = await run(agent.cli, agent.list, 60_000);
    const ok = added.code === 0 && listed.out.includes(SERVER_NAME);
    log.info(`${agent.name} mcp list:\n${listed.out}`);
    results.push(`${agent.name}: ${ok ? 'configured' : 'FAILED (see the Vibe Visual Editor output)'}`);
  }
  void vscode.window.showInformationMessage(`Vibe Visual Editor: ${results.join('; ')}. Start a new agent session to pick it up.`);
}
