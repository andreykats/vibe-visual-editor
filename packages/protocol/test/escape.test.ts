import { describe, expect, it } from 'vitest';
import { escapeLiteral, type Quote } from '../src';

const evaluate = (raw: string): unknown => new Function(`return ${raw};`)();

const samples = [
  '',
  'plain',
  "it's",
  'say "hi"',
  'back`tick',
  'a\\b',
  'trailing\\',
  '${notInterpolated}',
  '$ and { apart',
  'line\nbreak',
  'carriage\rreturn',
  'sep arators ',
  'unicode é ü 中文',
  'emoji 🎉👩‍👩‍👧',
  'tab\there',
  '\\${',
  '\'"`',
];

describe('escapeLiteral', () => {
  for (const quote of ["'", '"', '`'] as Quote[]) {
    for (const value of samples) {
      it(`round-trips ${JSON.stringify(value)} with ${quote}`, () => {
        const raw = escapeLiteral(value, quote);
        expect(raw.startsWith(quote) && raw.endsWith(quote)).toBe(true);
        expect(evaluate(raw)).toBe(value);
      });
    }
  }

  it('keeps the quote style and escapes only what it must', () => {
    expect(escapeLiteral("it's", "'")).toBe("'it\\'s'");
    expect(escapeLiteral("it's", '"')).toBe('"it\'s"');
    expect(escapeLiteral('cost ${x}', '`')).toBe('`cost \\${x}`');
    expect(escapeLiteral('cost ${x}', "'")).toBe("'cost ${x}'");
  });
});
