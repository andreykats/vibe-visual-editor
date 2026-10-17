import { describe, expect, it } from 'vitest';
import { hAdapter } from '../src/adapters/h';
import { SourceIndex } from '../src/sourceIndex';

const root = '/proj';
const adapter = hAdapter({ factory: 'h', from: '/src/ui/dom.ts' });
const file = (name: string) => `${root}/src/${name}`;

function indexOf(files: Record<string, string>): SourceIndex {
  const index = new SourceIndex(root, [adapter]);
  for (const [name, code] of Object.entries(files)) index.update(file(name), code);
  return index;
}

const values = (index: SourceIndex, name: string, code: string) => index.analyzeDetached(file(name), code).map((l) => l.value);

describe('literal indexing', () => {
  const index = new SourceIndex(root, [adapter]);

  it('indexes every quote kind with exact offsets, raw text and line/column', () => {
    const code = `const a = 'one';\nconst b = "two";\nconst c = \`three\`;\nconst d = \`no \${a}\`;`;
    const lits = index.analyzeDetached(file('x.ts'), code);
    expect(lits.map((l) => [l.value, l.quote, l.raw, l.line, l.column])).toEqual([
      ['one', "'", "'one'", 1, 11],
      ['two', '"', '"two"', 2, 11],
      ['three', '`', '`three`', 3, 11],
    ]);
    for (const l of lits) expect(code.slice(l.start, l.end)).toBe(l.raw);
  });

  it('records cooked values for escapes and UTF-16 offsets after astral characters', () => {
    const code = `const e = '🎉'; const f = 'it\\'s \\u00e9';`;
    const [e, f] = index.analyzeDetached(file('x.ts'), code);
    expect(e!.value).toBe('🎉');
    expect(f!.value).toBe("it's é");
    expect(code.slice(f!.start, f!.end)).toBe("'it\\'s \\u00e9'");
  });

  it('ignores comments and code-looking strings inside other strings', () => {
    const code = `// h('p', {}, 'commented')\n/* 'block' */\nconst s = "h('p', {}, 'inner')";`;
    expect(values(index, 'x.ts', code)).toEqual(["h('p', {}, 'inner')"]);
  });

  it('skips imports, exports, keys, types, directives, enums and tagged templates', () => {
    const code = [
      `'use strict';`,
      `import x from './mod';`,
      `export * from './other';`,
      `type T = 'literal-type';`,
      `enum E { A = 'enum-value' }`,
      `const o = { 'key': 'value', ['computed']: 1 };`,
      `const t = tag\`tagged\`;`,
      `const r = require('req');`,
      `const lazy = import('./lazy');`,
    ].join('\n');
    expect(values(index, 'x.ts', code)).toEqual(['value', 'computed']);
  });
});

describe('h() adapter', () => {
  const view = `import { h } from '../ui/dom';
const p = (text: string) => h('p', { class: 'lead' }, text);
export const view = () => h('div', { title: 'Tip' }, h('h2', {}, 'Videos'), p('Intro'), 'Loose');`;
  const index = indexOf({ 'views/view.ts': view });

  it('excludes tag names and attribute values, and records owners', () => {
    const lits = index.analyzeDetached(file('views/view.ts'), view);
    expect(lits.map((l) => l.value)).toEqual(['Videos', 'Intro', 'Loose']);
    const owners = Object.fromEntries(lits.map((l) => [l.value, l.owner]));
    expect(owners.Videos).toBe(view.indexOf("h('h2'"));
    expect(owners.Loose).toBe(view.indexOf("h('div'"));
    expect(owners.Intro).toBeUndefined();
  });

  it('wraps only factory calls imported from the configured module', () => {
    const other = `import { h } from './elsewhere';\nimport * as dom from '/src/ui/dom';\nh('p', {}, 'a'); dom.h('p', {}, 'b');`;
    const analysis = new SourceIndex(root, [adapter]).update(file('o.ts'), other)!;
    expect(analysis.creationSites.map((s) => other.slice(s.start, s.end))).toEqual(["dom.h('p', {}, 'b')"]);
  });

  it('handles aliased imports', () => {
    const code = `import { h as el } from '../ui/dom';\nel('p', {}, 'x');`;
    const analysis = new SourceIndex(root, [adapter]).update(file('views/a.ts'), code)!;
    expect(analysis.creationSites).toHaveLength(1);
  });

  it('ranks the owning call first, then the same module, then elsewhere', () => {
    const a = `import { h } from './ui/dom';\nconst x = 'Same';\nexport const el = h('p', {}, 'Same');`;
    const b = `export const y = 'Same';`;
    const idx = indexOf({ 'a.ts': a, 'b.ts': b });
    const callStart = a.indexOf("h('p'");
    const elementLoc = { file: file('a.ts'), rel: 'src/a.ts', line: 3, column: 1, start: callStart, end: a.length };
    const res = idx.resolve({ text: 'Same', elementLoc });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]!.start).toBe(a.lastIndexOf("'Same'"));

    const elsewhere = idx.resolve({ text: 'Same', elementLoc: { ...elementLoc, file: file('c.ts'), start: 0 } });
    expect(elsewhere.candidates).toHaveLength(3);
  });

  it('reports ties as several candidates with ordinals', () => {
    const code = `import { h } from './ui/dom';\nconst t = (f: boolean) => (f ? 'Twin' : 'Twin');\nexport const el = h('span', {}, t(true));`;
    const idx = indexOf({ 'tw.ts': code });
    const start = code.indexOf("h('span'");
    const res = idx.resolve({ text: 'Twin', elementLoc: { file: file('tw.ts'), rel: 'src/tw.ts', line: 3, column: 19, start, end: code.length } });
    expect(res.candidates.map((c) => [c.ordinal, c.sameValueCount])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('is not editable when no literal matches (runtime-built text)', () => {
    expect(index.resolve({ text: 'Pressed 3 times' })).toEqual({ editable: false, candidates: [] });
  });
});

describe('use counting', () => {
  it('counts references to a shared const across importing modules', () => {
    const idx = indexOf({
      'strings.ts': `export const TITLE = 'Videos';\nexport const OTHER = 'x';`,
      'a.ts': `import { TITLE } from './strings';\nconsole.log(TITLE, TITLE);`,
      'b.ts': `import { TITLE as T } from './strings.ts';\nconsole.log(T);`,
      'c.ts': `import { TITLE } from './unrelated';\nconsole.log(TITLE);`,
    });
    expect(idx.resolve({ text: 'Videos' }).candidates[0]!.uses).toBe(3);
  });

  it('counts local uses and forgets importers that are re-indexed without the import', () => {
    const idx = indexOf({
      'strings.ts': `export const TITLE = 'Videos';\nconst LOCAL = 'Here';\nf(LOCAL); g(LOCAL); h({ LOCAL });`,
      'a.ts': `import { TITLE } from './strings';\nuse(TITLE);`,
    });
    expect(idx.resolve({ text: 'Here' }).candidates[0]!.uses).toBe(3);
    expect(idx.resolve({ text: 'Videos' }).candidates[0]!.uses).toBe(1);
    idx.update(file('a.ts'), `use(1);`);
    expect(idx.resolve({ text: 'Videos' }).candidates[0]!.uses).toBe(1);
  });

  it('replaces a module index on re-transform', () => {
    const idx = indexOf({ 'a.ts': `const a = 'Before';` });
    idx.update(file('a.ts'), `const a = 'After';`);
    expect(idx.resolve({ text: 'Before' }).editable).toBe(false);
    expect(idx.resolve({ text: 'After' }).editable).toBe(true);
  });
});
