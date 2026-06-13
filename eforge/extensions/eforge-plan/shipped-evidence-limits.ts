import { Buffer } from 'node:buffer';
import type { ShippedEvidenceCaps } from './shipped-evidence-types.js';
import { DEFAULT_SHIPPED_EVIDENCE_CAPS } from './shipped-evidence-types.js';

const MAX_SHIPPED_EVIDENCE_CAPS: ShippedEvidenceCaps = {
  candidateCount: 100,
  gitCommitScanCount: 500,
  changedPathCount: 100,
  changedPathBytes: 500,
  prEnrichmentCount: 25,
  excerptCount: 10,
  excerptBytes: 2_000,
  branchHintCount: 25,
  diagnosticCount: 50,
  subprocessTimeoutMs: 15_000,
};

const TRUNCATION_MARKER = '\n…[truncated]';

export function normalizeShippedEvidenceCaps(caps: Partial<ShippedEvidenceCaps> = {}): ShippedEvidenceCaps {
  return {
    candidateCount: normalizeCap(caps.candidateCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.candidateCount, MAX_SHIPPED_EVIDENCE_CAPS.candidateCount),
    gitCommitScanCount: normalizeCap(caps.gitCommitScanCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.gitCommitScanCount, MAX_SHIPPED_EVIDENCE_CAPS.gitCommitScanCount),
    changedPathCount: normalizeCap(caps.changedPathCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.changedPathCount, MAX_SHIPPED_EVIDENCE_CAPS.changedPathCount),
    changedPathBytes: normalizeCap(caps.changedPathBytes, DEFAULT_SHIPPED_EVIDENCE_CAPS.changedPathBytes, MAX_SHIPPED_EVIDENCE_CAPS.changedPathBytes),
    prEnrichmentCount: normalizeCap(caps.prEnrichmentCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.prEnrichmentCount, MAX_SHIPPED_EVIDENCE_CAPS.prEnrichmentCount),
    excerptCount: normalizeCap(caps.excerptCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.excerptCount, MAX_SHIPPED_EVIDENCE_CAPS.excerptCount),
    excerptBytes: normalizeCap(caps.excerptBytes, DEFAULT_SHIPPED_EVIDENCE_CAPS.excerptBytes, MAX_SHIPPED_EVIDENCE_CAPS.excerptBytes),
    branchHintCount: normalizeCap(caps.branchHintCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.branchHintCount, MAX_SHIPPED_EVIDENCE_CAPS.branchHintCount),
    diagnosticCount: normalizeCap(caps.diagnosticCount, DEFAULT_SHIPPED_EVIDENCE_CAPS.diagnosticCount, MAX_SHIPPED_EVIDENCE_CAPS.diagnosticCount),
    subprocessTimeoutMs: normalizePositiveCap(caps.subprocessTimeoutMs, DEFAULT_SHIPPED_EVIDENCE_CAPS.subprocessTimeoutMs, MAX_SHIPPED_EVIDENCE_CAPS.subprocessTimeoutMs),
  };
}

export function boundString(value: string, limit: number): string {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (Buffer.byteLength(value, 'utf8') <= boundedLimit) return value;
  if (boundedLimit === 0) return '';
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  if (boundedLimit <= markerBytes) return truncateUtf8(TRUNCATION_MARKER, boundedLimit);
  return `${truncateUtf8(value, boundedLimit - markerBytes)}${TRUNCATION_MARKER}`;
}

export function boundChangedPaths(paths: readonly string[], caps: ShippedEvidenceCaps): string[] {
  return paths.slice(0, caps.changedPathCount).map((path) => boundString(path, caps.changedPathBytes));
}

function normalizeCap(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function normalizePositiveCap(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function truncateUtf8(value: string, limit: number): string {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > limit) break;
    result += char;
    bytes += charBytes;
  }
  return result;
}
