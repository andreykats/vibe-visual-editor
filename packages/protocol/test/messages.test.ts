import { describe, expect, it } from 'vitest';
import { EnvelopeSchema, HostMessageSchema, PageMessageSchema, PROTOCOL_VERSION, WindowEntrySchema } from '../src';

const candidate = {
  id: '/a/b.ts:10',
  file: '/a/b.ts',
  rel: 'b.ts',
  line: 1,
  column: 11,
  start: 10,
  end: 17,
  value: 'Hello',
  raw: "'Hello'",
  quote: "'",
  ordinal: 0,
  sameValueCount: 1,
  uses: 1,
};

describe('message schemas', () => {
  it('accepts a valid edit', () => {
    const r = PageMessageSchema.safeParse({ type: 'le:edit', v: PROTOCOL_VERSION, requestId: 1, candidates: [candidate], newValue: 'Hi' });
    expect(r.success).toBe(true);
  });
  it('rejects unknown types, bad versions and bad fields', () => {
    expect(PageMessageSchema.safeParse({ type: 'le:nope', v: PROTOCOL_VERSION }).success).toBe(false);
    expect(PageMessageSchema.safeParse({ type: 'le:clearSelection', v: PROTOCOL_VERSION + 1 }).success).toBe(false);
    expect(PageMessageSchema.safeParse({ type: 'le:edit', v: PROTOCOL_VERSION, requestId: 1, candidates: [], newValue: 'x' }).success).toBe(false);
    expect(PageMessageSchema.safeParse({ type: 'le:edit', v: PROTOCOL_VERSION, requestId: 1, candidates: [{ ...candidate, quote: 'x' }], newValue: 'x' }).success).toBe(false);
    expect(HostMessageSchema.safeParse({ type: 'le:setMode', v: PROTOCOL_VERSION, mode: 'paint' }).success).toBe(false);
  });
  it('detects a version mismatch from the envelope', () => {
    const env = EnvelopeSchema.safeParse({ type: 'le:hello', v: 99, url: 'x' });
    expect(env.success && env.data.v).toBe(99);
  });
  it('validates registry entries', () => {
    const ok = { pid: 1, port: 1234, token: 'a'.repeat(64), workspaceFolders: ['/w'], focusedAt: 0, protocolVersion: 1 };
    expect(WindowEntrySchema.safeParse(ok).success).toBe(true);
    expect(WindowEntrySchema.safeParse({ ...ok, token: 'short' }).success).toBe(false);
    expect(WindowEntrySchema.safeParse({ ...ok, port: 0 }).success).toBe(false);
  });
});
