export interface RecoveryGuidancePrepareRequest {
  prdId: string;
  setName?: string;
}

export type RecoveryGuidancePatchStatus = 'patched' | 'already-current' | 'artifact-missing' | 'blocked';

export interface RecoveryGuidancePatchedPlan {
  planId: string;
  path: string;
  status: RecoveryGuidancePatchStatus;
  reason?: string;
}

export interface RecoveryGuidancePrepareResponse {
  prdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
  outputDir: string;
  sidecarPath: string;
  sidecarGeneratedAt: string;
  plans: RecoveryGuidancePatchedPlan[];
  commitSha?: string;
}
