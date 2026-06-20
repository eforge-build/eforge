import { API_ROUTES } from './routes.js';
import type { SchedulerPauseResponse, SchedulerResumeResponse } from './routes.js';

async function postNoBody<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const { body: _body, ...rest } = init ?? {};
  const res = await fetch(path, { ...rest, method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Scheduler request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

export function pauseScheduler(init?: RequestInit): Promise<SchedulerPauseResponse> {
  return postNoBody<SchedulerPauseResponse>(API_ROUTES.schedulerPause, init);
}

export function resumeScheduler(init?: RequestInit): Promise<SchedulerResumeResponse> {
  return postNoBody<SchedulerResumeResponse>(API_ROUTES.schedulerResume, init);
}
