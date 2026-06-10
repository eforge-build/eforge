import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export function assertSafeBacklogId(id: string): void {
  if (id.length === 0) {
    throw new Error('Backlog id must not be empty');
  }
  if (id === '.' || id === '..') {
    throw new Error(`Unsafe backlog id "${id}": traversal segments are not allowed`);
  }
  if (id.includes('\0')) {
    throw new Error('Unsafe backlog id: null bytes are not allowed');
  }
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`Unsafe backlog id "${id}": path separators are not allowed`);
  }
  if (isAbsolute(id) || win32.isAbsolute(id)) {
    throw new Error(`Unsafe backlog id "${id}": absolute paths are not allowed`);
  }
}

export function orderFrontmatter(frontmatter: Record<string, unknown>, knownOrder: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of knownOrder) {
    if (frontmatter[key] !== undefined) {
      result[key] = frontmatter[key];
    }
  }
  for (const key of Object.keys(frontmatter).filter((key) => !knownOrder.includes(key)).sort()) {
    if (frontmatter[key] !== undefined) {
      result[key] = frontmatter[key];
    }
  }
  return result;
}

export function safeId(id: string): string {
  assertSafeBacklogId(id);
  return id;
}

export function resolveContainedPath(root: string, leaf: string): string {
  const resolved = resolve(root, leaf);
  const rel = relative(root, resolved);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved backlog path "${resolved}" escapes ${root}${sep}`);
  }
  return resolved;
}

export function toProjectRelativePath(cwd: string, filePath: string): string {
  return relative(cwd, filePath).split(sep).join('/');
}

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
