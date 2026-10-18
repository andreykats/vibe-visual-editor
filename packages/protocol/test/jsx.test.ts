import { describe, expect, it } from 'vitest';
import { cookJsxAttribute, cookJsxText, jsxAttributeRaw, jsxTextRaw, literalRaw } from '../src';

describe('cookJsxText', () => {
  it('trims lines, drops blank ones and joins the rest with one space', () => {
    expect(cookJsxText('\n    Hello\n    world  \n  ')).toBe('Hello world');
    expect(cookJsxText('Hello  there')).toBe('Hello  there');
    expect(cookJsxText(' Hello ')).toBe(' Hello ');
    expect(cookJsxText('Hello \n\n   ')).toBe('Hello');
    expect(cookJsxText('\n\t\tTabbed indent\n\t')).toBe('Tabbed indent');
  });

  it('decodes entities', () => {
    expect(cookJsxText('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(cookJsxText('&#123;x&#x7D; &lt;b&gt; &nbsp;&copy;')).toBe('{x} <b> \u00a0©');
    expect(cookJsxText('AT&T & co')).toBe('AT&T & co');
  });

  it("returns null where JSX compilers disagree, so the text isn't offered for editing", () => {
    expect(cookJsxText('a\tb')).toBeNull();
    expect(cookJsxText('\tleading tab on the first line')).toBeNull();
    expect(cookJsxText('&#32;x')).toBeNull();
    expect(cookJsxText('&unknownentity;')).toBeNull();
    expect(cookJsxText('a\u00a0\nb')).toBeNull();
  });
});

describe('cookJsxAttribute', () => {
  it('decodes entities and keeps backslashes literally', () => {
    expect(cookJsxAttribute('a &amp; b')).toBe('a & b');
    expect(cookJsxAttribute('C:\\path\\n')).toBe('C:\\path\\n');
    expect(cookJsxAttribute('line\nbreak')).toBeNull();
  });
});

describe('jsxTextRaw', () => {
  it('escapes what JSX text cannot hold', () => {
    expect(jsxTextRaw('a {b} <c> & AT&T &amp; x', 'old')).toBe('a &#123;b&#125; &lt;c&gt; & AT&T &amp;amp; x');
  });

  it("keeps the original's surrounding line breaks and indentation", () => {
    expect(jsxTextRaw('New text', '\n        Old text\n      ')).toBe('\n        New text\n      ');
    expect(jsxTextRaw('New', ' Old')).toBe('New');
  });

  it('keeps significant edge spaces by writing one line', () => {
    expect(jsxTextRaw(' spaced ', '\n  Old\n')).toBe(' spaced ');
  });

  it('falls back to an expression for line breaks, tabs and empty text', () => {
    expect(jsxTextRaw('two\nlines', 'x')).toBe("{'two\\nlines'}");
    expect(jsxTextRaw('a\tb', 'x')).toBe("{'a\tb'}");
    expect(jsxTextRaw('', 'x')).toBe("{''}");
  });
});

describe('jsxAttributeRaw', () => {
  it("picks a quote the value doesn't contain, preferring the original's", () => {
    expect(jsxAttributeRaw('Hi', '"Old"')).toBe('"Hi"');
    expect(jsxAttributeRaw('Hi', "'Old'")).toBe("'Hi'");
    expect(jsxAttributeRaw('say "hi"', '"Old"')).toBe(`'say "hi"'`);
    expect(jsxAttributeRaw(`it's "x"`, '"Old"')).toBe(`{'it\\'s "x"'}`);
    expect(jsxAttributeRaw('a\nb', '"Old"')).toBe("{'a\\nb'}");
    expect(jsxAttributeRaw('&amp;', '"Old"')).toBe('"&amp;amp;"');
  });
});

describe('literalRaw', () => {
  it('dispatches on the literal kind', () => {
    expect(literalRaw("it's", "'", "'old'")).toBe("'it\\'s'");
    expect(literalRaw('a < b', 'jsx', 'old')).toBe('a &lt; b');
    expect(literalRaw('Hi', 'jsx-attr', '"old"')).toBe('"Hi"');
  });
});
