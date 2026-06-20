import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { RecoveryGuidancePrepareRequest, RecoveryGuidancePrepareResponse } from '../routes.js';

export function apiPrepareRecoveryGuidance(opts: { cwd: string; body: RecoveryGuidancePrepareRequest }) {
  return daemonRequest<RecoveryGuidancePrepareResponse>(opts.cwd, 'POST', API_ROUTES.recoveryGuidancePrepare, opts.body);
}

export function apiPrepareRecoveryGuidanceIfRunning(opts: { cwd: string; body: RecoveryGuidancePrepareRequest }) {
  return daemonRequestIfRunning<RecoveryGuidancePrepareResponse>(opts.cwd, 'POST', API_ROUTES.recoveryGuidancePrepare, opts.body);
}
