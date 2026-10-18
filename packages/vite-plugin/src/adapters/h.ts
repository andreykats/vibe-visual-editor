import path from 'node:path';
import type { AstNode, SourceAdapter, Span } from '@vibe-visual-editor/protocol';
import { isNode, nameOf, walk } from '../ast';
import { resolveImportBase, stripScriptExt } from '../paths';
import { rankByOwner } from './rank';

export interface HAdapterOptions {
  /** Exported name of the element factory, e.g. `h`. */
  factory: string;
  /** Root-relative path of the module that exports it, e.g. `/src/ui/dom.ts`. */
  from: string;
}

const SCRIPT = /\.(?:[cm]?[jt]s)$/;

/**
 * Adapter for `factory(tag, attrs?, ...children)` element builders. Calls are
 * creation sites; the tag and attrs arguments are not text; string children
 * are owned by their call.
 */
export function hAdapter(options: HAdapterOptions): SourceAdapter {
  if (!/^[A-Za-z_$][\w$]*$/.test(options.factory)) throw new Error(`hAdapter: invalid factory name ${JSON.stringify(options.factory)}`);
  return {
    name: `h(${options.factory})`,

    include(id) {
      return SCRIPT.test(id) && !id.includes(`${path.sep}node_modules${path.sep}`);
    },

    analyze({ id, root, program }) {
      const factoryModule = stripScriptExt(path.join(root, options.from));
      const locals = new Set<string>();
      const namespaces = new Set<string>();
      for (const stmt of program.body as AstNode[]) {
        if (stmt.type !== 'ImportDeclaration' || !isNode(stmt.source)) continue;
        if (resolveImportBase(stmt.source.value as string, id, root) !== factoryModule) continue;
        for (const spec of stmt.specifiers as AstNode[]) {
          if (spec.type === 'ImportSpecifier' && nameOf(spec.imported) === options.factory) locals.add(nameOf(spec.local)!);
          if (spec.type === 'ImportNamespaceSpecifier') namespaces.add(nameOf(spec.local)!);
        }
      }

      const creationSites: Span[] = [];
      const excluded: Span[] = [];
      const owners = new Map<number, number>();
      if (locals.size === 0 && namespaces.size === 0) return { creationSites, excluded, owners };

      const isFactory = (callee: AstNode): boolean => {
        if (callee.type === 'Identifier') return locals.has(callee.name as string);
        if (callee.type === 'MemberExpression' && !callee.computed && isNode(callee.object) && callee.object.type === 'Identifier') {
          return namespaces.has(callee.object.name as string) && nameOf(callee.property) === options.factory;
        }
        return false;
      };

      walk(program, (node) => {
        if (node.type !== 'CallExpression' || node.optional || !isFactory(node.callee as AstNode)) return;
        creationSites.push({ start: node.start, end: node.end });
        const args = node.arguments as AstNode[];
        if (args[0]) excluded.push({ start: args[0].start, end: args[0].end });
        if (args[1]?.type === 'ObjectExpression') excluded.push({ start: args[1].start, end: args[1].end });
        for (const child of args.slice(2)) {
          if ((child.type === 'Literal' && typeof child.value === 'string') || child.type === 'TemplateLiteral') {
            owners.set(child.start, node.start);
          }
        }
      });
      return { creationSites, excluded, owners };
    },

    rank: rankByOwner,
  };
}
