import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES, buildPath } from '../routes.js';
import type {
  FailedEnqueueReenqueueRequest,
  FailedEnqueueReenqueueResponse,
  FailedEnqueuesResponse,
} from '../routes.js';

export function apiGetFailedEnqueues(opts: { cwd: string }) {
  return daemonRequest<FailedEnqueuesResponse>(opts.cwd, 'GET', API_ROUTES.failedEnqueues);
}

export function apiGetFailedEnqueuesIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<FailedEnqueuesResponse>(opts.cwd, 'GET', API_ROUTES.failedEnqueues);
}

export function apiReenqueueFailedEnqueue(opts: { cwd: string; runId: string; body: FailedEnqueueReenqueueRequest }) {
  return daemonRequest<FailedEnqueueReenqueueResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.failedEnqueueReenqueue, { runId: opts.runId }),
    opts.body,
  );
}

export function apiReenqueueFailedEnqueueIfRunning(opts: { cwd: string; runId: string; body: FailedEnqueueReenqueueRequest }) {
  return daemonRequestIfRunning<FailedEnqueueReenqueueResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.failedEnqueueReenqueue, { runId: opts.runId }),
    opts.body,
  );
}
