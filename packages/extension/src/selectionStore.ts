import * as vscode from 'vscode';
import type { ElementDescriptor } from '@vibe-visual-editor/protocol';

export interface Selection {
  descriptor: ElementDescriptor;
  previewUrl: string;
  /** Identifies the panel that made the selection. */
  owner: object;
}

/** The latest element selected in any preview in this window. */
export class SelectionStore implements vscode.Disposable {
  private current: Selection | null = null;
  private readonly emitter = new vscode.EventEmitter<Selection | null>();
  readonly onDidChange = this.emitter.event;

  get(): Selection | null {
    return this.current;
  }

  set(selection: Selection): void {
    this.current = selection;
    this.emitter.fire(selection);
  }

  /** Clears the selection, optionally only if `owner` made it. */
  clear(owner?: object): void {
    if (!this.current || (owner && this.current.owner !== owner)) return;
    this.current = null;
    this.emitter.fire(null);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export function selectionLabel(d: ElementDescriptor): string {
  return `<${d.tag}${d.id ? `#${d.id}` : ''}${d.classList[0] ? `.${d.classList[0]}` : ''}>`;
}
