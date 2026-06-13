import type { BacklogItem, LifecycleLinkRow, TraceSummary } from './backlog-domain.js';

export type ShippedEvidenceSource = 'lifecycle' | 'git-history' | 'pr-history' | 'combined';
export type ShippedEvidenceConfidence = 'strong' | 'ambiguous' | 'weak';

export interface ShippedEvidenceCaps {
  candidateCount: number;
  gitCommitScanCount: number;
  changedPathCount: number;
  changedPathBytes: number;
  prEnrichmentCount: number;
  excerptCount: number;
  excerptBytes: number;
  branchHintCount: number;
  diagnosticCount: number;
  subprocessTimeoutMs: number;
}

export const DEFAULT_SHIPPED_EVIDENCE_CAPS: ShippedEvidenceCaps = {
  candidateCount: 20,
  gitCommitScanCount: 80,
  changedPathCount: 12,
  changedPathBytes: 120,
  prEnrichmentCount: 6,
  excerptCount: 3,
  excerptBytes: 320,
  branchHintCount: 5,
  diagnosticCount: 12,
  subprocessTimeoutMs: 3500,
};

export type ShippedEvidenceDiagnosticCode =
  | 'gitUnavailable'
  | 'gitCommandFailed'
  | 'gitOutputTruncated'
  | 'prUnavailable'
  | 'prUnauthenticated'
  | 'prRateLimited'
  | 'prTimeout'
  | 'prCommandFailed'
  | 'capExceeded';

export interface ShippedEvidenceDiagnostic {
  code: ShippedEvidenceDiagnosticCode;
  message: string;
  detail?: string;
}

export interface GitHistoryRecord {
  source: 'git-history';
  hash: string;
  shortHash: string;
  subject: string;
  body?: string;
  committedAt?: string;
  parents: string[];
  isMerge: boolean;
  prNumbers: number[];
  branchHints: string[];
  changedPaths: string[];
}

export interface GitHistoryCollection {
  records: GitHistoryRecord[];
  diagnostics: ShippedEvidenceDiagnostic[];
}

export interface ShippedEvidenceExcerpt {
  evidenceSource: ShippedEvidenceSource;
  text: string;
  path?: string;
  commit?: string;
}

export interface ShippedEvidencePrMetadata {
  source: 'pr-history';
  number: number;
  title?: string;
  body?: string;
  url?: string;
  state?: string;
  mergedAt?: string;
  headRefName?: string;
  baseRefName?: string;
  mergeCommitOid?: string;
  changedPaths: string[];
}

export interface ShippedEvidenceCandidate {
  itemId: string;
  itemTitle: string;
  confidence: ShippedEvidenceConfidence;
  evidenceSource: ShippedEvidenceSource;
  score: number;
  citation: string;
  reasons: string[];
  commit?: {
    hash: string;
    shortHash: string;
    subject: string;
    isMerge: boolean;
    committedAt?: string;
  };
  pr?: ShippedEvidencePrMetadata;
  lifecycleRows: LifecycleLinkRow[];
  changedPaths: string[];
  branchHints: string[];
  excerpts: ShippedEvidenceExcerpt[];
}

export interface ShippedEvidenceResult {
  candidates: ShippedEvidenceCandidate[];
  diagnostics: ShippedEvidenceDiagnostic[];
  caps: ShippedEvidenceCaps;
}

export interface CollectShippedEvidenceInput {
  cwd: string;
  items: readonly BacklogItem[];
  traceSummaries?: readonly TraceSummary[];
  caps?: Partial<ShippedEvidenceCaps>;
  enrichPullRequests?: boolean;
  signal?: AbortSignal;
}

export interface ShippedEvidenceProvider {
  collect(input: CollectShippedEvidenceInput): Promise<ShippedEvidenceResult>;
}
