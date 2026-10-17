import { describe, expect, it } from 'vitest';
import { joinAppPath, parseLoopbackUrl } from '../src';

describe('parseLoopbackUrl', () => {
  it.each(['http://localhost:5173/', 'https://127.0.0.1:8443/app/', 'http://[::1]:5173/#/x', 'http://localhost/'])('accepts %s', (u) => {
    expect(parseLoopbackUrl(u)).not.toBeNull();
  });
  it.each([
    'http://example.com:5173/',
    'http://localhost.evil.com:5173/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://user:pw@localhost:5173/',
    'http://10.0.0.1:5173/',
    'http://0.0.0.0:5173/',
    'not a url',
    'vscode://andreykats.vibe-visual-editor/open',
  ])('rejects %s', (u) => {
    expect(parseLoopbackUrl(u)).toBeNull();
  });
});

describe('joinAppPath', () => {
  const base = 'http://localhost:5173/my-app/';
  it('replaces the hash for hash routes', () => {
    expect(joinAppPath(base, '#/settings')).toBe('http://localhost:5173/my-app/#/settings');
    expect(joinAppPath(`${base}#/old`, '#/settings')).toBe('http://localhost:5173/my-app/#/settings');
  });
  it('resolves paths under the base path', () => {
    expect(joinAppPath(base, 'admin/')).toBe('http://localhost:5173/my-app/admin/');
    expect(joinAppPath(base, '/admin')).toBe('http://localhost:5173/my-app/admin');
    expect(joinAppPath('http://localhost:5173', 'x')).toBe('http://localhost:5173/x');
  });
  it('returns the base for an empty path', () => {
    expect(joinAppPath(base, '  ')).toBe(base);
  });
});
