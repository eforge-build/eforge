import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

export function canonicalJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)])); return value; }
export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function stableId(prefix: string, value: unknown): string { return `${prefix}:${sha256(canonicalJson(value)).slice(0, 24)}`; }
export function normalizeTimestamp(value: unknown): string | undefined { if (typeof value !== 'string' || value.length === 0) return undefined; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toISOString(); }
export function projectRelative(cwd: string, path: string): string { return relative(resolve(cwd), resolve(path)).split(sep).join('/'); }
export function compactText(value: unknown, max = 500): string | undefined { if (typeof value !== 'string') return undefined; const text = value.replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text || undefined; }
export function asString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
export function asStringArray(value: unknown): string[] { if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0); return typeof value === 'string' && value.length > 0 ? [value] : []; }
export function fileId(path: string): string { return path.replace(/\.md$/i, '').split(/[\\/]/).pop() ?? path; }
