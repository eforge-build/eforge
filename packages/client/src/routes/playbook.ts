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
export interface PlaybookPlanningRequiredCapability {
  name: 'eforge.plan.planning-mode-playbook';
  version: '>=1.0.0';
}

export interface PlaybookPlanningEntryMetadata {
  actionId: 'eforge-plan:open-planning-entry';
  integrationCommandId: 'eforge-plan:open-planning-entry';
  deepLinkId: 'eforge-plan:planning-workstation';
  workstationId: 'eforge-plan:planning-workstation';
  workstationUrl: '/console/workstations/eforge-plan%3Aplanning-workstation';
}

export interface PlaybookPlanningUnavailableDiagnostic {
  code: string;
  message: string;
  severity?: 'warning' | 'error';
  capabilityName?: string;
  dependencyName?: string;
  providerName?: string;
  requiredVersion?: string;
  actualVersion?: string;
}

/**
 * Response for POST /api/playbook/run when the playbook is planning-mode and
 * the eforge-plan planning-mode playbook capability is available. The daemon
 * returns generic contribution/workstation metadata; no session-plan file is
 * written and nothing is enqueued.
 */
export interface PlaybookRunRequiresAgentResponse {
  kind: 'requires-agent';
  mode: 'planning';
  name: string;
  message: string;
  requiredCapability: PlaybookPlanningRequiredCapability;
  planningEntry: PlaybookPlanningEntryMetadata;
}
/** Response for POST /api/playbook/run when planning-mode dependency is unavailable. */
export interface PlaybookRunPlanningUnavailableResponse {
  kind: 'planning-unavailable';
  mode: 'planning';
  name: string;
  message: string;
  requiredCapability: PlaybookPlanningRequiredCapability;
  diagnostics: PlaybookPlanningUnavailableDiagnostic[];
  planningEntry?: PlaybookPlanningEntryMetadata;
}

/** Discriminated union response for POST /api/playbook/run */
export type PlaybookRunResponse = PlaybookRunEnqueuedResponse | PlaybookRunRequiresAgentResponse | PlaybookRunPlanningUnavailableResponse;
