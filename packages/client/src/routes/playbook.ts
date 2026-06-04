// ---------------------------------------------------------------------------
// Playbook run route request/response interfaces
// ---------------------------------------------------------------------------

/** Request body for POST /api/playbook/run */
export interface PlaybookRunRequest {
  name: string;
  afterQueueId?: string;
  /** Override the project-level landing action for this autonomous playbook run. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** When true, enable GitHub PR auto-merge after PR creation (requires the effective landing action to be 'pr', whether supplied via landingAction or resolved from project config). */
  landingAutoMerge?: boolean;
}

/** Response for POST /api/playbook/run when the playbook is autonomous */
export interface PlaybookRunEnqueuedResponse {
  kind: 'enqueued';
  id: string;
}

/**
 * Response for POST /api/playbook/run when the playbook is planning-mode.
 * The request is valid; the daemon returns this typed result so first-party clients
 * can delegate to an interactive agent (e.g. /eforge:plan or /skill:eforge-playbook run).
 * No session-plan file is written and nothing is enqueued.
 */
export interface PlaybookRunRequiresAgentResponse {
  kind: 'requires-agent';
  mode: 'planning';
  name: string;
  message: string;
}

/** Discriminated union response for POST /api/playbook/run */
export type PlaybookRunResponse = PlaybookRunEnqueuedResponse | PlaybookRunRequiresAgentResponse;
