<!-- Generated file. Do not edit. -->
<!-- Source: packages/client/src/events.schemas.ts (facade), packages/client/src/events/ -->

# eforge Event Protocol Reference

All events emitted on the eforge SSE stream conform to the `EforgeEvent` discriminated
union exposed by `packages/client/src/events.schemas.ts` and implemented under `packages/client/src/events/`.

Each event carries an optional envelope (`sessionId`, `runId`, `timestamp`) intersected
with one of the variant objects below. The `type` field discriminates the variant.

The JSON Schema also includes a `DaemonStreamSnapshot` definition for the
`stream:hello` snapshot. The snapshot exposes `failedEnqueues` for durable
failed-enqueue attention rows; queue items in that snapshot expose required
`capabilities` plus optional `dispatchFailure` and `hold` projections populated from daemon-owned queue state.

## Event Variants

Total variants: 234

| Event type | Additional fields |
|------------|-------------------|
| `session:start` | `sessionId` |
| `session:end` | `result`, `sessionId` |
| `session:profile` | `config`, `profileName`, `scope`, `source` |
| `phase:start` | `command`, `planSet`, `runId` |
| `phase:end` | `result`, `runId` |
| `config:warning` | `details`, `message`, `source` |
| `planning:warning` | `details`, `message`, `planId`, `source` |
| `planning:module:build-config:invalid` | `errors`, `moduleId`, `reason` |
| `extension:event-handler:failed` | `extensionName`, `extensionPath`, `message`, `pattern`, `stack`, `triggeringEventType` |
| `extension:event-handler:timeout` | `extensionName`, `extensionPath`, `pattern`, `timeoutMs`, `triggeringEventType` |
| `extension:action:start` | `actionId`, `extensionName`, `extensionPath`, `invocationId`, `requestedBy` |
| `extension:action:complete` | `actionId`, `durationMs`, `extensionName`, `extensionPath`, `invocationId`, `requestedBy` |
| `extension:action:failed` | `actionId`, `durationMs`, `errorCode`, `extensionName`, `extensionPath`, `invocationId`, `message`, `requestedBy`, `validationErrors` |
| `extension:action:timeout` | `actionId`, `durationMs`, `extensionName`, `extensionPath`, `invocationId`, `message`, `requestedBy`, `timeoutMs` |
| `extension:agent-task:start` | `extensionName`, `metadata`, `status`, `taskId`, `taskKind` |
| `extension:agent-task:progress` | `extensionName`, `message`, `metadata`, `status`, `taskId`, `taskKind` |
| `extension:agent-task:complete` | `durationMs`, `extensionName`, `metadata`, `status`, `taskId`, `taskKind` |
| `extension:agent-task:failed` | `durationMs`, `errorCode`, `extensionName`, `message`, `metadata`, `status`, `taskId`, `taskKind` |
| `extension:agent-task:cancelled` | `extensionName`, `metadata`, `reason`, `status`, `taskId`, `taskKind` |
| `extension:agent-context:applied` | `extensionName`, `extensionPath`, `fragmentCount`, `harness`, `phase`, `planId`, `profile`, `projectMcpSelection`, `promptCharCount`, `role`, `stage`, `tier`, `toolbelt` |
| `extension:agent-context:failed` | `extensionName`, `extensionPath`, `harness`, `message`, `phase`, `planId`, `profile`, `projectMcpSelection`, `role`, `stack`, `stage`, `tier`, `toolbelt` |
| `extension:agent-context:timeout` | `extensionName`, `extensionPath`, `harness`, `phase`, `planId`, `profile`, `projectMcpSelection`, `role`, `stage`, `tier`, `timeoutMs`, `toolbelt` |
| `extension:agent-context:unsupported` | `extensionName`, `extensionPath`, `fields`, `harness`, `phase`, `planId`, `profile`, `projectMcpSelection`, `role`, `stage`, `tier`, `toolbelt` |
| `extension:agent-tools:applied` | `allowedToolCount`, `allowedToolsAdded`, `disallowedToolCount`, `disallowedToolsAdded`, `effectiveToolNames`, `excludedToolCount`, `excludedToolNames`, `extensionName`, `extensionPath`, `harness`, `inlineToolNames`, `phase`, `planId`, `profile`, `projectMcpSelection`, `projectMcpServerNames`, `registeredToolNames`, `role`, `stage`, `tier`, `toolCount`, `toolNames`, `toolbelt` |
| `queue:profile:selected` | `baseProfile`, `confidence`, `extensionName`, `extensionPath`, `prdId`, `prdTitle`, `profile`, `reason`, `routerName` |
| `queue:profile:router-failed` | `extensionName`, `extensionPath`, `message`, `prdId`, `routerName`, `stack` |
| `queue:profile:router-timeout` | `extensionName`, `extensionPath`, `prdId`, `routerName`, `timeoutMs` |
| `queue:profile:invalid-selection` | `extensionName`, `extensionPath`, `message`, `prdId`, `reason`, `requestedProfile`, `routerName` |
| `extension:policy:decision` | `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `prdId`, `prdTitle`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `prdId`, `prdTitle`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `prdId`, `prdTitle`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `planId`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `planId`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `planId`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `baseBranch`, `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `featureBranch`, `gateKind`, `method`, `planIds`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `baseBranch`, `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `featureBranch`, `gateKind`, `method`, `planIds`, `reason`, `registrationIndex` |
| `extension:policy:decision` | `baseBranch`, `decision`, `extensionName`, `extensionPath`, `failurePolicy`, `featureBranch`, `gateKind`, `method`, `planIds`, `reason`, `registrationIndex` |
| `extension:policy:failed` | `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `message`, `method`, `prdId`, `prdTitle`, `registrationIndex`, `stack` |
| `extension:policy:failed` | `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `message`, `method`, `planId`, `registrationIndex`, `stack` |
| `extension:policy:failed` | `baseBranch`, `extensionName`, `extensionPath`, `failurePolicy`, `featureBranch`, `gateKind`, `message`, `method`, `planIds`, `registrationIndex`, `stack` |
| `extension:policy:timeout` | `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `prdId`, `prdTitle`, `registrationIndex`, `timeoutMs` |
| `extension:policy:timeout` | `extensionName`, `extensionPath`, `failurePolicy`, `gateKind`, `method`, `planId`, `registrationIndex`, `timeoutMs` |
| `extension:policy:timeout` | `baseBranch`, `extensionName`, `extensionPath`, `failurePolicy`, `featureBranch`, `gateKind`, `method`, `planIds`, `registrationIndex`, `timeoutMs` |
| `extension:input-source:fetched` | `adapterName`, `contentLength`, `extensionName`, `extensionPath`, `sourceId` |
| `extension:input-source:failed` | `adapterName`, `extensionName`, `extensionPath`, `message`, `reason`, `sourceId`, `stack`, `timeoutMs` |
| `extension:prd-enricher:applied` | `changed`, `enricherName`, `extensionName`, `extensionPath`, `inputLength`, `outputLength`, `sourceId` |
| `extension:prd-enricher:failed` | `enricherName`, `extensionName`, `extensionPath`, `message`, `reason`, `sourceId`, `stack`, `timeoutMs` |
| `extension:reviewer-perspective:applied` | `extensionName`, `extensionPath`, `perspectiveKey`, `perspectiveLabel`, `planId` |
| `extension:validation-provider:start` | `commandCount`, `extensionName`, `extensionPath`, `kind`, `planId`, `providerName` |
| `extension:validation-provider:complete` | `extensionName`, `extensionPath`, `message`, `planId`, `providerName`, `status` |
| `extension:validation-provider:error` | `command`, `details`, `exitCode`, `extensionName`, `extensionPath`, `message`, `planId`, `providerName`, `status` |
| `extension:validation-provider:timeout` | `command`, `extensionName`, `extensionPath`, `planId`, `providerName`, `timeoutMs` |
| `planning:start` | `label`, `source` |
| `planning:inspection-summary` | `artifactPath`, `summary` |
| `planning:skip` | `reason` |
| `planning:submission` | `hasMigrations`, `planCount`, `totalBodySize` |
| `planning:error` | `reason` |
| `planning:scope-context:failure` | `failure`, `runId` |
| `planning:decomposition:start` | `edgeCount`, `graphId`, `limits`, `rootUnitId`, `runId`, `sessionId`, `timestamp`, `unitCount` |
| `planning:decomposition:unit:queued` | `runId`, `sessionId`, `timestamp`, `unit` |
| `planning:decomposition:unit:running` | `runId`, `sessionId`, `timestamp`, `unitId` |
| `planning:decomposition:unit:progress` | `message`, `observed`, `runId`, `sessionId`, `timestamp`, `unitId` |
| `planning:decomposition:unit:completed` | `runId`, `sessionId`, `timestamp`, `unit` |
| `planning:decomposition:unit:skipped` | `reason`, `runId`, `sessionId`, `timestamp`, `unit`, `unitId` |
| `planning:decomposition:unit:failed` | `evidence`, `reason`, `runId`, `sessionId`, `timestamp`, `unitId` |
| `planning:decomposition:schedule` | `decision`, `runId`, `sessionId`, `timestamp` |
| `planning:decomposition:budget` | `limits`, `observed`, `runId`, `sessionId`, `timestamp`, `unitBudgets`, `unitId` |
| `planning:decomposition:compact-handoff` | `artifactPath`, `byteLength`, `contentHash`, `omittedUnitIds`, `runId`, `sessionId`, `timestamp`, `unitId` |
| `planning:decomposition:synthesis:complete` | `artifactPaths`, `completedUnitCount`, `coverage`, `failedUnitCount`, `runId`, `sessionId`, `skippedUnitCount`, `timestamp`, `unitCount` |
| `planning:clarification` | `questions` |
| `planning:clarification:answer` | `answers` |
| `planning:progress` | `message` |
| `planning:continuation` | `attempt`, `maxContinuations`, `reason` |
| `planning:pipeline` | `compile`, `defaultBuild`, `defaultReview`, `rationale` |
| `planning:complete` | `planConfigs`, `plans` |
| `planning:review:start` | - |
| `planning:review:complete` | `issues` |
| `planning:evaluate:start` | - |
| `planning:evaluate:continuation` | `attempt`, `maxContinuations` |
| `planning:evaluate:complete` | `accepted`, `rejected`, `verdicts` |
| `planning:map-reduce:atoms` | `atomCount`, `atoms`, `edgeCount`, `edges`, `graphId` |
| `planning:map-reduce:atom:status` | `atomId`, `reason`, `status` |
| `planning:map-reduce:reduce-tree` | `graphId`, `maxDepth`, `nodeCount`, `nodes`, `rootNodeId` |
| `planning:map-reduce:reduce:status` | `nodeId`, `reason`, `status` |
| `plan:build:start` | `planId` |
| `plan:build:implement:start` | `planId` |
| `plan:build:implement:progress` | `message`, `planId` |
| `plan:build:implement:continuation` | `attempt`, `maxContinuations`, `planId`, `shardId` |
| `plan:build:implement:complete` | `planId` |
| `plan:build:files_changed` | `baseBranch`, `diffs`, `files`, `planId` |
| `plan:build:review:start` | `planId`, `round` |
| `plan:build:review:complete` | `issues`, `planId`, `round` |
| `plan:build:review:parallel:start` | `perspectives`, `planId`, `round` |
| `plan:build:review:parallel:perspective:start` | `perspective`, `planId`, `round` |
| `plan:build:review:parallel:perspective:complete` | `issues`, `perspective`, `planId`, `round` |
| `plan:build:review:parallel:perspective:error` | `error`, `perspective`, `planId`, `round` |
| `plan:build:review:fix:start` | `issueCount`, `planId`, `round` |
| `plan:build:review:fix:complete` | `issueReferences`, `planId`, `round` |
| `plan:build:review:fix:continuation` | `attempt`, `maxContinuations`, `planId`, `round` |
| `plan:build:evaluate:start` | `planId`, `round` |
| `plan:build:evaluate:continuation` | `attempt`, `maxContinuations`, `planId`, `round` |
| `plan:build:evaluate:complete` | `accepted`, `acceptedRiskIssueOutcomes`, `blockingIssueOutcomes`, `falsePositiveIssueOutcomes`, `needsHumanReviewIssueOutcomes`, `planId`, `rejected`, `resolvedIssueOutcomes`, `round`, `splitToFollowupIssueOutcomes`, `unresolvedIssueOutcomes`, `unresolvedNonBlockingIssueOutcomes`, `verdicts` |
| `plan:build:doc-author:start` | `planId` |
| `plan:build:doc-author:complete` | `docsAuthored`, `planId` |
| `plan:build:doc-sync:start` | `planId` |
| `plan:build:doc-sync:complete` | `docsSynced`, `planId` |
| `plan:build:test:write:start` | `planId` |
| `plan:build:test:write:complete` | `planId`, `testsWritten` |
| `plan:build:test:start` | `planId` |
| `plan:build:test:complete` | `failed`, `passed`, `planId`, `productionIssues`, `testBugsFixed` |
| `plan:build:complete` | `planId` |
| `plan:build:failed` | `error`, `planId`, `terminalSubtype` |
| `plan:build:progress` | `message`, `planId` |
| `plan:status:change` | `planId`, `status` |
| `plan:error:set` | `error`, `planId` |
| `plan:error:clear` | `planId` |
| `schedule:start` | `planIds` |
| `plan:schedule:ready` | `planId`, `reason` |
| `plan:merge:start` | `planId` |
| `plan:merge:complete` | `commitSha`, `planId` |
| `plan:merge:resolve:start` | `planId` |
| `plan:merge:resolve:complete` | `planId`, `resolved` |
| `merge:finalize:start` | `baseBranch`, `featureBranch` |
| `merge:finalize:complete` | `baseBranch`, `commitSha`, `featureBranch` |
| `merge:finalize:skipped` | `baseBranch`, `featureBranch`, `reason` |
| `landing:start` | `action`, `baseBranch`, `featureBranch`, `trunkBranch`, `workflow` |
| `landing:complete` | `action`, `baseBranch`, `commitSha`, `featureBranch`, `prUrl` |
| `landing:skipped` | `action`, `baseBranch`, `featureBranch`, `reason` |
| `landing:auto-merge:start` | `baseBranch`, `featureBranch`, `prUrl` |
| `landing:auto-merge:complete` | `baseBranch`, `featureBranch`, `prUrl` |
| `landing:auto-merge:skipped` | `baseBranch`, `featureBranch`, `prUrl`, `reason` |
| `merge:worktree:set` | `path` |
| `merge:worktree:clear` | - |
| `agent:start` | `agent`, `agentId`, `effort`, `effortClamped`, `effortOriginal`, `effortSource`, `harness`, `harnessSource`, `model`, `perspective`, `planId`, `projectMcpSelection`, `projectMcpServerNames`, `runtimeChoice`, `runtimeChoiceFallbackReason`, `runtimeChoiceQualified`, `runtimeChoiceRouter`, `runtimeChoiceRule`, `runtimeChoiceSource`, `thinking`, `thinkingCoerced`, `thinkingOriginal`, `thinkingSource`, `tier`, `tierSource`, `toolbelt`, `toolbeltSource` |
| `agent:warning` | `agent`, `agentId`, `code`, `message`, `planId` |
| `agent:stop` | `agent`, `agentId`, `error`, `planId` |
| `agent:usage` | `agent`, `agentId`, `costUsd`, `final`, `numTurns`, `planId`, `usage` |
| `agent:message` | `agent`, `agentId`, `content`, `planId` |
| `agent:tool_use` | `agent`, `agentId`, `input`, `planId`, `tool`, `toolUseId` |
| `agent:tool_result` | `agent`, `agentId`, `output`, `planId`, `tool`, `toolUseId` |
| `agent:result` | `agent`, `agentId`, `planId`, `result` |
| `agent:activity` | `agent`, `agentId`, `attribution`, `files`, `notes`, `planId`, `totals` |
| `agent:retry` | `agent`, `attempt`, `label`, `maxAttempts`, `planId`, `shardId`, `subtype` |
| `validation:start` | `commands` |
| `validation:command:start` | `command` |
| `validation:command:complete` | `command`, `exitCode`, `output` |
| `validation:command:timeout` | `command`, `pid`, `timeoutMs` |
| `validation:complete` | `passed` |
| `validation:fix:start` | `attempt`, `maxAttempts` |
| `validation:fix:complete` | `attempt` |
| `prd_validation:start` | - |
| `prd_validation:complete` | `completionPercent`, `gaps`, `passed` |
| `gap_close:start` | `completionPercent`, `gapCount` |
| `gap_close:plan_ready` | `gaps`, `planBody` |
| `gap_close:complete` | `passed` |
| `acceptance_validation:complete` | `acceptanceConflicts`, `passed`, `source`, `verdicts`, `waivers` |
| `reconciliation:start` | - |
| `reconciliation:complete` | `report` |
| `cleanup:start` | `planSet` |
| `cleanup:complete` | `planSet` |
| `approval:needed` | `action`, `details`, `planId` |
| `approval:response` | `approved` |
| `enqueue:start` | `source` |
| `enqueue:complete` | `filePath`, `id`, `planSet`, `title` |
| `enqueue:failed` | `error` |
| `enqueue:commit-failed` | `error` |
| `recovery:start` | `prdId`, `setName` |
| `recovery:summary` | `prdId`, `summary` |
| `recovery:complete` | `prdId`, `sidecarJsonPath`, `sidecarMdPath`, `verdict` |
| `recovery:error` | `error`, `prdId`, `rawOutput` |
| `recovery:auto-resume:evaluate` | `attempt`, `enabled`, `maxAttempts`, `prdId`, `setName` |
| `recovery:auto-resume:queued` | `action`, `attempt`, `maxAttempts`, `prdId`, `setName` |
| `recovery:auto-resume:stopped` | `attempt`, `maxAttempts`, `message`, `prdId`, `reason`, `setName` |
| `recovery:apply:start` | `prdId` |
| `recovery:apply:complete` | `noAction`, `prdId`, `verdict` |
| `recovery:apply:error` | `message`, `prdId` |
| `daemon:run:upsert` | `run` |
| `daemon:auto-build:paused` | `reason` |
| `daemon:lifecycle:starting` | `mode`, `pid`, `port`, `version` |
| `daemon:lifecycle:ready` | `mode`, `pid`, `port`, `recoveryDurationMs`, `version` |
| `daemon:lifecycle:shutdown:start` | `reason`, `signal` |
| `daemon:lifecycle:shutdown:complete` | `durationMs` |
| `daemon:heartbeat` | `autoBuild`, `queueDepth`, `runningBuilds`, `subscribers`, `uptime` |
| `daemon:scheduler:dequeued` | `capacityRemaining`, `prdId`, `queueDepth` |
| `daemon:scheduler:capacity-blocked` | `limit`, `queueDepth`, `runningCount` |
| `daemon:scheduler:dependency-blocked` | `blockedBy`, `prdId` |
| `daemon:scheduler:paused` | - |
| `daemon:scheduler:resumed` | - |
| `daemon:auto-build:enabled` | - |
| `daemon:auto-build:disabled` | - |
| `daemon:auto-build:resumed` | - |
| `daemon:auto-build:triggered` | `prdsEnqueued`, `trigger` |
| `daemon:auto-build:transition` | `desired`, `nextMode`, `previousMode`, `reason`, `source` |
| `daemon:recovery:start` | - |
| `daemon:recovery:run-marked-failed` | `planSet`, `reason`, `runId` |
| `daemon:recovery:lock-removed` | `path`, `pid` |
| `daemon:recovery:lock-adopted` | `path`, `pid`, `prdId` |
| `daemon:recovery:complete` | `durationMs`, `locksRemoved`, `runsFailed` |
| `daemon:orphan:reaped` | `pid`, `planSet`, `runId`, `sessionId` |
| `daemon:failed-enqueue:upsert` | `failedEnqueue` |
| `daemon:failed-enqueue:resolved` | `resolvedAt`, `runId`, `spawnedSessionId` |
| `daemon:warning` | `details`, `message`, `source` |
| `daemon:error` | `message`, `source`, `stack` |
| `queue:start` | `dir`, `prdCount` |
| `queue:prd:start` | `prdId`, `title` |
| `queue:prd:discovered` | `dependsOn`, `prdId`, `title` |
| `queue:prd:dependency-overridden` | `currentDependsOn`, `prdId`, `previousDependsOn`, `reason`, `removedDependency`, `title` |
| `queue:prd:removed` | `prdId`, `previousStatus`, `removedSidecars` |
| `queue:prd:stale` | `justification`, `prdId`, `revision`, `title`, `verdict` |
| `queue:prd:skip` | `prdId`, `reason` |
| `queue:prd:dispatch-failed` | `prdId`, `reason`, `stage`, `title` |
| `queue:prd:commit-failed` | `error`, `prdId`, `title` |
| `queue:prd:complete` | `prdId`, `status` |
| `queue:complete` | `processed`, `skipped` |
| `plan:build:decision` | `decision`, `planId` |
| `planning:decision` | `decision`, `planId` |
| `stack:layer:recorded` | `artifact`, `baseBranch`, `branch`, `landingAction`, `parentPrdId`, `prdId`, `provider`, `stackId`, `status` |
| `stack:provider:command` | `args`, `branch`, `command`, `exitCode`, `provider` |
| `stack:landing:update` | `action`, `baseRepairReason`, `branch`, `effectiveBaseBranch`, `originalBaseBranch`, `prUrl`, `prdId`, `reason`, `stackId`, `status` |
| `stack:landing:conflict:detected` | `branch`, `conflictKind`, `conflictedFiles`, `operation`, `prdId`, `provider`, `stackId` |
| `stack:landing:conflict:recovery:start` | `attempt`, `branch`, `maxAttempts`, `prdId`, `provider`, `stackId` |
| `stack:landing:conflict:recovery:complete` | `attempts`, `branch`, `prdId`, `provider`, `stackId` |
| `stack:landing:conflict:recovery:failed` | `abortAttempted`, `abortSucceeded`, `attempts`, `branch`, `prdId`, `provider`, `reason`, `stackId` |
| `stack:sync:start` | `dryRun`, `syncId`, `trigger` |
| `stack:sync:complete` | `dryRun`, `excludedCandidates`, `fastForward`, `localTrunkSha`, `originTrunkSha`, `reason`, `restackCandidates`, `syncId`, `trigger` |
| `stack:sync:failed` | `dryRun`, `error`, `outcome`, `reason`, `syncId`, `trigger` |
| `stack:sync:deferred` | `excludedCandidates`, `reason`, `syncId`, `trigger` |
| `stack:sync:skipped` | `dryRun`, `excludedCandidates`, `reason`, `restackCandidates`, `syncId`, `trigger` |
| `build:terminal-failure` | `failure`, `runId` |
| `build:resume:start` | `featureBranch`, `prdId`, `setName` |
| `build:resume:state` | `diffStat`, `featureBranch`, `landedCommitCount`, `seededMerged`, `seededPending` |
| `build:resume:ineligible` | `checkedPath`, `reason` |
| `build:resume:artifacts` | `artifactCommit`, `artifactSource`, `featureBranch`, `orchestration`, `plans`, `prdId`, `setName`, `source` |
| `build:resume:complete` | `prdId`, `setName` |

## JSON Schema

The complete machine-readable schema is at [`/schemas/events.schema.json`](/schemas/events.schema.json).
Use `safeParseEforgeEvent(value)` from `@eforge-build/client` to validate at runtime.
