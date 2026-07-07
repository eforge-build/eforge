# Planner Compiler Architecture

## Summary

Merged child digests into three buildable modules: (1) recovery core policy/config/defaults/budget/signature/docs/tests, (2) client-owned events/schema/projection plus manual route contract regression, and (3) Console recovery display/controls. No conflicts. One repair-only source/localization gap remains for unmaterialized recovery helper and config/docs owner evidence; implementers must inspect owners before exact edits.

## Compiler status

Compiler status: complete
Source hash: 950fb32e7d5de61a6ab998d8f4a216d527dc1272bca4e90d9828a6dd82bde1f4

## Plan boundaries

### core-policy-config — Recovery core policy/config

Criteria: ac-001, ac-002, ac-003, ac-004, ac-008
Aspects: ac-001:interface:configuration, ac-002:subsystem:apply, ac-002:subsystem:resume, ac-002:subsystem:resumes, ac-002:subsystem:wakes, ac-003:evidence:gates-holds-approvals, ac-003:evidence:manual-retry-abandon, ac-004:general:general, ac-008:interface:config, ac-008:interface:configuration, ac-008:interface:docs, ac-008:interface:test, ac-008:subsystem:config, ac-008:subsystem:docs, ac-008:subsystem:integration, ac-008:subsystem:reference, ac-008:subsystem:test, ac-008:subsystem:unit
Depends on: (none)
Residue: no
Owned files: docs/architecture.md, docs/images/claude-code-handoff.png, docs/images/console-recovery-build.png, docs/images/eforge-commits.png, docs/images/monitor-timeline.png, eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/skills/profile-new/profile-new.md, eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts, eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts, eforge/extensions/eforge-plan/backlog-curation-apply.ts, eforge/extensions/eforge-plan/canonical/search-dirty.ts, eforge/extensions/eforge-plan/tsup.config.ts, eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js, eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts, eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts, eforge/extensions/eforge-playbooks/tsup.config.ts, gates/holds/approvals, manual/retry/abandon, packages/client/src/api/apply-recovery.ts, packages/client/src/api/config.ts, packages/client/tsup.config.ts, packages/console-ui/postcss.config.js, packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx, packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts, packages/console-ui/src/lib/run-state/handlers/handle-resume.ts, packages/engine/src/config.ts, packages/engine/src/evaluation/apply.ts, packages/engine/src/orchestrator/validation-dirty-worktree.ts, packages/engine/src/planning-quality/apply-fixes.ts, packages/engine/src/queue/resume-cascade.ts, packages/engine/src/recovery/apply.ts, packages/engine/src/recovery/failed-resume-sidecar-finalization.ts, packages/engine/src/recovery/resume-sidecar.ts, packages/engine/src/resume/compiled-build.ts, packages/engine/src/resume/prd-content.ts, packages/engine/src/resume/queued-resume.ts, packages/engine/src/resume/resume-projection.ts, test/apply-recovery-accept-success.test.ts, test/apply-recovery.test.ts, test/orchestration-validation-gates.test.ts, web/public/reference/api.md
Validation: Author tests for default-off config, config validation, positive handoff, blockers, attempt budget, and repeated signatures; run relevant docs/reference drift checks.

### client-contracts-routes — Client contracts, projection, routes

Criteria: ac-005, ac-007
Aspects: ac-005:evidence:queue-run-auto-build, ac-007:interface:route, ac-007:interface:route-api, ac-007:interface:schema, ac-007:interface:schema-contract, ac-007:interface:test, ac-007:subsystem:event, ac-007:subsystem:route, ac-007:subsystem:schema, ac-007:subsystem:test
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .pi/extensions/eforge-dev/event-tail.ts, .pi/extensions/eforge-dev/index.ts, .pi/extensions/eforge-dev/README.md, AGENTS.md, CHANGELOG.md, CONTRIBUTING.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/llm-friendly-code.md, docs/releasing.md, docs/roadmap.md, docs/stacking.md, docs/webux-workspaces.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/init/init.md, eforge-plugin/skills/recover/recover.md, eforge-plugin/skills/stack/stack.md, eforge-plugin/skills/workflow/workflow.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts, eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts, eforge/extensions/eforge-plan/__tests__/package-publication.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts, eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts, eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts, eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts, eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts, eforge/extensions/eforge-plan/draft-plan-unit-actions.ts, eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts, eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts, eforge/extensions/eforge-plan/draft-plan-unit-store.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx, eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts, eforge/extensions/eforge-playbooks/run-playbook-action.ts, examples/extensions/minimal-event-logger.ts, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/events-schemas-auto-build.test.ts, packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts, packages/client/src/__tests__/queue-control-contracts.test.ts, packages/client/src/__tests__/queue-recovery.test.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/__tests__/terminal-failure-event.test.ts, packages/client/src/api/queue-recovery.ts, packages/client/src/api/queue.ts, packages/client/src/browser-queue-control.ts, packages/client/src/browser-queue-recovery.ts, packages/client/src/event-projections/queue.ts, packages/client/src/event-registry.ts, packages/client/src/event-validation.ts, packages/client/src/events/queue-events.ts, packages/client/src/events/snapshots.ts, packages/client/src/events/variants/agents.ts, packages/client/src/events/variants/build.ts, packages/client/src/events/variants/daemon.ts, packages/client/src/events/variants/extensions.ts, packages/client/src/events/variants/planning-map-reduce.ts, packages/client/src/events/variants/session-planning.ts, packages/client/src/events/variants/stack.ts, packages/client/src/events/variants/validation-recovery.ts, packages/client/src/routes/route-map.ts, packages/client/src/run-status.ts, packages/client/src/schema-utils.ts, packages/client/src/types.ts, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx, packages/console-ui/src/components/activity/activity-drawer/activity-event-row.tsx, packages/console-ui/src/components/activity/activity-drawer/raw-event-panel.tsx, packages/console-ui/src/components/header/auto-build-toggle.tsx, packages/console-ui/src/components/now/queue-action-disabled-reason.tsx, packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx, packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx, packages/console-ui/src/components/recovery/accept-success-action.tsx, packages/console-ui/src/components/recovery/advanced-cascade-section.tsx, packages/console-ui/src/components/recovery/compile-scope-context-options.tsx, packages/console-ui/src/components/recovery/confirm-action.tsx, packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx, packages/console-ui/src/components/recovery/recovery-completion-panel.tsx, packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx, packages/console-ui/src/components/recovery/recovery-report-panel.tsx, packages/console-ui/src/components/recovery/safe-markdown.tsx, packages/console-ui/src/components/recovery/verdict-chip.tsx, packages/console-ui/src/components/shell/route-placeholder.tsx, packages/console-ui/src/components/timeline/__tests__/event-card.test.ts, packages/console-ui/src/components/timeline/event-card.tsx, packages/console-ui/src/hooks/use-auto-build.test.tsx, packages/console-ui/src/hooks/use-auto-build.ts, packages/console-ui/src/hooks/use-run-detail.ts, packages/console-ui/src/lib/daemon-event-projector.ts, packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts, packages/docs-gen/src/generators/config.ts, packages/docs-gen/tsup.config.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/test/config.legacy-rejection.test.ts, packages/engine/test/plan-file.agent-config.test.ts, packages/extension-sdk/src/schema.ts, packages/input/src/session-plan-set/schema.ts, packages/monitor/src/__tests__/accept-success-projection-parity.test.ts, packages/monitor/src/__tests__/agent-task-events.test.ts, packages/monitor/src/__tests__/auto-build-route.test.ts, packages/monitor/src/__tests__/auto-build-supervisor.test.ts, packages/monitor/src/__tests__/context.test.ts, packages/monitor/src/__tests__/daemon-sse-handshake.test.ts, packages/monitor/src/__tests__/daily-spend-db.test.ts, packages/monitor/src/__tests__/db.test.ts, packages/monitor/src/__tests__/efficiency-analytics-db.test.ts, packages/monitor/src/__tests__/efficiency-analytics-route.test.ts, packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts, packages/monitor/src/__tests__/failed-enqueue-projection.test.ts, packages/monitor/src/__tests__/projections-auto-build-state.test.ts, packages/monitor/src/__tests__/projections-config-redaction.test.ts, packages/monitor/src/__tests__/projections-event-run-state.test.ts, packages/monitor/src/__tests__/resume-plans-route.test.ts, packages/monitor/src/__tests__/route-test-harness.ts, packages/monitor/src/__tests__/routes-config-context.test.ts, packages/monitor/src/__tests__/routes-config-profile-stack.test.ts, packages/monitor/src/__tests__/stack-layers-route.test.ts, packages/monitor/src/auto-build-supervisor.ts, packages/monitor/src/http/route-errors.ts, packages/monitor/src/projections/auto-build-state.ts, packages/monitor/src/projections/queue-items.ts, packages/monitor/src/projections/runs.ts, packages/monitor/src/routes/continue-repair-service.ts, packages/monitor/src/routes/recovery.ts, packages/monitor/src/server-main.ts, packages/pi-eforge/skills/eforge-recover/SKILL.md, Queue/run/auto-build, README.md, test/agent-config.mixed-harness.test.ts, test/api-route-helpers.ts, test/apply-recovery-route.test.ts, test/auto-build-pause-on-failure.test.ts, test/auto-build-resume-after-failure.test.ts, test/build-single-prd-event-ordering.test.ts, test/cli-display-render-event.test.ts, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/continue-repair-eligibility-route.test.ts, test/continue-repair-route.test.ts, test/docs-gen-determinism.test.ts, test/extension-event-runtime.test.ts, test/files-changed-event.test.ts, test/lifecycle-event-emission.test.ts, test/planning-compiler-stage-integration.test.ts, test/queue-recovery-route.test.ts, test/recovery-verdict-schema.test.ts, test/reference-content.test.ts, test/retry-stub-harness-integration.test.ts, test/sdk-event-mapping.test.ts, test/stack-sync-route.test.ts, test/validation-provider-event-schema.test.ts, test/worktree-integration.test.ts, web/app/reference/[slug]/page.tsx, web/app/reference/layout.tsx, web/app/reference/page.tsx, web/content/reference/api.md, web/content/reference/cli.md, web/content/reference/config.md, web/content/reference/events.md, web/content/reference/tools.md, web/public/reference/config.md
Validation: Author client schema parity and projection tests; exercise existing manual recovery route tests after contract changes.

### console-recovery-ui — Console recovery display/controls

Criteria: ac-005, ac-006
Aspects: ac-005:evidence:queue-run-auto-build, ac-006:general:general
Depends on: client-contracts-routes, core-policy-config
Residue: no
Owned files: .pi/extensions/eforge-dev/index.ts, eforge-plugin/skills/workflow/workflow.md, eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts, eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts, eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts, eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts, eforge/extensions/eforge-playbooks/run-playbook-action.ts, packages/client/src/__tests__/events-schemas-auto-build.test.ts, packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts, packages/client/src/__tests__/queue-control-contracts.test.ts, packages/client/src/__tests__/queue-recovery.test.ts, packages/client/src/api/queue-recovery.ts, packages/client/src/api/queue.ts, packages/client/src/browser-queue-control.ts, packages/client/src/browser-queue-recovery.ts, packages/client/src/events/queue-events.ts, packages/client/src/run-status.ts, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/components/header/auto-build-toggle.tsx, packages/console-ui/src/components/now/queue-action-disabled-reason.tsx, packages/console-ui/src/hooks/use-auto-build.test.tsx, packages/console-ui/src/hooks/use-auto-build.ts, packages/console-ui/src/hooks/use-run-detail.ts, packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts, packages/monitor/src/__tests__/projections-auto-build-state.test.ts, packages/monitor/src/auto-build-supervisor.ts, packages/monitor/src/projections/auto-build-state.ts, Queue/run/auto-build, test/auto-build-pause-on-failure.test.ts, test/auto-build-resume-after-failure.test.ts
Validation: Author Console render/control tests for projected fields, visible manual controls, and action-source labeling.

## Integration contracts

- console-recovery-ui -> client-contracts-routes (interface config): Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface docs): Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface route): Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface route-api): Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface schema): Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (interface test): Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface config): Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface docs): Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface route): Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface route-api): Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface schema): Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- core-policy-config -> client-contracts-routes (interface test): Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- console-recovery-ui -> client-contracts-routes (plan dependency): console-recovery-ui builds on Client contracts, projection, routes
- console-recovery-ui -> core-policy-config (plan dependency): console-recovery-ui builds on Recovery core policy/config
- client-contracts-routes -> core-policy-config (shared file docs/images/console-recovery-build.png): shared-evidence-primary-owner
- client-contracts-routes -> core-policy-config (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file .claude/skills/eval-analysis/SKILL.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file .github/workflows/ci.yml): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file AGENTS.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file CHANGELOG.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file CONTRIBUTING.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/config-migration.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/config.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/extensions-api.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/extensions.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/hooks.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/releasing.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/roadmap.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/stacking.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge-plugin/skills/recover/recover.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge-plugin/skills/stack/stack.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/config.yaml): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-actions.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-store.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/client/src/event-projections/queue.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/docs-gen/src/generators/config.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/docs-gen/tsup.config.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/engine/src/planner-compiler/compile-stage-integration.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/engine/test/config.legacy-rejection.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/engine/test/plan-file.agent-config.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/auto-build-route.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/auto-build-supervisor.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/efficiency-analytics-route.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/projections-config-redaction.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/resume-plans-route.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/route-test-harness.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/routes-config-context.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/routes-config-profile-stack.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file packages/monitor/src/__tests__/stack-layers-route.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file README.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/apply-recovery-route.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/config-schema.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/docs-gen-determinism.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/planning-compiler-stage-integration.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/queue-recovery-route.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/reference-content.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/retry-stub-harness-integration.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file test/worktree-integration.test.ts): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/app/reference/[slug]/page.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/app/reference/layout.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/app/reference/page.tsx): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/content/reference/api.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/content/reference/cli.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/content/reference/config.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/content/reference/events.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/content/reference/tools.md): shared-evidence-primary-owner
- console-recovery-ui -> client-contracts-routes (shared file web/public/reference/config.md): shared-evidence-primary-owner
- console-recovery-ui -> core-policy-config (shared file docs/images/console-recovery-build.png): shared-evidence-primary-owner
- console-recovery-ui -> core-policy-config (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- console-recovery-ui -> core-policy-config (shared file packages/engine/src/config.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .claude/skills/eval-analysis/SKILL.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .github/workflows/ci.yml): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .pi/extensions/eforge-dev/event-tail.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file AGENTS.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file CHANGELOG.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file CONTRIBUTING.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/config-migration.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/config.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/extensions-api.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/extensions.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/hooks.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/releasing.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/roadmap.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/stacking.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/skills/recover/recover.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/skills/stack/stack.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge-plugin/skills/workflow/workflow.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/config.yaml): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-actions.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/draft-plan-unit-store.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/schema.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/sqlite/schema.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file examples/extensions/minimal-event-logger.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/client/src/__tests__/events-schema-shape.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/client/src/__tests__/events-schema-test-helpers.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/client/src/__tests__/schema-utils.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/client/src/__tests__/terminal-failure-event.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/client/src/routes/route-map.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/client/src/schema-utils.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/console-ui/src/components/timeline/__tests__/event-card.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/docs-gen/src/generators/config.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/docs-gen/tsup.config.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/engine/src/planner-compiler/compile-stage-integration.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/engine/test/config.legacy-rejection.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/engine/test/plan-file.agent-config.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/extension-sdk/src/schema.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/auto-build-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/efficiency-analytics-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/projections-config-redaction.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/projections-event-run-state.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/resume-plans-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/route-test-harness.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/routes-config-context.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/routes-config-profile-stack.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file packages/monitor/src/__tests__/stack-layers-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file README.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/api-route-helpers.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/apply-recovery-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/auto-build-resume-after-failure.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/build-single-prd-event-ordering.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/cli-display-render-event.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/config-schema.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/config.agent-runtimes.schema.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/continue-repair-eligibility-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/continue-repair-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/docs-gen-determinism.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/extension-event-runtime.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/files-changed-event.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/lifecycle-event-emission.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/planning-compiler-stage-integration.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/queue-recovery-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/recovery-verdict-schema.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/reference-content.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/retry-stub-harness-integration.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/sdk-event-mapping.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/stack-sync-route.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/validation-provider-event-schema.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file test/worktree-integration.test.ts): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/app/reference/[slug]/page.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/app/reference/layout.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/app/reference/page.tsx): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/content/reference/api.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/content/reference/cli.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/content/reference/config.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/content/reference/events.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/content/reference/tools.md): shared-evidence-primary-owner
- core-policy-config -> client-contracts-routes (shared file web/public/reference/config.md): shared-evidence-primary-owner
- core-policy-config -> console-recovery-ui (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- core-policy-config -> console-recovery-ui (shared file eforge-plugin/skills/workflow/workflow.md): shared-evidence-primary-owner
- core-policy-config -> console-recovery-ui (shared file eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts): shared-evidence-primary-owner
- core-policy-config -> console-recovery-ui (shared file test/auto-build-resume-after-failure.test.ts): shared-evidence-primary-owner

## Shared file ownership

- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- .claude/skills/eforge-release/SKILL.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- .claude/skills/eval-analysis/SKILL.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- .github/workflows/ci.yml: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/event-tail.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/index.ts: owner client-contracts-routes, console-recovery-ui; consumers core-policy-config (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/README.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- AGENTS.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- CHANGELOG.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- CONTRIBUTING.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/architecture.md: owner core-policy-config (single-atom-evidence)
- docs/config-migration.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/config.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/extensions-api.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/extensions.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/hooks.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/images/claude-code-handoff.png: owner core-policy-config (single-atom-evidence)
- docs/images/console-recovery-build.png: owner core-policy-config; consumers client-contracts-routes, console-recovery-ui (shared-evidence-primary-owner)
- docs/images/eforge-commits.png: owner core-policy-config (single-atom-evidence)
- docs/images/monitor-timeline.png: owner core-policy-config (single-atom-evidence)
- docs/llm-friendly-code.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/releasing.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/roadmap.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/stacking.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- docs/webux-workspaces.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/.claude-plugin/plugin.json: owner core-policy-config (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/skills/config/config.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/skills/extend/extend.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/skills/init/init.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/skills/profile-new/profile-new.md: owner core-policy-config; consumers client-contracts-routes, console-recovery-ui (shared-evidence-primary-owner)
- eforge-plugin/skills/recover/recover.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/skills/stack/stack.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge-plugin/skills/workflow/workflow.md: owner client-contracts-routes, console-recovery-ui; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/config.yaml: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-publication.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts: owner client-contracts-routes, console-recovery-ui; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-apply.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- eforge/extensions/eforge-plan/canonical/search-dirty.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/draft-plan-unit-actions.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-store.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/schema.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- eforge/extensions/eforge-plan/sqlite/schema.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/tsup.config.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts: owner core-policy-config (single-atom-evidence)
- eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- eforge/extensions/eforge-playbooks/run-playbook-action.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- eforge/extensions/eforge-playbooks/tsup.config.ts: owner core-policy-config (single-atom-evidence)
- examples/extensions/minimal-event-logger.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- gates/holds/approvals: owner core-policy-config (single-atom-evidence)
- manual/retry/abandon: owner core-policy-config (single-atom-evidence)
- packages/client/src/__tests__/events-schema-shape.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schema-test-helpers.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-auto-build.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/__tests__/queue-control-contracts.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/__tests__/queue-recovery.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/__tests__/schema-utils.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/client/src/__tests__/terminal-failure-event.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/client/src/api/apply-recovery.ts: owner core-policy-config (single-atom-evidence)
- packages/client/src/api/config.ts: owner core-policy-config (single-atom-evidence)
- packages/client/src/api/queue-recovery.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/api/queue.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/browser-queue-control.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/browser-queue-recovery.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/event-projections/queue.ts: owner client-contracts-routes; consumers console-recovery-ui (shared-evidence-primary-owner)
- packages/client/src/event-registry.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/event-validation.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/queue-events.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/events/snapshots.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/agents.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/build.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/daemon.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/extensions.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/planning-map-reduce.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/session-planning.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/stack.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/events/variants/validation-recovery.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/src/routes/route-map.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/client/src/run-status.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/client/src/schema-utils.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/client/src/types.ts: owner client-contracts-routes (single-atom-evidence)
- packages/client/tsup.config.ts: owner core-policy-config (single-atom-evidence)
- packages/console-ui/postcss.config.js: owner core-policy-config (single-atom-evidence)
- packages/console-ui/src/__tests__/use-run-detail.test.tsx: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer/activity-event-row.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer/raw-event-panel.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/header/auto-build-toggle.tsx: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/components/now/queue-action-disabled-reason.tsx: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx: owner core-policy-config (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/accept-success-action.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/advanced-cascade-section.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/compile-scope-context-options.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/confirm-action.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-completion-panel.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-report-panel.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/safe-markdown.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/recovery/verdict-chip.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/shell/route-placeholder.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/components/timeline/__tests__/event-card.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/console-ui/src/components/timeline/event-card.tsx: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/hooks/use-auto-build.test.tsx: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/hooks/use-auto-build.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/hooks/use-run-detail.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/daemon-event-projector.ts: owner client-contracts-routes (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts: owner core-policy-config (single-atom-evidence)
- packages/console-ui/src/lib/run-state/handlers/handle-resume.ts: owner core-policy-config (single-atom-evidence)
- packages/docs-gen/src/generators/config.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/docs-gen/tsup.config.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/engine/src/config.ts: owner core-policy-config; consumers console-recovery-ui (shared-evidence-primary-owner)
- packages/engine/src/evaluation/apply.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/orchestrator/validation-dirty-worktree.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/planner-compiler/compile-stage-integration.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/engine/src/planning-quality/apply-fixes.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/queue/resume-cascade.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/recovery/apply.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/recovery/failed-resume-sidecar-finalization.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/recovery/resume-sidecar.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/resume/compiled-build.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/resume/prd-content.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/resume/queued-resume.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/src/resume/resume-projection.ts: owner core-policy-config (single-atom-evidence)
- packages/engine/test/config.legacy-rejection.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/engine/test/plan-file.agent-config.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/extension-sdk/src/schema.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/input/src/session-plan-set/schema.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/accept-success-projection-parity.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/agent-task-events.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/auto-build-route.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/auto-build-supervisor.test.ts: owner client-contracts-routes; consumers console-recovery-ui (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/context.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/daemon-sse-handshake.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/daily-spend-db.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/db.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/efficiency-analytics-db.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/efficiency-analytics-route.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/failed-enqueue-projection.test.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/__tests__/projections-auto-build-state.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/monitor/src/__tests__/projections-config-redaction.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/projections-event-run-state.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/resume-plans-route.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/route-test-harness.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/routes-config-context.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/routes-config-profile-stack.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/stack-layers-route.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- packages/monitor/src/auto-build-supervisor.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/monitor/src/http/route-errors.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/projections/auto-build-state.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- packages/monitor/src/projections/queue-items.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/projections/runs.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/routes/continue-repair-service.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/routes/recovery.ts: owner client-contracts-routes (single-atom-evidence)
- packages/monitor/src/server-main.ts: owner client-contracts-routes (single-atom-evidence)
- packages/pi-eforge/skills/eforge-recover/SKILL.md: owner client-contracts-routes (single-atom-evidence)
- Queue/run/auto-build: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- README.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/agent-config.mixed-harness.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/api-route-helpers.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/apply-recovery-accept-success.test.ts: owner core-policy-config (single-atom-evidence)
- test/apply-recovery-route.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/apply-recovery.test.ts: owner core-policy-config (single-atom-evidence)
- test/auto-build-pause-on-failure.test.ts: owner client-contracts-routes, console-recovery-ui (single-atom-evidence)
- test/auto-build-resume-after-failure.test.ts: owner client-contracts-routes, console-recovery-ui; consumers core-policy-config (shared-evidence-primary-owner)
- test/build-single-prd-event-ordering.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/cli-display-render-event.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/config-schema.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/config.agent-runtimes.schema.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/continue-repair-eligibility-route.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/continue-repair-route.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/docs-gen-determinism.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/extension-event-runtime.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/files-changed-event.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/lifecycle-event-emission.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/orchestration-validation-gates.test.ts: owner core-policy-config (single-atom-evidence)
- test/planning-compiler-stage-integration.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/queue-recovery-route.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/recovery-verdict-schema.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/reference-content.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/retry-stub-harness-integration.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- test/sdk-event-mapping.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/stack-sync-route.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/validation-provider-event-schema.test.ts: owner client-contracts-routes; consumers core-policy-config (shared-evidence-primary-owner)
- test/worktree-integration.test.ts: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/app/reference/[slug]/page.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/app/reference/layout.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/app/reference/page.tsx: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/content/reference/api.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/content/reference/cli.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/content/reference/config.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/content/reference/events.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/content/reference/tools.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)
- web/public/reference/api.md: owner core-policy-config (single-atom-evidence)
- web/public/reference/config.md: owner client-contracts-routes; consumers console-recovery-ui, core-policy-config (shared-evidence-primary-owner)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "core-policy-config",
      "title": "Recovery core policy/config",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-003",
        "ac-004",
        "ac-008"
      ],
      "aspectIds": [
        "ac-001:interface:configuration",
        "ac-002:subsystem:apply",
        "ac-002:subsystem:resume",
        "ac-002:subsystem:resumes",
        "ac-002:subsystem:wakes",
        "ac-003:evidence:gates-holds-approvals",
        "ac-003:evidence:manual-retry-abandon",
        "ac-004:general:general",
        "ac-008:interface:config",
        "ac-008:interface:configuration",
        "ac-008:interface:docs",
        "ac-008:interface:test",
        "ac-008:subsystem:config",
        "ac-008:subsystem:docs",
        "ac-008:subsystem:integration",
        "ac-008:subsystem:reference",
        "ac-008:subsystem:test",
        "ac-008:subsystem:unit"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "client-contracts-routes",
      "title": "Client contracts, projection, routes",
      "residue": false,
      "criterionIds": [
        "ac-005",
        "ac-007"
      ],
      "aspectIds": [
        "ac-005:evidence:queue-run-auto-build",
        "ac-007:interface:route",
        "ac-007:interface:route-api",
        "ac-007:interface:schema",
        "ac-007:interface:schema-contract",
        "ac-007:interface:test",
        "ac-007:subsystem:event",
        "ac-007:subsystem:route",
        "ac-007:subsystem:schema",
        "ac-007:subsystem:test"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "console-recovery-ui",
      "title": "Console recovery display/controls",
      "residue": false,
      "criterionIds": [
        "ac-005",
        "ac-006"
      ],
      "aspectIds": [
        "ac-005:evidence:queue-run-auto-build",
        "ac-006:general:general"
      ],
      "dependsOnPlanIds": [
        "client-contracts-routes",
        "core-policy-config"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/images/claude-code-handoff.png",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/images/console-recovery-build.png",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/images/eforge-commits.png",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/images/monitor-timeline.png",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/stacking.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/search-dirty.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/schema.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/schema.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/tsup.config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/run-playbook-action.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/tsup.config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "examples/extensions/minimal-event-logger.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "gates/holds/approvals",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "manual/retry/abandon",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-shape.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-test-helpers.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/queue-control-contracts.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/queue-recovery.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/schema-utils.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/terminal-failure-event.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/apply-recovery.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/queue-recovery.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/queue.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/browser-queue-control.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/browser-queue-recovery.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/event-projections/queue.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/event-registry.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/event-validation.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/queue-events.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/snapshots.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/agents.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/build.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/daemon.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/extensions.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/planning-map-reduce.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/session-planning.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/stack.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/validation-recovery.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/routes/route-map.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/run-status.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/schema-utils.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/types.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/tsup.config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/postcss.config.js",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/activity-event-row.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/raw-event-panel.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/header/auto-build-toggle.tsx",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/queue-action-disabled-reason.tsx",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/accept-success-action.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/advanced-cascade-section.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/compile-scope-context-options.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/confirm-action.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-completion-panel.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-report-panel.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/safe-markdown.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/verdict-chip.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/shell/route-placeholder.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/timeline/__tests__/event-card.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/timeline/event-card.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-auto-build.test.tsx",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-auto-build.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-run-detail.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/daemon-event-projector.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-resume.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/docs-gen/src/generators/config.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/docs-gen/tsup.config.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/config.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [
        "console-recovery-ui"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/evaluation/apply.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/orchestrator/validation-dirty-worktree.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/planning-quality/apply-fixes.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/resume-cascade.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/apply.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/failed-resume-sidecar-finalization.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/resume-sidecar.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/compiled-build.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/prd-content.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/queued-resume.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/resume-projection.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/extension-sdk/src/schema.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/input/src/session-plan-set/schema.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/accept-success-projection-parity.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/agent-task-events.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/context.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daemon-sse-handshake.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daily-spend-db.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/db.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-db.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/failed-enqueue-projection.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-auto-build-state.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-event-run-state.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/auto-build-supervisor.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/http/route-errors.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/auto-build-state.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/queue-items.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/runs.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/continue-repair-service.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/recovery.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/server-main.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/pi-eforge/skills/eforge-recover/SKILL.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "Queue/run/auto-build",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "README.md",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/agent-config.mixed-harness.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/api-route-helpers.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/apply-recovery-accept-success.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/apply-recovery.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/auto-build-pause-on-failure.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/auto-build-resume-after-failure.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes",
        "console-recovery-ui"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/build-single-prd-event-ordering.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/cli-display-render-event.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/config-schema.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/config.agent-runtimes.schema.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/continue-repair-eligibility-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/continue-repair-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/docs-gen-determinism.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-event-runtime.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/files-changed-event.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/lifecycle-event-emission.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/orchestration-validation-gates.test.ts",
      "ownerPlanIds": [
        "core-policy-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-compiler-stage-integration.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/queue-recovery-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/recovery-verdict-schema.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/reference-content.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/retry-stub-harness-integration.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/sdk-event-mapping.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/stack-sync-route.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/validation-provider-event-schema.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/worktree-integration.test.ts",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "web/app/reference/[slug]/page.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "web/app/reference/layout.tsx",
      "ownerPlanIds": [
        "client-contracts-routes"
      ],
      "consumerPlanIds": [
        "console-recovery-ui",
        "core-policy-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:config",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:configuration",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:docs",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "docs",
      "summary": "Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:route",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "route",
      "summary": "Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:route-api",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "route-api",
      "summary": "Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:schema",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:schema-contract",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:console-recovery-ui->client-contracts-routes:test",
      "kind": "interface",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:config",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:configuration",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:docs",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "docs",
      "summary": "Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:route",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "route",
      "summary": "Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:route-api",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "route-api",
      "summary": "Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:schema",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:schema-contract",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:core-policy-config->client-contracts-routes:test",
      "kind": "interface",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "plan-dependency:console-recovery-ui->client-contracts-routes:",
      "kind": "plan-dependency",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "summary": "console-recovery-ui builds on Client contracts, projection, routes"
    },
    {
      "contractId": "plan-dependency:console-recovery-ui->core-policy-config:",
      "kind": "plan-dependency",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "core-policy-config",
      "summary": "console-recovery-ui builds on Recovery core policy/config"
    },
    {
      "contractId": "shared-file:client-contracts-routes->core-policy-config:docs/images/console-recovery-build.png",
      "kind": "shared-file",
      "fromPlanId": "client-contracts-routes",
      "toPlanId": "core-policy-config",
      "path": "docs/images/console-recovery-build.png",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:client-contracts-routes->core-policy-config:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "client-contracts-routes",
      "toPlanId": "core-policy-config",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:.claude/skills/eval-analysis/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:.github/workflows/ci.yml",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": ".github/workflows/ci.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:CONTRIBUTING.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "CONTRIBUTING.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/config.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge-plugin/skills/recover/recover.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/recover/recover.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge-plugin/skills/stack/stack.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/stack/stack.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/client/src/event-projections/queue.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/event-projections/queue.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/docs-gen/src/generators/config.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/docs-gen/src/generators/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/docs-gen/tsup.config.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/docs-gen/tsup.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/engine/test/config.legacy-rejection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/engine/test/plan-file.agent-config.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/auto-build-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/route-test-harness.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/routes-config-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:README.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/apply-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/apply-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/config-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/config-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/docs-gen-determinism.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/docs-gen-determinism.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/planning-compiler-stage-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/planning-compiler-stage-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/queue-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/queue-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/reference-content.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/reference-content.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/retry-stub-harness-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/retry-stub-harness-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:test/worktree-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "test/worktree-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/app/reference/[slug]/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/app/reference/[slug]/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/app/reference/layout.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/app/reference/layout.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/app/reference/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/app/reference/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/content/reference/api.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/content/reference/cli.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/cli.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/content/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/content/reference/events.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/events.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/content/reference/tools.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/tools.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->client-contracts-routes:web/public/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "client-contracts-routes",
      "path": "web/public/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->core-policy-config:docs/images/console-recovery-build.png",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "core-policy-config",
      "path": "docs/images/console-recovery-build.png",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->core-policy-config:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "core-policy-config",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-recovery-ui->core-policy-config:packages/engine/src/config.ts",
      "kind": "shared-file",
      "fromPlanId": "console-recovery-ui",
      "toPlanId": "core-policy-config",
      "path": "packages/engine/src/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.claude/skills/eval-analysis/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.github/workflows/ci.yml",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".github/workflows/ci.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.pi/extensions/eforge-dev/event-tail.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:CONTRIBUTING.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "CONTRIBUTING.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/config.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/skills/recover/recover.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/recover/recover.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/skills/stack/stack.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/stack/stack.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge-plugin/skills/workflow/workflow.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/schema.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/schema.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/sqlite/schema.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/sqlite/schema.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:examples/extensions/minimal-event-logger.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "examples/extensions/minimal-event-logger.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/client/src/__tests__/events-schema-shape.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/__tests__/events-schema-shape.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/client/src/__tests__/events-schema-test-helpers.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/__tests__/events-schema-test-helpers.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/client/src/__tests__/schema-utils.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/__tests__/schema-utils.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/client/src/__tests__/terminal-failure-event.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/__tests__/terminal-failure-event.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/client/src/routes/route-map.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/routes/route-map.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/client/src/schema-utils.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/client/src/schema-utils.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/console-ui/src/components/timeline/__tests__/event-card.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/console-ui/src/components/timeline/__tests__/event-card.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/docs-gen/src/generators/config.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/docs-gen/src/generators/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/docs-gen/tsup.config.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/docs-gen/tsup.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/engine/test/config.legacy-rejection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/engine/test/plan-file.agent-config.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/extension-sdk/src/schema.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/extension-sdk/src/schema.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/auto-build-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/projections-event-run-state.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/projections-event-run-state.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/route-test-harness.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/routes-config-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:README.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/api-route-helpers.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/api-route-helpers.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/apply-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/apply-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/auto-build-resume-after-failure.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/auto-build-resume-after-failure.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/build-single-prd-event-ordering.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/build-single-prd-event-ordering.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/cli-display-render-event.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/cli-display-render-event.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/config-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/config-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/config.agent-runtimes.schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/config.agent-runtimes.schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/continue-repair-eligibility-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/continue-repair-eligibility-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/continue-repair-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/continue-repair-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/docs-gen-determinism.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/docs-gen-determinism.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/extension-event-runtime.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/extension-event-runtime.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/files-changed-event.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/files-changed-event.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/lifecycle-event-emission.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/lifecycle-event-emission.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/planning-compiler-stage-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/planning-compiler-stage-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/queue-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/queue-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/recovery-verdict-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/recovery-verdict-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/reference-content.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/reference-content.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/retry-stub-harness-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/retry-stub-harness-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/sdk-event-mapping.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/sdk-event-mapping.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/stack-sync-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/stack-sync-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/validation-provider-event-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/validation-provider-event-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:test/worktree-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "test/worktree-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/app/reference/[slug]/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/app/reference/[slug]/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/app/reference/layout.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/app/reference/layout.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/app/reference/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/app/reference/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/content/reference/api.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/content/reference/cli.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/cli.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/content/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/content/reference/events.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/events.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/content/reference/tools.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/content/reference/tools.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->client-contracts-routes:web/public/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "client-contracts-routes",
      "path": "web/public/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->console-recovery-ui:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "console-recovery-ui",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->console-recovery-ui:eforge-plugin/skills/workflow/workflow.md",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "console-recovery-ui",
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:core-policy-config->console-recovery-ui:eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "kind": "shared-file",
      "fromPlanId": "core-policy-config",
      "toPlanId": "console-recovery-ui",
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```