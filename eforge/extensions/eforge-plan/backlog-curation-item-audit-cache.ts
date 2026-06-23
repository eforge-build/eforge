import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BacklogCurationMapReduceFindingSchema,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceRuntimeIdentity,
} from '@eforge-build/client';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import { safeParseWithSchema } from '@eforge-build/client';
import { canonicalJson, sha256 } from './markdown-store-support.js';

export interface BacklogCurationItemAuditCacheKeyInput {
  cwd: string;
  sourceFingerprint?: string;
  itemId?: string;
  packetSha256?: string;
  bodySha256?: string;
  promptVersion?: string;
  runtimeIdentity?: BacklogCurationMapReduceRuntimeIdentity;
}

export interface BacklogCurationItemAuditCacheWriteInput extends BacklogCurationItemAuditCacheKeyInput {
  finding: BacklogCurationMapReduceFinding;
}

export interface BacklogCurationItemAuditCacheHit {
  hit: true;
  path: string;
  cacheKey: string;
  finding: BacklogCurationMapReduceFinding;
}

export interface BacklogCurationItemAuditCacheMiss {
  hit: false;
  reason: 'missing-key-dimension' | 'not-found' | 'malformed-json' | 'schema-invalid' | 'byte-invalid' | 'key-mismatch';
  path?: string;
  cacheKey?: string;
}

export interface BacklogCurationItemAuditCacheWriteResult {
  written: boolean;
  path?: string;
  cacheKey?: string;
  reason?: 'missing-key-dimension' | 'schema-invalid' | 'byte-invalid' | 'key-mismatch';
}

interface CacheKeyParts {
  sourceFingerprint: string;
  itemId: string;
  packetSha256: string;
  bodySha256: string;
  promptVersion: string;
  runtimeIdentity: BacklogCurationMapReduceRuntimeIdentity;
}

interface CacheSidecar {
  schemaVersion: 1;
  key: CacheKeyParts;
  cacheKey: string;
  writtenAt: string;
  finding: BacklogCurationMapReduceFinding;
}

export function defaultBacklogCurationItemAuditPromptVersion(): string {
  return BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION;
}

export function buildBacklogCurationItemAuditCacheKey(input: BacklogCurationItemAuditCacheKeyInput): string | null {
  const parts = normalizeCacheKeyParts(input);
  return parts === null ? null : sha256(canonicalJson(parts));
}

export function resolveBacklogCurationItemAuditCachePath(input: BacklogCurationItemAuditCacheKeyInput): string | null {
  const cacheKey = buildBacklogCurationItemAuditCacheKey(input);
  if (cacheKey === null) return null;
  return createEforgeProjectPaths({ cwd: input.cwd, extensionName: 'eforge-plan' }).extensionStoragePath('project-local', ['backlog-curation-item-audits', `${cacheKey}.json`]);
}

export async function readBacklogCurationItemAuditCache(input: BacklogCurationItemAuditCacheKeyInput): Promise<BacklogCurationItemAuditCacheHit | BacklogCurationItemAuditCacheMiss> {
  const parts = normalizeCacheKeyParts(input);
  const cacheKey = parts === null ? null : sha256(canonicalJson(parts));
  const path = cacheKey === null ? null : resolveBacklogCurationItemAuditCachePath(input);
  if (parts === null || cacheKey === null || path === null) return { hit: false, reason: 'missing-key-dimension' };
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hit: false, reason: 'not-found', path, cacheKey };
    throw error;
  }
  let sidecar: CacheSidecar;
  try {
    sidecar = JSON.parse(raw) as CacheSidecar;
  } catch {
    return { hit: false, reason: 'malformed-json', path, cacheKey };
  }
  if (!isMatchingSidecarKey(sidecar, parts, cacheKey)) return { hit: false, reason: 'key-mismatch', path, cacheKey };
  if (!isFindingByteValid(sidecar.finding)) return { hit: false, reason: 'byte-invalid', path, cacheKey };
  const parsed = safeParseWithSchema(BacklogCurationMapReduceFindingSchema, sidecar.finding);
  if (!parsed.success) return { hit: false, reason: 'schema-invalid', path, cacheKey };
  return { hit: true, path, cacheKey, finding: parsed.data };
}

export async function writeBacklogCurationItemAuditCache(input: BacklogCurationItemAuditCacheWriteInput): Promise<BacklogCurationItemAuditCacheWriteResult> {
  const parts = normalizeCacheKeyParts(input);
  if (parts === null) return { written: false, reason: 'missing-key-dimension' };
  if (!isFindingByteValid(input.finding)) return { written: false, reason: 'byte-invalid' };
  const parsed = safeParseWithSchema(BacklogCurationMapReduceFindingSchema, input.finding);
  if (!parsed.success) return { written: false, reason: 'schema-invalid' };
  if (!isFindingMatchingCacheKey(parsed.data, parts)) return { written: false, reason: 'key-mismatch' };
  const cacheKey = sha256(canonicalJson(parts));
  const path = resolveBacklogCurationItemAuditCachePath(input);
  if (path === null) return { written: false, reason: 'missing-key-dimension' };
  const sidecar: CacheSidecar = { schemaVersion: 1, key: parts, cacheKey, writtenAt: new Date().toISOString(), finding: parsed.data };
  await writeJsonAtomically(path, sidecar);
  return { written: true, path, cacheKey };
}

export function isFindingByteValid(finding: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(finding), 'utf-8') <= BACKLOG_CURATION_FINDING_MAX_BYTES;
}

function normalizeCacheKeyParts(input: BacklogCurationItemAuditCacheKeyInput): CacheKeyParts | null {
  if (!input.sourceFingerprint || !input.itemId || !input.packetSha256 || !input.bodySha256 || !input.promptVersion || !isRuntimeIdentityComplete(input.runtimeIdentity)) return null;
  return {
    sourceFingerprint: input.sourceFingerprint,
    itemId: input.itemId,
    packetSha256: input.packetSha256,
    bodySha256: input.bodySha256,
    promptVersion: input.promptVersion,
    runtimeIdentity: input.runtimeIdentity,
  };
}

function isRuntimeIdentityComplete(value: BacklogCurationMapReduceRuntimeIdentity | undefined): value is BacklogCurationMapReduceRuntimeIdentity {
  return value !== undefined && value.provider.length > 0 && value.modelId.length > 0;
}

function isMatchingSidecarKey(sidecar: CacheSidecar, parts: CacheKeyParts, cacheKey: string): boolean {
  return sidecar?.schemaVersion === 1
    && sidecar.cacheKey === cacheKey
    && canonicalJson(sidecar.key) === canonicalJson(parts)
    && isFindingMatchingCacheKey(sidecar.finding, parts);
}

function isFindingMatchingCacheKey(finding: BacklogCurationMapReduceFinding | undefined, parts: CacheKeyParts): boolean {
  return finding?.sourceFingerprint === parts.sourceFingerprint
    && finding.itemId === parts.itemId
    && finding.packetSha256 === parts.packetSha256
    && finding.bodySha256 === parts.bodySha256
    && finding.promptVersion === parts.promptVersion
    && canonicalJson(finding.runtimeIdentity) === canonicalJson(parts.runtimeIdentity);
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(temp, path);
}
