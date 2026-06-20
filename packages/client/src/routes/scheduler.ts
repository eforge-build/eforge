import type { AutoBuildState } from '../types.js';

export interface SchedulerKickResponse {
  ok: true;
}

export type SchedulerPauseResponse = AutoBuildState;
export type SchedulerResumeResponse = AutoBuildState;
