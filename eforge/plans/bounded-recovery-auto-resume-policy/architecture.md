# Planner Compiler Architecture

## Summary

Synthesized child reduces into three buildable modules: contracts/config/docs, guarded policy/resume core, and visibility/provenance surfaces. The plan preserves default-off behavior, terminal blocker stops, active gate/hold/approval stops, budget/progress/failure-signature loop guards, existing resume/apply/wake helper reuse, client-owned event and route contracts, queue/run auto-build projections, and Console distinction between automatic decisions and manual actions. No conflicts were identified. Two repair-only source localization gaps remain for apply/resume helper internals and config implementation evidence; neither is representation-required build residue.

## Compiler status

Compiler status: complete
Source hash: 950fb32e7d5de61a6ab998d8f4a216d527dc1272bca4e90d9828a6dd82bde1f4

## Plan boundaries

### contracts-config-docs — Contracts, default-off config, docs

Criteria: ac-001, ac-007, ac-008
Aspects: ac-001:interface:configuration, ac-007:interface:route, ac-007:interface:route-api, ac-007:interface:schema, ac-007:interface:schema-contract, ac-007:interface:test, ac-007:subsystem:event, ac-007:subsystem:route, ac-007:subsystem:schema, ac-007:subsystem:test, ac-008:interface:config, ac-008:interface:configuration, ac-008:interface:docs, ac-008:interface:test, ac-008:subsystem:config, ac-008:subsystem:docs, ac-008:subsystem:integration, ac-008:subsystem:reference, ac-008:subsystem:test, ac-008:subsystem:unit
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .pi/extensions/eforge-dev/event-tail.ts, .pi/extensions/eforge-dev/README.md, AGENTS.md, CHANGELOG.md, CONTRIBUTING.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/images/claude-code-handoff.png, docs/images/console-recovery-build.png, docs/images/eforge-commits.png, docs/images/monitor-timeline.png, docs/llm-friendly-code.md, docs/releasing.md, docs/roadmap.md, docs/stacking.md, docs/webux-workspaces.md, eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/init/init.md, eforge-plugin/skills/profile-new/profile-new.md, eforge-plugin/skills/recover/recover.md, eforge-plugin/skills/stack/stack.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts, eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts, eforge/extensions/eforge-plan/__tests__/package-publication.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts, eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts, eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts, eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts, eforge/extensions/eforge-plan/draft-plan-unit-actions.ts, eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts, eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts, eforge/extensions/eforge-plan/draft-plan-unit-store.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, eforge/extensions/eforge-plan/tsup.config.ts, eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js, eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx, eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts, eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts, eforge/extensions/eforge-playbooks/tsup.config.ts, examples/extensions/minimal-event-logger.ts, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/__tests__/terminal-failure-event.test.ts, packages/client/src/api/config.ts, packages/client/src/event-projections/queue.ts, packages/client/src/event-registry.ts, packages/client/src/event-validation.ts, packages/client/src/events/snapshots.ts, packages/client/src/events/variants/agents.ts, packages/client/src/events/variants/build.ts, packages/client/src/events/variants/daemon.ts, packages/client/src/events/variants/extensions.ts, packages/client/src/events/variants/planning-map-reduce.ts, packages/client/src/events/variants/session-planning.ts, packages/client/src/events/variants/stack.ts, packages/client/src/events/variants/validation-recovery.ts, packages/client/src/routes/route-map.ts, packages/client/src/schema-utils.ts, packages/client/src/types.ts, packages/client/tsup.config.ts, packages/console-ui/postcss.config.js, packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx, packages/console-ui/src/components/activity/activity-drawer/activity-event-row.tsx, packages/console-ui/src/components/activity/activity-drawer/raw-event-panel.tsx, packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx, packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx, packages/console-ui/src/components/recovery/accept-success-action.tsx, packages/console-ui/src/components/recovery/advanced-cascade-section.tsx, packages/console-ui/src/components/recovery/compile-scope-context-options.tsx, packages/console-ui/src/components/recovery/confirm-action.tsx, packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx, packages/console-ui/src/components/recovery/recovery-completion-panel.tsx, packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx, packages/console-ui/src/components/recovery/recovery-report-panel.tsx, packages/console-ui/src/components/recovery/safe-markdown.tsx, packages/console-ui/src/components/recovery/verdict-chip.tsx, packages/console-ui/src/components/shell/route-placeholder.tsx, packages/console-ui/src/components/timeline/__tests__/event-card.test.ts, packages/console-ui/src/components/timeline/event-card.tsx, packages/console-ui/src/lib/daemon-event-projector.ts, packages/docs-gen/src/generators/config.ts, packages/docs-gen/tsup.config.ts, packages/engine/src/config.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/test/config.legacy-rejection.test.ts, packages/engine/test/plan-file.agent-config.test.ts, packages/extension-sdk/src/schema.ts, packages/input/src/session-plan-set/schema.ts, packages/monitor/src/__tests__/accept-success-projection-parity.test.ts, packages/monitor/src/__tests__/agent-task-events.test.ts, packages/monitor/src/__tests__/auto-build-route.test.ts, packages/monitor/src/__tests__/auto-build-supervisor.test.ts, packages/monitor/src/__tests__/context.test.ts, packages/monitor/src/__tests__/daemon-sse-handshake.test.ts, packages/monitor/src/__tests__/daily-spend-db.test.ts, packages/monitor/src/__tests__/db.test.ts, packages/monitor/src/__tests__/efficiency-analytics-db.test.ts, packages/monitor/src/__tests__/efficiency-analytics-route.test.ts, packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts, packages/monitor/src/__tests__/failed-enqueue-projection.test.ts, packages/monitor/src/__tests__/projections-config-redaction.test.ts, packages/monitor/src/__tests__/projections-event-run-state.test.ts, packages/monitor/src/__tests__/resume-plans-route.test.ts, packages/monitor/src/__tests__/route-test-harness.ts, packages/monitor/src/__tests__/routes-config-context.test.ts, packages/monitor/src/__tests__/routes-config-profile-stack.test.ts, packages/monitor/src/__tests__/stack-layers-route.test.ts, packages/monitor/src/http/route-errors.ts, packages/monitor/src/projections/queue-items.ts, packages/monitor/src/projections/runs.ts, packages/monitor/src/routes/continue-repair-service.ts, packages/monitor/src/routes/recovery.ts, packages/monitor/src/server-main.ts, packages/pi-eforge/skills/eforge-recover/SKILL.md, README.md, test/agent-config.mixed-harness.test.ts, test/api-route-helpers.ts, test/apply-recovery-route.test.ts, test/build-single-prd-event-ordering.test.ts, test/cli-display-render-event.test.ts, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/continue-repair-eligibility-route.test.ts, test/continue-repair-route.test.ts, test/docs-gen-determinism.test.ts, test/extension-event-runtime.test.ts, test/files-changed-event.test.ts, test/lifecycle-event-emission.test.ts, test/planning-compiler-stage-integration.test.ts, test/queue-recovery-route.test.ts, test/recovery-verdict-schema.test.ts, test/reference-content.test.ts, test/retry-stub-harness-integration.test.ts, test/sdk-event-mapping.test.ts, test/stack-sync-route.test.ts, test/validation-provider-event-schema.test.ts, test/worktree-integration.test.ts, web/app/reference/[slug]/page.tsx, web/app/reference/layout.tsx, web/app/reference/page.tsx, web/content/reference/api.md, web/content/reference/cli.md, web/content/reference/config.md, web/content/reference/events.md, web/content/reference/tools.md, web/public/reference/api.md, web/public/reference/config.md
Validation: Schema tests accept valid fixtures and reject invalid ones; existing manual recovery route tests remain green without looser assertions; config tests cover default no-op and enabled parsing/behavior; docs drift checks run when docs/reference inputs change; type-check passes.

### policy-resume-core — Guarded resume policy

Criteria: ac-002, ac-003, ac-004
Aspects: ac-002:subsystem:apply, ac-002:subsystem:resume, ac-002:subsystem:resumes, ac-002:subsystem:wakes, ac-003:evidence:gates-holds-approvals, ac-003:evidence:manual-retry-abandon, ac-004:general:general
Depends on: contracts-config-docs
Residue: no
Owned files: docs/architecture.md, eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts, eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts, eforge/extensions/eforge-plan/backlog-curation-apply.ts, eforge/extensions/eforge-plan/canonical/search-dirty.ts, gates/holds/approvals, manual/retry/abandon, packages/client/src/api/apply-recovery.ts, packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx, packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts, packages/console-ui/src/lib/run-state/handlers/handle-resume.ts, packages/engine/src/evaluation/apply.ts, packages/engine/src/orchestrator/validation-dirty-worktree.ts, packages/engine/src/planning-quality/apply-fixes.ts, packages/engine/src/queue/resume-cascade.ts, packages/engine/src/recovery/apply.ts, packages/engine/src/recovery/failed-resume-sidecar-finalization.ts, packages/engine/src/recovery/resume-sidecar.ts, packages/engine/src/resume/compiled-build.ts, packages/engine/src/resume/prd-content.ts, packages/engine/src/resume/queued-resume.ts, packages/engine/src/resume/resume-projection.ts, test/apply-recovery-accept-success.test.ts, test/apply-recovery.test.ts, test/orchestration-validation-gates.test.ts
Validation: Tests cover blocker stops, inactive blockers, disabled/no-budget/low-confidence or missing-artifact negatives, budget exhaustion, repeated-signature stop, and one positive attempt/enqueue/resume/wake/event parse path.

### visibility-provenance — Queue/run and Console visibility

Criteria: ac-005, ac-006
Aspects: ac-005:evidence:queue-run-auto-build, ac-006:general:general
Depends on: policy-resume-core
Residue: no
Owned files: .pi/extensions/eforge-dev/index.ts, eforge-plugin/skills/workflow/workflow.md, eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts, eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts, eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts, eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts, eforge/extensions/eforge-playbooks/run-playbook-action.ts, packages/client/src/__tests__/events-schemas-auto-build.test.ts, packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts, packages/client/src/__tests__/queue-control-contracts.test.ts, packages/client/src/__tests__/queue-recovery.test.ts, packages/client/src/api/queue-recovery.ts, packages/client/src/api/queue.ts, packages/client/src/browser-queue-control.ts, packages/client/src/browser-queue-recovery.ts, packages/client/src/events/queue-events.ts, packages/client/src/run-status.ts, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/components/header/auto-build-toggle.tsx, packages/console-ui/src/components/now/queue-action-disabled-reason.tsx, packages/console-ui/src/hooks/use-auto-build.test.tsx, packages/console-ui/src/hooks/use-auto-build.ts, packages/console-ui/src/hooks/use-run-detail.ts, packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts, packages/monitor/src/__tests__/projections-auto-build-state.test.ts, packages/monitor/src/auto-build-supervisor.ts, packages/monitor/src/projections/auto-build-state.ts, Queue/run/auto-build, test/auto-build-pause-on-failure.test.ts, test/auto-build-resume-after-failure.test.ts
Validation: Monitor, client, and Console tests cover enabled, disabled/stopped, attempts, last decision, stop reason, visible manual controls, and visual/text distinction between automatic and manual actions.

## Integration contracts

- policy-resume-core -> contracts-config-docs (interface config): Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface docs): Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface route): Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface route-api): Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface schema): Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (interface test): Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface config): Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface docs): Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface route): Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface route-api): Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface schema): Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- visibility-provenance -> contracts-config-docs (interface test): Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general.
- policy-resume-core -> contracts-config-docs (plan dependency): policy-resume-core builds on Contracts, default-off config, docs
- visibility-provenance -> policy-resume-core (plan dependency): visibility-provenance builds on Guarded resume policy
- policy-resume-core -> contracts-config-docs (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file .claude/skills/eval-analysis/SKILL.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file .github/workflows/ci.yml): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file AGENTS.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file CHANGELOG.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file CONTRIBUTING.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/config-migration.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/config.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/extensions-api.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/extensions.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/hooks.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/releasing.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/roadmap.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/stacking.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge-plugin/skills/recover/recover.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge-plugin/skills/stack/stack.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/config.yaml): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-actions.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-store.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/docs-gen/src/generators/config.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/docs-gen/tsup.config.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/engine/src/config.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/engine/src/planner-compiler/compile-stage-integration.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/engine/test/config.legacy-rejection.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/engine/test/plan-file.agent-config.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/auto-build-route.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/efficiency-analytics-route.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/projections-config-redaction.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/resume-plans-route.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/route-test-harness.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/routes-config-context.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/routes-config-profile-stack.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file packages/monitor/src/__tests__/stack-layers-route.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file README.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/apply-recovery-route.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/config-schema.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/docs-gen-determinism.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/planning-compiler-stage-integration.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/queue-recovery-route.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/reference-content.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/retry-stub-harness-integration.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file test/worktree-integration.test.ts): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/app/reference/[slug]/page.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/app/reference/layout.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/app/reference/page.tsx): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/content/reference/api.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/content/reference/cli.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/content/reference/config.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/content/reference/events.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/content/reference/tools.md): shared-evidence-primary-owner
- policy-resume-core -> contracts-config-docs (shared file web/public/reference/config.md): shared-evidence-primary-owner
- policy-resume-core -> visibility-provenance (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- policy-resume-core -> visibility-provenance (shared file eforge-plugin/skills/workflow/workflow.md): shared-evidence-primary-owner
- policy-resume-core -> visibility-provenance (shared file eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts): shared-evidence-primary-owner
- policy-resume-core -> visibility-provenance (shared file test/auto-build-resume-after-failure.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file .claude/skills/eval-analysis/SKILL.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file .github/workflows/ci.yml): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file AGENTS.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file CHANGELOG.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file CONTRIBUTING.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/config-migration.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/config.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/extensions-api.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/extensions.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/hooks.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/images/console-recovery-build.png): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/releasing.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/roadmap.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/stacking.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge-plugin/skills/recover/recover.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge-plugin/skills/stack/stack.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/config.yaml): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-actions.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/draft-plan-unit-store.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/client/src/event-projections/queue.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/docs-gen/src/generators/config.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/docs-gen/tsup.config.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/engine/src/config.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/engine/src/planner-compiler/compile-stage-integration.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/engine/test/config.legacy-rejection.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/engine/test/plan-file.agent-config.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/auto-build-route.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/auto-build-supervisor.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/efficiency-analytics-route.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/projections-config-redaction.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/resume-plans-route.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/route-test-harness.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/routes-config-context.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/routes-config-profile-stack.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file packages/monitor/src/__tests__/stack-layers-route.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file README.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/apply-recovery-route.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/config-schema.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/docs-gen-determinism.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/planning-compiler-stage-integration.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/queue-recovery-route.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/reference-content.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/retry-stub-harness-integration.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file test/worktree-integration.test.ts): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/app/reference/[slug]/page.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/app/reference/layout.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/app/reference/page.tsx): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/content/reference/api.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/content/reference/cli.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/content/reference/config.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/content/reference/events.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/content/reference/tools.md): shared-evidence-primary-owner
- visibility-provenance -> contracts-config-docs (shared file web/public/reference/config.md): shared-evidence-primary-owner

## Shared file ownership

- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- .claude/skills/eforge-release/SKILL.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- .claude/skills/eval-analysis/SKILL.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- .github/workflows/ci.yml: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/event-tail.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/index.ts: owner visibility-provenance; consumers policy-resume-core (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/README.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- AGENTS.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- CHANGELOG.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- CONTRIBUTING.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/architecture.md: owner policy-resume-core (single-atom-evidence)
- docs/config-migration.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/config.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/extensions-api.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/extensions.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/hooks.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/images/claude-code-handoff.png: owner contracts-config-docs (single-atom-evidence)
- docs/images/console-recovery-build.png: owner contracts-config-docs; consumers visibility-provenance (shared-evidence-primary-owner)
- docs/images/eforge-commits.png: owner contracts-config-docs (single-atom-evidence)
- docs/images/monitor-timeline.png: owner contracts-config-docs (single-atom-evidence)
- docs/llm-friendly-code.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/releasing.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/roadmap.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/stacking.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- docs/webux-workspaces.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/.claude-plugin/plugin.json: owner contracts-config-docs (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge-plugin/skills/config/config.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/extend/extend.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/init/init.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/profile-new/profile-new.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/recover/recover.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/stack/stack.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/workflow/workflow.md: owner visibility-provenance; consumers policy-resume-core (shared-evidence-primary-owner)
- eforge/config.yaml: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner policy-resume-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-publication.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts: owner visibility-provenance; consumers policy-resume-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-apply.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts: owner visibility-provenance (single-atom-evidence)
- eforge/extensions/eforge-plan/canonical/search-dirty.ts: owner policy-resume-core (single-atom-evidence)
- eforge/extensions/eforge-plan/draft-plan-unit-actions.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-store.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/schema.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts: owner visibility-provenance (single-atom-evidence)
- eforge/extensions/eforge-plan/sqlite/schema.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/tsup.config.ts: owner contracts-config-docs (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js: owner contracts-config-docs (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts: owner contracts-config-docs (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts: owner contracts-config-docs (single-atom-evidence)
- eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts: owner visibility-provenance (single-atom-evidence)
- eforge/extensions/eforge-playbooks/run-playbook-action.ts: owner visibility-provenance (single-atom-evidence)
- eforge/extensions/eforge-playbooks/tsup.config.ts: owner contracts-config-docs (single-atom-evidence)
- examples/extensions/minimal-event-logger.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- gates/holds/approvals: owner policy-resume-core (single-atom-evidence)
- manual/retry/abandon: owner policy-resume-core (single-atom-evidence)
- packages/client/src/__tests__/events-schema-shape.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schema-test-helpers.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-auto-build.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/__tests__/queue-control-contracts.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/__tests__/queue-recovery.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/__tests__/schema-utils.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/client/src/__tests__/terminal-failure-event.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/client/src/api/apply-recovery.ts: owner policy-resume-core (single-atom-evidence)
- packages/client/src/api/config.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/api/queue-recovery.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/api/queue.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/browser-queue-control.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/browser-queue-recovery.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/event-projections/queue.ts: owner contracts-config-docs; consumers visibility-provenance (shared-evidence-primary-owner)
- packages/client/src/event-registry.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/event-validation.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/queue-events.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/events/snapshots.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/agents.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/build.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/daemon.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/extensions.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/planning-map-reduce.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/session-planning.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/stack.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/events/variants/validation-recovery.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/src/routes/route-map.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/client/src/run-status.ts: owner visibility-provenance (single-atom-evidence)
- packages/client/src/schema-utils.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/client/src/types.ts: owner contracts-config-docs (single-atom-evidence)
- packages/client/tsup.config.ts: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/postcss.config.js: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/__tests__/use-run-detail.test.tsx: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer/activity-event-row.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer/raw-event-panel.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/header/auto-build-toggle.tsx: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/components/now/queue-action-disabled-reason.tsx: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx: owner policy-resume-core (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/accept-success-action.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/advanced-cascade-section.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/compile-scope-context-options.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/confirm-action.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-completion-panel.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-report-panel.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/safe-markdown.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/recovery/verdict-chip.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/shell/route-placeholder.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/components/timeline/__tests__/event-card.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/console-ui/src/components/timeline/event-card.tsx: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/hooks/use-auto-build.test.tsx: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/hooks/use-auto-build.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/hooks/use-run-detail.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/daemon-event-projector.ts: owner contracts-config-docs (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts: owner policy-resume-core (single-atom-evidence)
- packages/console-ui/src/lib/run-state/handlers/handle-resume.ts: owner policy-resume-core (single-atom-evidence)
- packages/docs-gen/src/generators/config.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/docs-gen/tsup.config.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/engine/src/config.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/engine/src/evaluation/apply.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/orchestrator/validation-dirty-worktree.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/planner-compiler/compile-stage-integration.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/engine/src/planning-quality/apply-fixes.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/queue/resume-cascade.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/recovery/apply.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/recovery/failed-resume-sidecar-finalization.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/recovery/resume-sidecar.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/resume/compiled-build.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/resume/prd-content.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/resume/queued-resume.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/src/resume/resume-projection.ts: owner policy-resume-core (single-atom-evidence)
- packages/engine/test/config.legacy-rejection.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/engine/test/plan-file.agent-config.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/extension-sdk/src/schema.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/input/src/session-plan-set/schema.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/accept-success-projection-parity.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/agent-task-events.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/auto-build-route.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/auto-build-supervisor.test.ts: owner contracts-config-docs; consumers visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/context.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/daemon-sse-handshake.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/daily-spend-db.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/db.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/efficiency-analytics-db.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/efficiency-analytics-route.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/failed-enqueue-projection.test.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/__tests__/projections-auto-build-state.test.ts: owner visibility-provenance (single-atom-evidence)
- packages/monitor/src/__tests__/projections-config-redaction.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/projections-event-run-state.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/resume-plans-route.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/route-test-harness.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/routes-config-context.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/routes-config-profile-stack.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/stack-layers-route.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- packages/monitor/src/auto-build-supervisor.ts: owner visibility-provenance (single-atom-evidence)
- packages/monitor/src/http/route-errors.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/projections/auto-build-state.ts: owner visibility-provenance (single-atom-evidence)
- packages/monitor/src/projections/queue-items.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/projections/runs.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/routes/continue-repair-service.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/routes/recovery.ts: owner contracts-config-docs (single-atom-evidence)
- packages/monitor/src/server-main.ts: owner contracts-config-docs (single-atom-evidence)
- packages/pi-eforge/skills/eforge-recover/SKILL.md: owner contracts-config-docs (single-atom-evidence)
- Queue/run/auto-build: owner visibility-provenance (single-atom-evidence)
- README.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/agent-config.mixed-harness.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/api-route-helpers.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/apply-recovery-accept-success.test.ts: owner policy-resume-core (single-atom-evidence)
- test/apply-recovery-route.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/apply-recovery.test.ts: owner policy-resume-core (single-atom-evidence)
- test/auto-build-pause-on-failure.test.ts: owner visibility-provenance (single-atom-evidence)
- test/auto-build-resume-after-failure.test.ts: owner visibility-provenance; consumers policy-resume-core (shared-evidence-primary-owner)
- test/build-single-prd-event-ordering.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/cli-display-render-event.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/config-schema.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/config.agent-runtimes.schema.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/continue-repair-eligibility-route.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/continue-repair-route.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/docs-gen-determinism.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/extension-event-runtime.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/files-changed-event.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/lifecycle-event-emission.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/orchestration-validation-gates.test.ts: owner policy-resume-core (single-atom-evidence)
- test/planning-compiler-stage-integration.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/queue-recovery-route.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/recovery-verdict-schema.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/reference-content.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/retry-stub-harness-integration.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- test/sdk-event-mapping.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/stack-sync-route.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/validation-provider-event-schema.test.ts: owner contracts-config-docs (shared-evidence-primary-owner)
- test/worktree-integration.test.ts: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/app/reference/[slug]/page.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/app/reference/layout.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/app/reference/page.tsx: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/content/reference/api.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/content/reference/cli.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/content/reference/config.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/content/reference/events.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/content/reference/tools.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)
- web/public/reference/api.md: owner contracts-config-docs (single-atom-evidence)
- web/public/reference/config.md: owner contracts-config-docs; consumers policy-resume-core, visibility-provenance (shared-evidence-primary-owner)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "contracts-config-docs",
      "title": "Contracts, default-off config, docs",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-007",
        "ac-008"
      ],
      "aspectIds": [
        "ac-001:interface:configuration",
        "ac-007:interface:route",
        "ac-007:interface:route-api",
        "ac-007:interface:schema",
        "ac-007:interface:schema-contract",
        "ac-007:interface:test",
        "ac-007:subsystem:event",
        "ac-007:subsystem:route",
        "ac-007:subsystem:schema",
        "ac-007:subsystem:test",
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
      "planId": "policy-resume-core",
      "title": "Guarded resume policy",
      "residue": false,
      "criterionIds": [
        "ac-002",
        "ac-003",
        "ac-004"
      ],
      "aspectIds": [
        "ac-002:subsystem:apply",
        "ac-002:subsystem:resume",
        "ac-002:subsystem:resumes",
        "ac-002:subsystem:wakes",
        "ac-003:evidence:gates-holds-approvals",
        "ac-003:evidence:manual-retry-abandon",
        "ac-004:general:general"
      ],
      "dependsOnPlanIds": [
        "contracts-config-docs"
      ]
    },
    {
      "planId": "visibility-provenance",
      "title": "Queue/run and Console visibility",
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
        "policy-resume-core"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [
        "policy-resume-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/images/claude-code-handoff.png",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/images/console-recovery-build.png",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/images/eforge-commits.png",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/images/monitor-timeline.png",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/stacking.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [
        "policy-resume-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [
        "policy-resume-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/search-dirty.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/schema.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/schema.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/tsup.config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/run-playbook-action.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/tsup.config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "examples/extensions/minimal-event-logger.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "gates/holds/approvals",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "manual/retry/abandon",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-shape.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-test-helpers.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/queue-control-contracts.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/queue-recovery.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/schema-utils.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/terminal-failure-event.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/apply-recovery.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/queue-recovery.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/queue.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/browser-queue-control.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/browser-queue-recovery.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/event-projections/queue.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/event-registry.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/event-validation.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/queue-events.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/snapshots.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/agents.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/build.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/daemon.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/extensions.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/planning-map-reduce.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/session-planning.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/stack.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/validation-recovery.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/routes/route-map.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/run-status.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/schema-utils.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/types.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/tsup.config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/postcss.config.js",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/activity-event-list.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/activity-event-row.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer/raw-event-panel.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/header/auto-build-toggle.tsx",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/queue-action-disabled-reason.tsx",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/accept-success-action.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/advanced-cascade-section.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/compile-scope-context-options.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/confirm-action.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-completion-panel.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-report-panel.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/safe-markdown.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/verdict-chip.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/shell/route-placeholder.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/timeline/__tests__/event-card.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/timeline/event-card.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-auto-build.test.tsx",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-auto-build.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-run-detail.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/daemon-event-projector.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-resume.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/docs-gen/src/generators/config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/docs-gen/tsup.config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/config.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/evaluation/apply.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/orchestrator/validation-dirty-worktree.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/planning-quality/apply-fixes.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/resume-cascade.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/apply.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/failed-resume-sidecar-finalization.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/resume-sidecar.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/compiled-build.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/prd-content.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/queued-resume.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/resume/resume-projection.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/extension-sdk/src/schema.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/input/src/session-plan-set/schema.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/accept-success-projection-parity.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/agent-task-events.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/context.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daemon-sse-handshake.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daily-spend-db.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/db.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-db.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/failed-enqueue-projection.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-auto-build-state.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-event-run-state.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/auto-build-supervisor.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/http/route-errors.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/auto-build-state.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/queue-items.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/runs.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/continue-repair-service.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/recovery.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/server-main.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/pi-eforge/skills/eforge-recover/SKILL.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "Queue/run/auto-build",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "README.md",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/agent-config.mixed-harness.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/api-route-helpers.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/apply-recovery-accept-success.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/apply-recovery.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/auto-build-pause-on-failure.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/auto-build-resume-after-failure.test.ts",
      "ownerPlanIds": [
        "visibility-provenance"
      ],
      "consumerPlanIds": [
        "policy-resume-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/build-single-prd-event-ordering.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/cli-display-render-event.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/config-schema.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/config.agent-runtimes.schema.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/continue-repair-eligibility-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/continue-repair-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/docs-gen-determinism.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-event-runtime.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/files-changed-event.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/lifecycle-event-emission.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/orchestration-validation-gates.test.ts",
      "ownerPlanIds": [
        "policy-resume-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-compiler-stage-integration.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/queue-recovery-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/recovery-verdict-schema.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/reference-content.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/retry-stub-harness-integration.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/sdk-event-mapping.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/stack-sync-route.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/validation-provider-event-schema.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/worktree-integration.test.ts",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "web/app/reference/[slug]/page.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "web/app/reference/layout.tsx",
      "ownerPlanIds": [
        "contracts-config-docs"
      ],
      "consumerPlanIds": [
        "policy-resume-core",
        "visibility-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:config",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:configuration",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:docs",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "docs",
      "summary": "Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:route",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "route",
      "summary": "Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:route-api",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "route-api",
      "summary": "Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:schema",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:schema-contract",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:policy-resume-core->contracts-config-docs:test",
      "kind": "interface",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:config",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:configuration",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:docs",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "docs",
      "summary": "Shared interface docs is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:route",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "route",
      "summary": "Shared interface route is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:route-api",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "route-api",
      "summary": "Shared interface route-api is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:schema",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:schema-contract",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "interface:visibility-provenance->contracts-config-docs:test",
      "kind": "interface",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-event, atom-rescope-general. Primary atom atom-rescope-event owns reusable interface findings for consumers atom-rescope-abandon, atom-rescope-apply, atom-rescope-auto-build, atom-rescope-config, atom-rescope-general."
    },
    {
      "contractId": "plan-dependency:policy-resume-core->contracts-config-docs:",
      "kind": "plan-dependency",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "summary": "policy-resume-core builds on Contracts, default-off config, docs"
    },
    {
      "contractId": "plan-dependency:visibility-provenance->policy-resume-core:",
      "kind": "plan-dependency",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "policy-resume-core",
      "summary": "visibility-provenance builds on Guarded resume policy"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:.claude/skills/eval-analysis/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:.github/workflows/ci.yml",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": ".github/workflows/ci.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:CONTRIBUTING.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "CONTRIBUTING.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/config.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge-plugin/skills/recover/recover.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/recover/recover.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge-plugin/skills/stack/stack.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/stack/stack.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/docs-gen/src/generators/config.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/docs-gen/src/generators/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/docs-gen/tsup.config.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/docs-gen/tsup.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/engine/src/config.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/src/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/engine/test/config.legacy-rejection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/engine/test/plan-file.agent-config.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/auto-build-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/route-test-harness.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/routes-config-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:README.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/apply-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/apply-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/config-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/config-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/docs-gen-determinism.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/docs-gen-determinism.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/planning-compiler-stage-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/planning-compiler-stage-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/queue-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/queue-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/reference-content.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/reference-content.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/retry-stub-harness-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/retry-stub-harness-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:test/worktree-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "test/worktree-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/app/reference/[slug]/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/app/reference/[slug]/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/app/reference/layout.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/app/reference/layout.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/app/reference/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/app/reference/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/content/reference/api.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/content/reference/cli.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/cli.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/content/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/content/reference/events.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/events.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/content/reference/tools.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/tools.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->contracts-config-docs:web/public/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "contracts-config-docs",
      "path": "web/public/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->visibility-provenance:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "visibility-provenance",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->visibility-provenance:eforge-plugin/skills/workflow/workflow.md",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "visibility-provenance",
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->visibility-provenance:eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "visibility-provenance",
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:policy-resume-core->visibility-provenance:test/auto-build-resume-after-failure.test.ts",
      "kind": "shared-file",
      "fromPlanId": "policy-resume-core",
      "toPlanId": "visibility-provenance",
      "path": "test/auto-build-resume-after-failure.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:.claude/skills/eval-analysis/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:.github/workflows/ci.yml",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": ".github/workflows/ci.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:CONTRIBUTING.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "CONTRIBUTING.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/config.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/images/console-recovery-build.png",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/images/console-recovery-build.png",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge-plugin/skills/recover/recover.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/recover/recover.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge-plugin/skills/stack/stack.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge-plugin/skills/stack/stack.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-advisor.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-actions.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-advisor.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-store.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-advisory.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-detail.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/draft-unit-split-panel.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/client/src/event-projections/queue.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/client/src/event-projections/queue.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/docs-gen/src/generators/config.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/docs-gen/src/generators/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/docs-gen/tsup.config.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/docs-gen/tsup.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/engine/src/config.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/src/config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/engine/test/config.legacy-rejection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/engine/test/plan-file.agent-config.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/auto-build-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/route-test-harness.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/routes-config-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:README.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/apply-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/apply-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/config-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/config-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/docs-gen-determinism.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/docs-gen-determinism.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/planning-compiler-stage-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/planning-compiler-stage-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/queue-recovery-route.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/queue-recovery-route.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/reference-content.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/reference-content.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/retry-stub-harness-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/retry-stub-harness-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:test/worktree-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "test/worktree-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/app/reference/[slug]/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/app/reference/[slug]/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/app/reference/layout.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/app/reference/layout.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/app/reference/page.tsx",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/app/reference/page.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/content/reference/api.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/content/reference/cli.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/cli.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/content/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/content/reference/events.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/events.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/content/reference/tools.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/content/reference/tools.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:visibility-provenance->contracts-config-docs:web/public/reference/config.md",
      "kind": "shared-file",
      "fromPlanId": "visibility-provenance",
      "toPlanId": "contracts-config-docs",
      "path": "web/public/reference/config.md",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```