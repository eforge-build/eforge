import type { EvaluationVerdict } from '../schemas.js';
import type { ModelTracker } from '../model-tracker.js';

export type EvaluationCandidateStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unmerged'
  | 'unknown'
  | 'untracked';

export interface EvaluationResetState {
  cwd: string;
  resetTarget: string;
  originalHead: string;
  baseHead: string;
}

export interface EvaluationCandidateHunk {
  index: number;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  diff: string;
}

export interface EvaluationCandidateFile {
  path: string;
  oldPath?: string;
  status: EvaluationCandidateStatus;
  statusCode: string;
  diff: string;
  diffHeader: string;
  hunks: EvaluationCandidateHunk[];
  isBinary: boolean;
  isUntracked: boolean;
  isRenameOnly: boolean;
  requiresFileVerdict: boolean;
  contentSha256?: string;
  contentBase64?: string;
  isSymlink?: boolean;
  symlinkTargetBase64?: string;
}

export interface EvaluationSnapshot {
  cwd: string;
  capturedAt: string;
  resetTarget?: string;
  originalHead?: string;
  baseHead: string;
  stagedPatch: string;
  candidatePatch: string;
  files: EvaluationCandidateFile[];
}

export interface EvaluationFileVerdictSummary {
  file: string;
  mode: 'file' | 'hunks';
  action?: EvaluationVerdict['action'];
  issueOutcome?: EvaluationVerdict['issueOutcome'];
  acceptedHunks: number[];
  rejectedHunks: number[];
  reviewHunks: number[];
  blockingIssueHunks: number[];
}

export interface EvaluationVerdictSummary {
  accepted: number;
  rejected: number;
  review: number;
  fileLevel: number;
  hunkLevel: number;
  files: EvaluationFileVerdictSummary[];
}

export type EvaluationCandidateDecision =
  | { kind: 'file'; file: EvaluationCandidateFile; verdict: EvaluationVerdict }
  | { kind: 'hunks'; file: EvaluationCandidateFile; verdictsByHunk: Map<number, EvaluationVerdict> };

export interface EvaluationValidationResult {
  decisions: Map<string, EvaluationCandidateDecision>;
  summary: EvaluationVerdictSummary;
}

export interface ApplyEvaluationVerdictsOptions {
  commit?: boolean;
  commitMessage?: string;
  modelTracker?: ModelTracker;
}

export interface EvaluationApplicationResult extends EvaluationVerdictSummary {
  committed: boolean;
  commitSha?: string;
}
