<!-- Generated file. Do not edit. -->
<!-- Source: packages/client/src/routes/route-map.ts -->

# eforge Daemon HTTP API Reference

The eforge daemon exposes an HTTP API at `http://localhost:{port}/api/...`.
Clients should import route constants from `@eforge-build/client` (`API_ROUTES`) rather
than embedding literal path strings.

## Routes

Routes whose keys begin with `playbook`, `sessionPlan`, or `sessionPlanSet` are optional workflow compatibility and producer surfaces. They prepare, persist, or normalize workflow artifacts around build source; they are not kernel-owned planning capabilities.

Total routes: 95

| Route key | Path pattern |
|-----------|-------------|
| `acceptRecoverySuccess` | `/api/recover/accept-success` |
| `acceptRecoverySuccessPreview` | `/api/recover/accept-success/preview` |
| `applyRecovery` | `/api/recover/apply` |
| `autoBuildGet` | `/api/auto-build` |
| `autoBuildSet` | `/api/auto-build` |
| `cancel` | `/api/cancel/:sessionId` |
| `configShow` | `/api/config/show` |
| `configValidate` | `/api/config/validate` |
| `continueRepair` | `/api/recover/continue-repair` |
| `continueRepairEligibility` | `/api/recover/continue-repair/eligibility` |
| `daemonEvents` | `/api/daemon-events` |
| `daemonStop` | `/api/daemon/stop` |
| `diff` | `/api/diff/:sessionId/:planId` |
| `enqueue` | `/api/enqueue` |
| `events` | `/api/events/:runId` |
| `extensionActionInvoke` | `/api/extensions/actions/invoke` |
| `extensionAgentTaskCancel` | `/api/extensions/agent-tasks/:taskId/cancel` |
| `extensionAgentTaskGet` | `/api/extensions/agent-tasks/:taskId` |
| `extensionAgentTaskStart` | `/api/extensions/agent-tasks` |
| `extensionContributionManifest` | `/api/extensions/contributions` |
| `extensionDemote` | `/api/extensions/demote` |
| `extensionInstall` | `/api/extensions/install` |
| `extensionList` | `/api/extensions/list` |
| `extensionNew` | `/api/extensions/new` |
| `extensionPromote` | `/api/extensions/promote` |
| `extensionReload` | `/api/extensions/reload` |
| `extensionRemove` | `/api/extensions/remove` |
| `extensionShow` | `/api/extensions/show` |
| `extensionTest` | `/api/extensions/test` |
| `extensionTrust` | `/api/extensions/trust` |
| `extensionUntrust` | `/api/extensions/untrust` |
| `extensionUpdate` | `/api/extensions/update` |
| `extensionValidate` | `/api/extensions/validate` |
| `extensionWorkstationAsset` | `/api/extensions/workstations/:workstationId/assets/:assetId` |
| `extensionWorkstationFrame` | `/api/extensions/workstations/:workstationId/frame` |
| `failedEnqueueDismiss` | `/api/enqueue/failed/:runId/dismiss` |
| `failedEnqueueReenqueue` | `/api/enqueue/failed/:runId/reenqueue` |
| `failedEnqueues` | `/api/enqueue/failed` |
| `health` | `/api/health` |
| `keepAlive` | `/api/keep-alive` |
| `modelList` | `/api/models/list` |
| `modelProviders` | `/api/models/providers` |
| `plans` | `/api/plans/:runId` |
| `playbookCopy` | `/api/playbook/copy` |
| `playbookDemote` | `/api/playbook/demote` |
| `playbookList` | `/api/playbook/list` |
| `playbookPromote` | `/api/playbook/promote` |
| `playbookRun` | `/api/playbook/run` |
| `playbookSave` | `/api/playbook/save` |
| `playbookShow` | `/api/playbook/show` |
| `playbookValidate` | `/api/playbook/validate` |
| `profileCreate` | `/api/profile/create` |
| `profileDelete` | `/api/profile/:name` |
| `profileList` | `/api/profile/list` |
| `profileShow` | `/api/profile/show` |
| `profileUse` | `/api/profile/use` |
| `projectContext` | `/api/project-context` |
| `queue` | `/api/queue` |
| `queueCascadeApply` | `/api/queue/:prdId/cascade/apply` |
| `queueCascadePreview` | `/api/queue/:prdId/cascade/preview` |
| `queueDependencyOverride` | `/api/queue/:prdId/dependencies/override` |
| `queueHold` | `/api/queue/:prdId/hold` |
| `queuePriority` | `/api/queue/:prdId/priority` |
| `queueRecoveryAnalyze` | `/api/queue/recovery/analyze` |
| `queueRecoveryApply` | `/api/queue/recovery/apply` |
| `queueRemove` | `/api/queue/:prdId` |
| `queueUnhold` | `/api/queue/:prdId/unhold` |
| `readRecoverySidecar` | `/api/recovery/sidecar` |
| `recover` | `/api/recover` |
| `recoveryGuidancePrepare` | `/api/recover/guidance/prepare` |
| `runs` | `/api/runs` |
| `runState` | `/api/run-state/:id` |
| `runSummary` | `/api/run-summary/:id` |
| `schedulerKick` | `/api/scheduler/kick` |
| `schedulerPause` | `/api/scheduler/pause` |
| `schedulerResume` | `/api/scheduler/resume` |
| `sessionMetadata` | `/api/session-metadata` |
| `sessionPlanCreate` | `/api/session-plan/create` |
| `sessionPlanCreateFromPlaybook` | `/api/session-plan/create-from-playbook` |
| `sessionPlanList` | `/api/session-plan/list` |
| `sessionPlanMigrateLegacy` | `/api/session-plan/migrate-legacy` |
| `sessionPlanReadiness` | `/api/session-plan/readiness` |
| `sessionPlanSelectDimensions` | `/api/session-plan/select-dimensions` |
| `sessionPlanSetList` | `/api/session-plan-set/list` |
| `sessionPlanSetSection` | `/api/session-plan/set-section` |
| `sessionPlanSetShow` | `/api/session-plan-set/show` |
| `sessionPlanSetStatus` | `/api/session-plan/set-status` |
| `sessionPlanSetValidate` | `/api/session-plan-set/validate` |
| `sessionPlanShow` | `/api/session-plan/show` |
| `sessionPlanSkipDimension` | `/api/session-plan/skip-dimension` |
| `spend` | `/api/spend` |
| `stackLayers` | `/api/stack/layers` |
| `stackSync` | `/api/stack/sync` |
| `stackSyncStatus` | `/api/stack/sync/status` |
| `version` | `/api/version` |

## SSE Streams

- `GET /api/daemon-events` — daemon-wide event stream with `stream:hello` snapshot on connect.
- `GET /api/events/:runId` — session-specific event stream with `stream:hello` snapshot on connect.

Use `buildPath(pattern, params)` from `@eforge-build/client` to resolve `:param` placeholders.
