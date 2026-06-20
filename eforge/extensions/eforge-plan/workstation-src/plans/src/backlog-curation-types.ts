import type { BacklogCurationDraft, BacklogCurationScanMode, RecommendationFreshnessView, RecommendationModel, RecommendationSummary } from './types';

export interface RecommendationReferenceValidationIssue { path: string; id: string; kind: 'item' | 'epic'; reason: 'unknown' | 'closed' | 'empty' | 'wrong-lane'; status?: string; title?: string; message: string; }
export interface RecommendationReferenceValidationResult { valid: boolean; issues: RecommendationReferenceValidationIssue[]; }
export interface BacklogCurationPreviewValidationError { path: string; message: string; }
export interface BacklogCurationRecommendationProjection { effectiveRecommendations?: RecommendationModel; recommendationSummary?: RecommendationSummary; removed: { itemIds: string[]; epicIds: string[] }; repositioned: Array<{ itemId: string; from: string; to: string }>; validation: RecommendationReferenceValidationResult; }
export interface BacklogCurationGitDeltaDiagnostic { severity: 'warning' | 'info'; code: string; message?: string; commit?: string; }
export interface BacklogCurationGitDeltaCandidate { itemId?: string; epicId?: string; commit?: unknown; evidence?: string; intent?: 'shipped' | 'superseded' | 'affected' | 'ambiguous-shipped' | 'ambiguous-superseded' | string; confidence?: 'strong' | 'medium' | 'ambiguous' | string; }
export interface BacklogCurationGitDeltaPreview { baseline?: { source?: string; commit?: string | null; time?: string; taskId?: string; sourceFingerprint?: string; generatedAt?: string } | null; currentHead?: { commit?: string; time?: string; sourceFingerprint?: string; generatedAt?: string } | null; coverage?: { kind: 'complete' | 'bounded' | 'unavailable' | string; message?: string; reason?: string }; caps?: { commitScanCount?: number; changedPathCount?: number; excerptCount?: number; excerptBytes?: number; prEnrichmentCount?: number; subprocessTimeoutMs?: number }; scannedCommitCount?: number; scannedCommits?: unknown[]; diagnostics?: BacklogCurationGitDeltaDiagnostic[]; affectedItemCandidates?: BacklogCurationGitDeltaCandidate[]; }
export interface BacklogCurationFullAuditDiagnostic { severity: 'warning' | 'info'; code: string; message?: string; path?: string; }
export interface BacklogCurationFullAuditCitation { kind?: string; source?: string; path?: string; excerpt?: string; }
export interface BacklogCurationFullAuditHistoricalHint { source?: string; confidence?: string; intent?: string; citation?: string; evidence?: string; path?: string; closureAuthority?: boolean; pr?: { number?: number; title?: string; branch?: string; url?: string }; }
export interface BacklogCurationSourceFirstResult { itemId: string; intent: string; confidence: string; citations?: BacklogCurationFullAuditCitation[]; historicalHints?: BacklogCurationFullAuditHistoricalHint[]; diagnostics?: BacklogCurationFullAuditDiagnostic[]; rationale?: string; }
export interface BacklogCurationFullAuditEvidenceSummary { source: string; confidence: string; matchedBy?: string[]; path?: string; excerpt?: string; evidence?: string; citation?: string; intent?: string; evidenceSource?: string; citations?: BacklogCurationFullAuditCitation[]; evidenceRoles?: string[]; }
export interface BacklogCurationFullAuditItemSummary { itemId: string; candidateIntent: string; evidenceCount?: number; confidence?: string; evidence?: BacklogCurationFullAuditEvidenceSummary[]; closureCandidates?: BacklogCurationFullAuditEvidenceSummary[]; sourceFirstResult?: BacklogCurationSourceFirstResult; historicalHints?: BacklogCurationFullAuditHistoricalHint[]; currentStateEvidenceTruncatedCount?: number; }
export interface BacklogCurationFullAuditPreview { scope?: { itemIds: string[]; openItemCount?: number }; coverage?: { auditedItemCount: number; currentStateFileCount?: number; gitHistoryCommitCount?: number; pullRequestCount?: number }; caps?: { fileScanCount?: number; fileBytes?: number; evidencePerItem?: number; pathsPerCategory?: number; excerptBytes?: number; diagnosticCount?: number; gitCommitScanCount?: number; prEnrichmentCount?: number }; settings?: { itemAuditConcurrency?: number; maxItemAuditConcurrency?: number; closureAuthority?: string }; diagnostics?: BacklogCurationFullAuditDiagnostic[]; sourceFirstResults?: BacklogCurationSourceFirstResult[]; historicalHints?: BacklogCurationFullAuditHistoricalHint[]; closureCandidates?: BacklogCurationFullAuditEvidenceSummary[]; itemSummaries?: BacklogCurationFullAuditItemSummary[]; }
export interface BacklogCurationPreviewDetails {
  valid: boolean;
  scanMode?: BacklogCurationScanMode;
  itemChanges?: number;
  epicChanges?: number;
  noOpRechecks?: number;
  recommendationProjection?: BacklogCurationRecommendationProjection;
  recommendationFreshness?: RecommendationFreshnessView;
  gitDelta?: BacklogCurationGitDeltaPreview;
  fullImplementationAudit?: BacklogCurationFullAuditPreview;
  generatedRecommendationValidation?: RecommendationReferenceValidationResult;
  errors?: BacklogCurationPreviewValidationError[];
}
export interface BacklogCurationRecommendationsSkipped {
  reason: 'apply-curation-only' | 'invalid-generated-recommendations';
  generatedRecommendationValidation: RecommendationReferenceValidationResult;
}
