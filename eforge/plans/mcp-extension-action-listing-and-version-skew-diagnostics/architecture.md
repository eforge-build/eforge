# Planner Compiler Architecture

## Summary

Completed synthesis for AC-001..AC-005. Deduplicated all child modules/fragments into one cohesive extension action diagnostics module covering typed list/show action output, contribution guidance, version-skew/stale-daemon hints, budget-aware continuation, and regression tests. No conflicts. One non-blocking AC-004 source-localization diagnostic remains: contribution-list implementation/test paths must be materialized/localized before editing.

## Compiler status

Compiler status: complete
Source hash: 11a6b06dfb11786527d94970694a881c065bea3732f0715d15cbe74d0cc7d521

## Plan boundaries

### module-extension-action-diagnostics — Extension action diagnostics surface

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Aspects: ac-001:interface:command-surface, ac-001:subsystem:cli, ac-001:subsystem:extension, ac-001:subsystem:http, ac-001:subsystem:ids, ac-001:subsystem:list, ac-001:subsystem:names, ac-001:subsystem:show, ac-002:evidence:contribution-list-show, ac-002:interface:extension-surface, ac-003:interface:command-surface, ac-003:interface:extension, ac-003:interface:extension-surface, ac-003:subsystem:cli, ac-003:subsystem:daemon, ac-003:subsystem:extension, ac-003:subsystem:stale-daemon, ac-003:subsystem:version-skew, ac-004:subsystem:continuation, ac-004:subsystem:extension, ac-004:subsystem:offset, ac-004:subsystem:returned, ac-004:subsystem:total, ac-005:interface:test, ac-005:subsystem:extension, ac-005:subsystem:test
Depends on: (none)
Residue: no
Owned files: .claude-plugin/marketplace.json, .claude/skills/eforge-daemon-restart/SKILL.md, .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/index.ts, .pi/extensions/eforge-dev/README.md, .pi/settings.json, AGENTS.md, CHANGELOG.md, CONTRIBUTING.md, contribution/list/show, docs/architecture.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/releasing.md, docs/roadmap.md, docs/webux-workspaces.md, eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/.mcp.json, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/init/init.md, eforge-plugin/skills/profile-new/profile-new.md, eforge-plugin/skills/profile/profile.md, eforge-plugin/skills/recover/recover.md, eforge-plugin/skills/restart/restart.md, eforge-plugin/skills/stack/stack.md, eforge-plugin/skills/status/status.md, eforge-plugin/skills/update/update.md, eforge-plugin/skills/workflow/workflow.md, eforge/dependency-update-evidence.md, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts, eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts, eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts, eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts, eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts, eforge/extensions/eforge-plan/__tests__/prompt-assets.test.ts, eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts, eforge/extensions/eforge-plan/__tests__/registration.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/storage.test.ts, eforge/extensions/eforge-plan/agent-task-actions.ts, eforge/extensions/eforge-plan/json-safe.ts, eforge/extensions/eforge-plan/package.json, eforge/extensions/eforge-plan/README.md, eforge/extensions/eforge-plan/tsconfig.json, eforge/extensions/eforge-plan/workstation-src/plans/package.json, eforge/extensions/eforge-plan/workstation-src/plans/tsconfig.json, eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts, eforge/extensions/eforge-playbooks/json-safe.ts, eforge/extensions/eforge-playbooks/package.json, eforge/extensions/eforge-playbooks/tsconfig.json, eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md, eforge/prds/extract-standalone-eforge-playbooks-extension.md, eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md, examples/extensions/action-contribution.ts, packages/client/src/__tests__/events-schemas-extension-actions.test.ts, packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts, packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts, packages/client/src/__tests__/events-schemas-extension-inputs.test.ts, packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts, packages/client/src/__tests__/extension-agent-task-contributions.test.ts, packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts, packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts, packages/client/src/__tests__/extension-agent-task-curation-map-reduce.test.ts, packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts, packages/client/src/__tests__/extension-agent-tasks.test.ts, packages/client/src/__tests__/extension-contribution-output-formatting.test.ts, packages/client/src/api-version-const.ts, packages/client/src/api-version.ts, packages/client/src/api/daemon.ts, packages/client/src/api/extension-contribution-dispatch.ts, packages/client/src/api/extension-contribution-failure-envelope.ts, packages/client/src/api/extension-contribution-projection-types.ts, packages/client/src/daemon-client.ts, packages/client/src/events/variants/daemon.ts, packages/client/src/extension-contribution-output-formatting.ts, packages/console-ui/components.json, packages/console-ui/package.json, packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx, packages/console-ui/src/hooks/use-daemon-events.ts, packages/console-ui/src/hooks/use-extension-contribution-manifest.ts, packages/console-ui/src/hooks/use-extension-trust-list.ts, packages/console-ui/src/lib/daemon-event-projector.ts, packages/console-ui/src/lib/fetch-json.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/handlers/handle-daemon.ts, packages/console-ui/src/views/system/daemon-section.tsx, packages/console-ui/src/views/system/extension-contribution-card.tsx, packages/console-ui/src/views/system/extension-contribution-rendering.ts, packages/console-ui/src/views/system/json-details.tsx, packages/console-ui/tsconfig.json, packages/docs-gen/src/cli.ts, packages/docs-gen/src/generators/cli.ts, packages/eforge/src/cli.ts, packages/eforge/src/cli/compile-resilience-display.ts, packages/eforge/src/cli/daemon-lifecycle.ts, packages/eforge/src/cli/display.ts, packages/eforge/src/cli/errors.ts, packages/eforge/src/cli/extension-contributions.ts, packages/eforge/src/cli/index.ts, packages/eforge/src/cli/interactive.ts, packages/eforge/src/cli/landing-options.ts, packages/eforge/src/cli/mcp-extension-contributions.ts, packages/engine/src/extensions/contribution-validation.ts, packages/engine/src/extensions/ids.ts, packages/engine/src/planner-compiler/plan-ids.ts, packages/extension-sdk/package.json, packages/extension-sdk/tsconfig.json, packages/monitor/src/__tests__/daemon-event-reactions.test.ts, packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts, packages/monitor/src/__tests__/http-contained-static-file.test.ts, packages/monitor/src/__tests__/http-request.test.ts, packages/monitor/src/__tests__/http-response.test.ts, packages/monitor/src/__tests__/http-router.test.ts, packages/monitor/src/__tests__/http-security.test.ts, packages/monitor/src/__tests__/http-static-assets.test.ts, packages/monitor/src/http/contained-static-file.ts, packages/monitor/src/http/request.ts, packages/monitor/src/http/response.ts, packages/monitor/src/http/route-errors.ts, packages/monitor/src/http/router.ts, packages/monitor/src/http/security.ts, packages/monitor/src/npm-spec-version.ts, packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts, packages/pi-eforge/extensions/eforge/version-compat.ts, scripts/bump-version.mjs, scripts/lib/lockstep-version.mjs, test/api-version-check.test.ts, test/continuation.test.ts, test/daemon-cli-aliases.test.ts, test/evaluator-continuation.test.ts, test/extension-agent-task-contribution-registration.test.ts, test/extension-cli-commands.test.ts, test/extension-contribution-client-helpers.test.ts, test/extension-tooling-routes-list-show.test.ts, test/extension-tooling-wiring-cli.test.ts, test/pi-eforge-version-compat.test.ts, test/profile-list-client-contract.test.ts, test/profile-list-contract-boundary.test.ts, test/recovery-continuation-queue.test.ts, test/retry-continuation-inputs.test.ts, test/review-fixer-continuation.test.ts, test/session-plan-list-client.test.ts
Validation: Run targeted vitest tests for touched extension/CLI/client suites, then broader pnpm test/type-check if practical. Passing behavior preserves action ids/names, shows list-then-show guidance, includes daemon version and remediation hints on skew, and returns continuation metadata without dropping actions.

## Integration contracts

- (none)

## Shared file ownership

- .claude-plugin/marketplace.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .claude/skills/eforge-daemon-restart/SKILL.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .claude/skills/eforge-release/SKILL.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .claude/skills/eval-analysis/SKILL.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .github/workflows/ci.yml: owner module-extension-action-diagnostics (single-atom-evidence)
- .github/workflows/publish.yml: owner module-extension-action-diagnostics (single-atom-evidence)
- .pi/extensions/eforge-dev/index.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/README.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- .pi/settings.json: owner module-extension-action-diagnostics (single-atom-evidence)
- AGENTS.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- CHANGELOG.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- CONTRIBUTING.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- contribution/list/show: owner module-extension-action-diagnostics (single-atom-evidence)
- docs/architecture.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/config-migration.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/config.md: owner module-extension-action-diagnostics (single-atom-evidence)
- docs/extensions-api.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/extensions.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/hooks.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/releasing.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/roadmap.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- docs/webux-workspaces.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/.claude-plugin/plugin.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/.mcp.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/config/config.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/extend/extend.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/init/init.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/profile-new/profile-new.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/profile/profile.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/recover/recover.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/restart/restart.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/stack/stack.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/status/status.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/update/update.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge-plugin/skills/workflow/workflow.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/dependency-update-evidence.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/prompt-assets.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/registration.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/storage.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/agent-task-actions.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/json-safe.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/package.json: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/README.md: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/tsconfig.json: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/package.json: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/tsconfig.json: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-playbooks/json-safe.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-playbooks/package.json: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/extensions/eforge-playbooks/tsconfig.json: owner module-extension-action-diagnostics (single-atom-evidence)
- eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/prds/extract-standalone-eforge-playbooks-extension.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- examples/extensions/action-contribution.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-extension-actions.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-inputs.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-contributions.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-curation-map-reduce.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-tasks.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-contribution-output-formatting.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/api-version-const.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/api-version.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/api/daemon.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/api/extension-contribution-dispatch.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/api/extension-contribution-failure-envelope.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/api/extension-contribution-projection-types.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/daemon-client.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/events/variants/daemon.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/client/src/extension-contribution-output-formatting.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/components.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/package.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/hooks/use-daemon-events.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/hooks/use-extension-contribution-manifest.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/hooks/use-extension-trust-list.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/lib/daemon-event-projector.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/lib/fetch-json.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/handlers/handle-daemon.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/views/system/daemon-section.tsx: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/views/system/extension-contribution-card.tsx: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/views/system/extension-contribution-rendering.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/src/views/system/json-details.tsx: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/console-ui/tsconfig.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/docs-gen/src/cli.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/docs-gen/src/generators/cli.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/compile-resilience-display.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/daemon-lifecycle.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/display.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/errors.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/extension-contributions.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/index.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/interactive.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/landing-options.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/eforge/src/cli/mcp-extension-contributions.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/engine/src/extensions/contribution-validation.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- packages/engine/src/extensions/ids.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/engine/src/planner-compiler/plan-ids.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/extension-sdk/package.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/extension-sdk/tsconfig.json: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/daemon-event-reactions.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/http-contained-static-file.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/http-request.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/http-response.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/http-router.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/http-security.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/http-static-assets.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/http/contained-static-file.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/http/request.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/http/response.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/http/route-errors.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/http/router.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/http/security.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/monitor/src/npm-spec-version.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- packages/pi-eforge/extensions/eforge/version-compat.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- scripts/bump-version.mjs: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- scripts/lib/lockstep-version.mjs: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/api-version-check.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/continuation.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- test/daemon-cli-aliases.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/evaluator-continuation.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- test/extension-agent-task-contribution-registration.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/extension-cli-commands.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/extension-contribution-client-helpers.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/extension-tooling-routes-list-show.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/extension-tooling-wiring-cli.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/pi-eforge-version-compat.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/profile-list-client-contract.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/profile-list-contract-boundary.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)
- test/recovery-continuation-queue.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- test/retry-continuation-inputs.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- test/review-fixer-continuation.test.ts: owner module-extension-action-diagnostics (single-atom-evidence)
- test/session-plan-list-client.test.ts: owner module-extension-action-diagnostics (shared-evidence-primary-owner)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "module-extension-action-diagnostics",
      "title": "Extension action diagnostics surface",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-003",
        "ac-004",
        "ac-005"
      ],
      "aspectIds": [
        "ac-001:interface:command-surface",
        "ac-001:subsystem:cli",
        "ac-001:subsystem:extension",
        "ac-001:subsystem:http",
        "ac-001:subsystem:ids",
        "ac-001:subsystem:list",
        "ac-001:subsystem:names",
        "ac-001:subsystem:show",
        "ac-002:evidence:contribution-list-show",
        "ac-002:interface:extension-surface",
        "ac-003:interface:command-surface",
        "ac-003:interface:extension",
        "ac-003:interface:extension-surface",
        "ac-003:subsystem:cli",
        "ac-003:subsystem:daemon",
        "ac-003:subsystem:extension",
        "ac-003:subsystem:stale-daemon",
        "ac-003:subsystem:version-skew",
        "ac-004:subsystem:continuation",
        "ac-004:subsystem:extension",
        "ac-004:subsystem:offset",
        "ac-004:subsystem:returned",
        "ac-004:subsystem:total",
        "ac-005:interface:test",
        "ac-005:subsystem:extension",
        "ac-005:subsystem:test"
      ],
      "dependsOnPlanIds": []
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude-plugin/marketplace.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/settings.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "contribution/list/show",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/.mcp.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/restart/restart.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/status/status.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/update/update.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/dependency-update-evidence.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/prompt-assets.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/storage.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/agent-task-actions.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/json-safe.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/package.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/README.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/tsconfig.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/package.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/tsconfig.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/json-safe.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/package.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/tsconfig.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/extract-standalone-eforge-playbooks-extension.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "examples/extensions/action-contribution.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-actions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-inputs.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contributions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-curation-map-reduce.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-tasks.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-contribution-output-formatting.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api-version-const.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api-version.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/daemon.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/extension-contribution-dispatch.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/extension-contribution-failure-envelope.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/extension-contribution-projection-types.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/daemon-client.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/events/variants/daemon.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/extension-contribution-output-formatting.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/components.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/package.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/hooks/use-daemon-events.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/hooks/use-extension-contribution-manifest.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/hooks/use-extension-trust-list.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/daemon-event-projector.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/fetch-json.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-daemon.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/views/system/daemon-section.tsx",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/views/system/extension-contribution-card.tsx",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/views/system/extension-contribution-rendering.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/views/system/json-details.tsx",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/tsconfig.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/docs-gen/src/cli.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/docs-gen/src/generators/cli.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/compile-resilience-display.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/daemon-lifecycle.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/display.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/errors.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/extension-contributions.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/index.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/interactive.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/landing-options.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/mcp-extension-contributions.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/extensions/contribution-validation.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/ids.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/planner-compiler/plan-ids.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/extension-sdk/package.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/extension-sdk/tsconfig.json",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/daemon-event-reactions.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/http-contained-static-file.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/http-request.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/http-response.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/http-router.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/http-security.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/http-static-assets.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/http/contained-static-file.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/http/request.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/http/response.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/http/route-errors.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/http/router.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/http/security.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/npm-spec-version.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/pi-eforge/extensions/eforge/version-compat.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "scripts/bump-version.mjs",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "scripts/lib/lockstep-version.mjs",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/api-version-check.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/continuation.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/daemon-cli-aliases.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/evaluator-continuation.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/extension-agent-task-contribution-registration.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-cli-commands.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-contribution-client-helpers.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-tooling-routes-list-show.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-tooling-wiring-cli.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/pi-eforge-version-compat.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/profile-list-client-contract.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/profile-list-contract-boundary.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/recovery-continuation-queue.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/retry-continuation-inputs.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/review-fixer-continuation.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/session-plan-list-client.test.ts",
      "ownerPlanIds": [
        "module-extension-action-diagnostics"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    }
  ],
  "contracts": [],
  "conflicts": []
}
```