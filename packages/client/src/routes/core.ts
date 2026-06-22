/** POST /api/enqueue */
export interface EnqueueRequest {
  source: string;
  flags?: string[];
  /** Override the active profile for this build (profile name, validated at enqueue time). */
  profile?: string;
  /** Producer-agnostic per-enqueue post-merge validation commands to persist with the queued PRD. */
  postMerge?: string[];
  /** Override the project-level landing action for this build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** When true, enable GitHub PR auto-merge after PR creation (requires the effective landing action to be 'pr', whether supplied via landingAction or resolved from project config). */
  landingAutoMerge?: boolean;
  /**
   * Optional upstream queue item id. When provided, the enqueued PRD gains
   * `depends_on: [afterQueueId]` in its frontmatter. Placement depends on the
   * upstream state:
   * - Active upstream (pending/running/waiting): placed in `.eforge/queue/waiting/`
   *   and unblocked by the queue scheduler when the upstream completes.
   * - Completed upstream with a usable artifact: placed in the queue root as an
   *   immediately eligible dependent (no waiting required).
   *
   * Failed, skipped, and unknown ids are rejected with an error containing the
   * invalid id.
   *
   * Explicit `afterQueueId` takes precedence over any automatic dependency
   * detection performed during enqueue.
   */
  afterQueueId?: string;
}

/** POST /api/auto-build */
export interface AutoBuildSetRequest {
  enabled: boolean;
}

/** POST /api/daemon/stop */
export interface StopDaemonRequest {
  force?: boolean;
}

/** Response body for GET /api/version */
export interface VersionResponse {
  /** Daemon HTTP API protocol version (DAEMON_API_VERSION). Bumps on breaking changes. */
  version: number;
  /**
   * eforge package version baked into the daemon bundle at build time
   * (`{semver}{-dirty?} ({sha})`). Compare against the CLI/proxy's own
   * EFORGE_VERSION to detect a stale daemon (rebuilt without restart).
   * Optional for backward compatibility with older daemons.
   */
  eforgeVersion?: string;
}
