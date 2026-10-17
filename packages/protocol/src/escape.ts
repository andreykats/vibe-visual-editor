import type { Quote } from './types';

/**
 * Serializes `value` as a JS string literal using `quote`, so that evaluating
 * the result yields `value` exactly. Escapes backslashes, the active quote,
 * line terminators, and (for template literals) `${`.
 */
export function escapeLiteral(value: string, quote: Quote): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case ' ':
        out += '\\u2028';
        break;
      case ' ':
        out += '\\u2029';
        break;
      default:
        if (ch === quote) out += `\\${ch}`;
        else if (quote === '`' && ch === '$' && value[i + 1] === '{') out += '\\$';
        else out += ch;
    }
  }
  return quote + out + quote;
}
