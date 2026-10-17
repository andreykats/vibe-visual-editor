const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Returns the parsed URL if it is an http(s) URL on a loopback host without
 * credentials, otherwise null. Every URL that reaches the preview goes through here.
 */
export function parseLoopbackUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password) return null;
  return url;
}

/**
 * Joins an app-relative path such as `#/settings` or `admin/` onto a dev
 * server URL. Hash-only paths replace the hash; other paths resolve
 * relative to the server's base path.
 */
export function joinAppPath(base: string, path: string): string {
  const url = new URL(base);
  const trimmed = path.trim();
  if (trimmed === '') return url.href;
  if (trimmed.startsWith('#')) {
    url.hash = trimmed;
    return url.href;
  }
  const baseDir = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const rel = trimmed.replace(/^\/+/, '');
  return new URL(rel, new URL(baseDir, url.origin)).href;
}
