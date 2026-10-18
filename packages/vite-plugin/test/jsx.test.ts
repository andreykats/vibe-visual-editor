import { cookJsxAttribute, cookJsxText, jsxAttributeRaw, jsxTextRaw } from '@vibe-visual-editor/protocol';
import { parseSync } from 'oxc-parser';
import { transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';
import { reactAdapter } from '../src/adapters/react';
import { SourceIndex } from '../src/sourceIndex';

/** What Vite's JSX transform passes as the `children` or `prop` string of `jsx`. */
async function compiled(jsx: string, prop: string): Promise<string | undefined> {
  const { code } = await transformWithOxc(`export default ${jsx};`, 'probe.tsx', { jsx: { runtime: 'automatic' } });
  let found: string | undefined;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; key?: { name?: string }; value?: { type?: string; value?: unknown } };
    if (n.type === 'Property' && n.key?.name === prop && n.value?.type === 'Literal' && typeof n.value.value === 'string') found = n.value.value;
    for (const child of Object.values(node)) Array.isArray(child) ? child.forEach(visit) : visit(child);
  };
  visit(parseSync('out.js', code).program);
  return found;
}

const TEXT_SOURCES = [
  'Hello',
  ' Hello ',
  'Hello  there',
  '\n    Hello\n    world  \n  ',
  '\n\t\tTabbed indent\n\t',
  'Tom &amp; Jerry',
  '&#123;x&#x7D; &lt;b&gt; &nbsp;&copy; &hellip;',
  'AT&T & co',
  'a\u00a0b',
  '🎉 émoji',
  '\r\n  Windows\r\n  lines\r\n',
];

const VALUES = ['Hello', ' spaced ', 'a {b} <c>', 'Tom & Jerry', 'AT&T &amp; co', 'quote " and \'', 'two\nlines', 'tab\there', '🎉', 'x'];

describe('JSX text matches the compiler', () => {
  it.each(TEXT_SOURCES)('cooks %j like oxc', async (raw) => {
    const cooked = cookJsxText(raw);
    expect(cooked).not.toBeNull();
    expect(await compiled(`<p>${raw}</p>`, 'children')).toBe(cooked);
  });

  it.each(VALUES)('writes %j back so it compiles to the same string', async (value) => {
    for (const original of ['Old', '\n      Old text\n    ']) {
      const raw = jsxTextRaw(value, original);
      expect(await compiled(`<p>${raw}</p>`, 'children'), raw).toBe(value);
    }
  });

  it.each(['plain', 'a &amp; b', 'C:\\path\\n', "it's"])('cooks attribute %j like oxc', async (inner) => {
    const quote = inner.includes("'") ? '"' : "'";
    expect(await compiled(`<Card title=${quote}${inner}${quote} />`, 'title')).toBe(cookJsxAttribute(inner));
  });

  it.each(VALUES)('writes attribute %j back so it compiles to the same string', async (value) => {
    const raw = jsxAttributeRaw(value, '"Old"');
    expect(await compiled(`<Card title=${raw} />`, 'title'), raw).toBe(value);
  });
});

const root = '/proj';
const file = (name: string) => `${root}/src/${name}`;
const analyze = (code: string) => new SourceIndex(root, [reactAdapter()]).analyzeDetached(file('App.tsx'), code);

describe('reactAdapter', () => {
  const code = `import { Card } from './Card';
export const App = () => (
  <main className="app">
    <h1 title="Tooltip">Welcome</h1>
    <Card title="Card title" className="wide" key="k" data-x="d" aria-label="a">Body</Card>
    <p>{'In braces'} and {name}</p>
    <>Fragment text</>
  </main>
);`;

  it('indexes JSX text, text props and string children, not attributes or whitespace', () => {
    const lits = analyze(code);
    expect(lits.map((l) => [l.value, l.quote])).toEqual([
      ['Welcome', 'jsx'],
      ['Card title', 'jsx-attr'],
      ['Body', 'jsx'],
      ['In braces', "'"],
      [' and ', 'jsx'],
      ['Fragment text', 'jsx'],
    ]);
    for (const l of lits) expect(code.slice(l.start, l.end)).toBe(l.raw);
  });

  it('tags lowercase elements with an attribute after the tag name, and owns their direct children', () => {
    const index = new SourceIndex(root, [reactAdapter()]);
    const analysis = index.update(file('App.tsx'), code)!;
    const tags = analysis.creationSites.map((s) => code.slice(s.start, s.attributeAt));
    expect(tags).toEqual(['<main', '<h1', '<p']);
    const h1 = analysis.creationSites[1]!;
    const lits = analysis.record.literals;
    expect(lits.find((l) => l.value === 'Welcome')!.owner).toBe(h1.start);
    expect(lits.find((l) => l.value === 'Body')!.owner).toBeUndefined();
    expect(lits.find((l) => l.value === 'In braces')!.owner).toBe(analysis.creationSites[2]!.start);
  });

  it('keeps the import after a directive prologue', () => {
    const analysis = new SourceIndex(root, [reactAdapter()]).update(file('Client.tsx'), `'use client';\nexport const X = () => <p>Hi</p>;`)!;
    expect(analysis.headerAt).toBe("'use client';".length);
  });

  it("doesn't offer text it can't map with certainty", () => {
    expect(analyze('const x = <p>a\tb &unknown; {1}</p>;')).toEqual([]);
  });

  it('ranks the clicked element\'s own text first', () => {
    const index = new SourceIndex(root, [reactAdapter()]);
    const a = index.update(file('A.tsx'), 'export const A = () => <div><h2>Same</h2><p>Same</p></div>;')!;
    const h2 = a.creationSites[1]!;
    const res = index.resolve({ text: 'Same', elementLoc: h2 });
    expect(res.candidates.map((c) => c.owner)).toEqual([h2.start]);
  });
});
