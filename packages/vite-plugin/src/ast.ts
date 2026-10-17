import { visitorKeys } from 'oxc-parser';
import type { AstNode } from '@vibe-visual-editor/protocol';

const keysFor = visitorKeys as Record<string, readonly string[] | undefined>;

export function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Depth-first walk. `ancestors` is the live stack of enclosing nodes (nearest
 * last) and `key` is the property of the parent that holds `node`. Return
 * `false` from `enter` to skip a subtree.
 */
export function walk(
  root: AstNode,
  enter: (node: AstNode, ancestors: readonly AstNode[], key: string) => void | false,
): void {
  const ancestors: AstNode[] = [];
  const visit = (node: AstNode, key: string): void => {
    if (enter(node, ancestors, key) === false) return;
    const keys = keysFor[node.type] ?? Object.keys(node);
    ancestors.push(node);
    for (const k of keys) {
      const child = node[k];
      if (Array.isArray(child)) {
        for (const c of child) if (isNode(c)) visit(c, k);
      } else if (isNode(child)) {
        visit(child, k);
      }
    }
    ancestors.pop();
  };
  visit(root, '');
}

/** Name of an identifier or string-literal node (as used by import/export specifiers). */
export function nameOf(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Identifier') return node.name as string;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

/** Sorted offsets of line starts, for offset -> line/column conversion. */
export function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (code.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** 1-based line and column for a UTF-16 offset. */
export function positionAt(starts: readonly number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}
