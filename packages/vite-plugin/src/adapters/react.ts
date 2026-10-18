import path from 'node:path';
import type { AstNode, CreationSite, SourceAdapter, Span } from '@vibe-visual-editor/protocol';
import { isNode, walk } from '../ast';
import { rankByOwner } from './rank';

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Props of a component that never hold rendered text. Other string props, like
 * `title` or `label`, often do, so they stay editable.
 */
const NON_TEXT_PROPS = new Set(['key', 'className', 'class', 'style', 'id', 'href', 'src', 'type', 'role', 'htmlFor', 'ref']);

/** `<div>`, `<my-element>`, `<svg:rect>`: written in lowercase, it renders a DOM element. */
function isIntrinsic(name: AstNode): boolean {
  if (name.type === 'JSXIdentifier') return /^[a-z]/.test(name.name as string);
  return name.type === 'JSXNamespacedName';
}

function attributeName(attr: AstNode): string | undefined {
  const name = attr.name as AstNode;
  if (name.type === 'JSXIdentifier') return name.name as string;
  if (name.type === 'JSXNamespacedName') return `${(name.namespace as AstNode).name}:${(name.name as AstNode).name}`;
  return undefined;
}

/**
 * Adapter for JSX: React, Preact and other JSX runtimes that render lowercase
 * tags as DOM elements. Each lowercase JSX element is tagged with a
 * `data-vve-loc` attribute. Its attribute values aren't rendered text, and its
 * text and string children are owned by it. Component props that can carry
 * text (`<Card title="Hi" />`) stay editable.
 */
export function reactAdapter(): SourceAdapter {
  return {
    name: 'react',

    include(id) {
      return SCRIPT.test(id) && !id.includes(`${path.sep}node_modules${path.sep}`);
    },

    analyze({ program }) {
      const creationSites: CreationSite[] = [];
      const excluded: Span[] = [];
      const owners = new Map<number, number>();

      walk(program, (node) => {
        if (node.type !== 'JSXElement') return;
        const opening = node.openingElement as AstNode;
        const name = opening.name as AstNode;
        const intrinsic = isIntrinsic(name);

        for (const attr of opening.attributes as AstNode[]) {
          if (attr.type !== 'JSXAttribute' || !isNode(attr.value)) continue;
          const prop = attributeName(attr);
          if (intrinsic || (prop !== undefined && (NON_TEXT_PROPS.has(prop) || /^(?:data|aria)-/.test(prop)))) {
            excluded.push({ start: attr.value.start, end: attr.value.end });
          }
        }
        if (!intrinsic) return;

        creationSites.push({ start: node.start, end: node.end, attributeAt: name.end });
        for (const child of node.children as AstNode[]) {
          if (child.type === 'JSXText') owners.set(child.start, node.start);
          else if (child.type === 'JSXExpressionContainer' && isNode(child.expression)) {
            const expr = child.expression;
            if ((expr.type === 'Literal' && typeof expr.value === 'string') || expr.type === 'TemplateLiteral') owners.set(expr.start, node.start);
          }
        }
      });
      return { creationSites, excluded, owners };
    },

    rank: rankByOwner,
  };
}
