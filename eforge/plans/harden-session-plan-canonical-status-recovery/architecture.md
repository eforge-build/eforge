# Planner Compiler Architecture

## Summary

Complete synthesis for AC-001..AC-010. Overlapping child modules were merged into three buildable candidates: session-plan status/projection surfaces, identity-preserving resubmit recovery with provenance, and final quality gates. No conflicts or gaps.

## Compiler status

Compiler status: complete
Source hash: f681c072ea1bd18d988df7d26334a6d763ec58137bd6969fcd4043d865002ac7

## Plan boundaries

### mod-session-plan-status-surfaces — Session-plan status/projection surfaces

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Aspects: ac-001:general:general, ac-002:interface:ui, ac-002:interface:ui-surface, ac-002:subsystem:incomplete, ac-002:subsystem:mixed, ac-002:subsystem:ui, ac-003:subsystem:planned, ac-003:subsystem:shipped, ac-004:interface:extension, ac-004:interface:extension-surface, ac-004:subsystem:extension, ac-004:subsystem:kernel, ac-004:subsystem:mcp, ac-005:interface:extension, ac-005:interface:extension-surface, ac-005:subsystem:extension
Depends on: (none)
Residue: no
Owned files: .claude-plugin/marketplace.json, .claude/skills/eforge-daemon-restart/SKILL.md, .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .pi/extensions/eforge-dev/event-tail.ts, docs/images/console-recovery-build.png, docs/webux-workspaces.md, eforge-plugin/.mcp.json, eforge-plugin/skills/init/init.md, eforge-plugin/skills/stack/stack.md, eforge-plugin/skills/status/status.md, eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts, eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-projection-preservation.test.ts, eforge/extensions/eforge-plan/agent-task-contributions.ts, eforge/extensions/eforge-plan/backlog-curation-schemas.ts, eforge/extensions/eforge-plan/backlog-curation-source.ts, eforge/extensions/eforge-plan/canonical/lifecycle-records.ts, eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts, eforge/extensions/eforge-plan/canonical/session-plan-records.ts, eforge/extensions/eforge-plan/index.ts, eforge/extensions/eforge-plan/plan-revision-orchestration.ts, eforge/extensions/eforge-plan/planning-state-policy.ts, eforge/extensions/eforge-plan/projections/board.ts, eforge/extensions/eforge-plan/projections/coverage.ts, eforge/extensions/eforge-plan/projections/index.ts, eforge/extensions/eforge-plan/projections/items.ts, eforge/extensions/eforge-plan/projections/lifecycle.ts, eforge/extensions/eforge-plan/projections/links.ts, eforge/extensions/eforge-plan/projections/pagination.ts, eforge/extensions/eforge-plan/projections/recommendations.ts, eforge/extensions/eforge-plan/projections/session-plans.ts, eforge/extensions/eforge-plan/projections/store.ts, eforge/extensions/eforge-plan/projections/types.ts, eforge/extensions/eforge-plan/README.md, eforge/extensions/eforge-plan/session-plan-actions.ts, eforge/extensions/eforge-plan/session-plan-schemas.ts, eforge/extensions/eforge-plan/session-plan-view-model.ts, eforge/extensions/eforge-plan/shipped-evidence-git.ts, eforge/extensions/eforge-plan/shipped-evidence-limits.ts, eforge/extensions/eforge-plan/shipped-evidence-matching.ts, eforge/extensions/eforge-plan/shipped-evidence-pr.ts, eforge/extensions/eforge-plan/shipped-evidence-types.ts, eforge/extensions/eforge-plan/shipped-evidence.ts, eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/lifecycle-evidence-panel.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.test.tsx, eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md, eforge/prds/detect-shipped-backlog-items-from-git-and-pr-history.md, eforge/prds/extract-standalone-eforge-playbooks-extension.md, eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md, eforge/prds/orphaned-queued-build-adoption.md, eforge/prds/same-plan-within-build-recovery.md, eforge/prds/strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup.md, packages/client/src/__tests__/events-schemas-extension-actions.test.ts, packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts, packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts, packages/client/src/__tests__/events-schemas-extension-inputs.test.ts, packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts, packages/client/src/__tests__/extension-agent-task-contributions.test.ts, packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts, packages/client/src/routes/route-map.ts, packages/client/src/routes/session-plan.ts, packages/console-ui/.storybook/preview.tsx, packages/console-ui/src/app.tsx, packages/console-ui/src/components/header/control-surface-links.tsx, packages/console-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx, packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx, packages/console-ui/src/components/pipeline/agent-detail-sheet.tsx, packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx, packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts, packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts, packages/console-ui/src/views/run-detail/__tests__/pipeline-section.test.tsx, packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx, packages/console-ui/src/views/run-detail/bottom-tab-panel.tsx, packages/console-ui/src/views/run-detail/pipeline-section.tsx, packages/console-ui/src/views/run-detail/run-detail-view.tsx, packages/console-ui/src/views/run-detail/summary-chips.tsx, packages/console-ui/src/views/runs/run-plans-preview.tsx, packages/eforge/src/cli/mcp-extension-contributions.ts, packages/eforge/src/cli/mcp-proxy.ts, packages/eforge/src/cli/mcp-tool-factory.ts, packages/engine/src/harnesses/pi-mcp-bridge.ts, packages/engine/src/queue/build-single-prd.ts, packages/input/src/session-plan-creation-draft.ts, packages/input/src/session-plan-realpath.ts, packages/monitor/src/routes/extension-content.ts, packages/monitor/src/routes/session-plans.ts, packages/pi-eforge/extensions/eforge/index.ts, test/continue-repair-cli-mcp.test.ts, test/docs-kernel-boundary.test.ts, test/mcp-tool-factory.test.ts, test/profile-wiring-mcp-native.test.ts, test/queue-controls-cli-mcp-pi.test.ts
Validation: Author tests for projection cases, UI partial reason display, and extension/MCP status parity, errors, and disclosure.

### mod-resubmit-recovery-provenance — Identity-preserving resubmit recovery and provenance

Criteria: ac-006, ac-007, ac-008, ac-009
Aspects: ac-006:subsystem:build, ac-006:subsystem:deleting, ac-006:subsystem:queue, ac-006:subsystem:recreating, ac-007:subsystem:provenance, ac-007:subsystem:recommendation, ac-008:subsystem:build, ac-008:subsystem:queue, ac-009:general:general
Depends on: (none)
Residue: no
Owned files: eforge-plugin/skills/restart/restart.md, eforge-plugin/skills/update/update.md, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts, eforge/extensions/eforge-plan/canonical/backlog-records.ts, eforge/extensions/eforge-plan/canonical/coverage.ts, eforge/extensions/eforge-plan/canonical/item-body-sections.ts, eforge/extensions/eforge-plan/canonical/planning-task-records.ts, eforge/extensions/eforge-plan/canonical/recommendation-records.ts, eforge/extensions/eforge-plan/canonical/search-dirty.ts, eforge/extensions/eforge-plan/canonical/store.ts, eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts, eforge/extensions/eforge-plan/promote.ts, eforge/extensions/eforge-plan/session-plan-metadata.ts, packages/client/src/api/queue-recovery.ts, packages/client/src/api/queue.ts, packages/client/src/browser-queue-control.ts, packages/client/src/browser-queue-recovery.ts, packages/client/src/event-projections/queue.ts, packages/client/src/events/variants/build.ts, packages/client/src/types/auto-build.ts, packages/console-ui/src/components/header/auto-build-toggle.tsx, packages/console-ui/src/components/recovery/__tests__/recovery-auto-resume-provenance.test.tsx, packages/docs-gen/src/provenance.ts, packages/engine/src/provenance.ts, packages/engine/src/queue/control.ts, packages/monitor/src/routes/queue-control.ts, test/fixtures/planner/fix-removed-queue-coverage-cleanup.md, test/landing-actions-provenance.test.ts, test/provenance.test.ts, test/stack-runtime-landing-provenance.test.ts, web/public/reference/events.md
Validation: Author cleanup -> resubmit -> handoff regression covering stable ids/refs, fresh queue/build records, and corrected ready/success projection.

### mod-ac010-quality-gates — AC-010 quality gates

Criteria: ac-010
Aspects: ac-010:interface:test, ac-010:subsystem:test
Depends on: mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/index.ts, .pi/extensions/eforge-dev/README.md, AGENTS.md, CHANGELOG.md, CONTRIBUTING.md, docs/architecture.md, docs/config-migration.md, docs/extensions.md, docs/hooks.md, docs/llm-friendly-code.md, docs/releasing.md, docs/roadmap.md, docs/stacking.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/profile-new/profile-new.md, eforge-plugin/skills/profile/profile.md, eforge-plugin/skills/recover/recover.md, eforge/config.yaml, eforge/dependency-update-evidence.md, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-guardrails/maintainability-parser.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts, eforge/extensions/eforge-plan/__tests__/kanban.test.ts, eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts, eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts, eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts, eforge/extensions/eforge-plan/__tests__/package-publication.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts, eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts, eforge/extensions/eforge-plan/__tests__/promotion.test.ts, eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts, eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts, eforge/extensions/eforge-plan/__tests__/registration.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts, eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/storage.test.ts, eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts, eforge/extensions/eforge-plan/backlog-capture-guardrails.ts, eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts, eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts, eforge/extensions/eforge-plan/backlog-curation-full-audit.ts, eforge/extensions/eforge-plan/backlog-domain.ts, eforge/extensions/eforge-plan/package.json, eforge/extensions/eforge-plan/workstation-src/plans/package.json, eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx, eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts, eforge/extensions/eforge-playbooks/package.json, package.json, packages/client/package.json, packages/client/src/__tests__/events-schemas-auto-build.test.ts, packages/client/src/__tests__/events-schemas-build-evaluator.test.ts, packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts, packages/client/src/__tests__/events-wire-parity-invalid.test.ts, packages/client/src/__tests__/queue-control-contracts.test.ts, packages/client/src/__tests__/queue-recovery.test.ts, packages/console-ui/package.json, packages/console-ui/src/__tests__/active-session-streams.test.tsx, packages/console-ui/src/__tests__/app.test.tsx, packages/console-ui/src/__tests__/build-history-accepted-success.test.ts, packages/console-ui/src/__tests__/console-shell.test.tsx, packages/console-ui/src/__tests__/header.test.tsx, packages/console-ui/src/__tests__/now-dashboard.test.tsx, packages/console-ui/src/__tests__/system-view.test.tsx, packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx, packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx, packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx, packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx, packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx, packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx, packages/console-ui/src/components/now/__tests__/queue-card.test.tsx, packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx, packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx, packages/console-ui/vitest.config.ts, packages/docs-gen/package.json, packages/eforge/package.json, packages/engine/package.json, packages/extension-sdk/package.json, packages/input/package.json, packages/input/src/session-planning-workflow.ts, packages/monitor/package.json, packages/monitor/src/__tests__/monitor-region-markers.test.ts, packages/monitor/src/routes/session-plan-service.ts, scripts/check-agent-maintainability.mjs, scripts/check-skill-parity.mjs, test/ac008-adoption-reconciliation-regression.test.ts, test/ac008-daemon-wire-ownership.test.ts, test/accept-success-direct-pr-landing.test.ts, test/accept-success-static-discipline.test.ts, test/acceptance-criteria-inventory.test.ts, test/acceptance-criteria-quality.test.ts, test/acceptance-summary.test.ts, test/acceptance-unknown-resolver.test.ts, test/adopt.test.ts, test/adopted-queue-worker-restart.test.ts, test/adopted-success-preservation.test.ts, test/agent-config.mixed-harness.test.ts, test/agent-maintainability-check.test.ts, test/extension-build-queue-enqueue-contract.test.ts, test/fixtures/todo-api-repo/.pi/extensions/marker/index.ts, test/region-marker-cleanup.test.ts
Validation: `pnpm test`, `pnpm type-check`, and `pnpm maintainability:check` each exit 0.

## Integration contracts

- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (interface extension): Shared interface extension is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (interface extension-surface): Shared interface extension-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (interface test): Shared interface test is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (interface ui): Shared interface ui is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (interface ui-surface): Shared interface ui-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (interface extension): Shared interface extension is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (interface extension-surface): Shared interface extension-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (interface test): Shared interface test is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (interface ui): Shared interface ui is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (interface ui-surface): Shared interface ui-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance.
- mod-ac010-quality-gates -> mod-resubmit-recovery-provenance (plan dependency): mod-ac010-quality-gates builds on Identity-preserving resubmit recovery and provenance
- mod-ac010-quality-gates -> mod-session-plan-status-surfaces (plan dependency): mod-ac010-quality-gates builds on Session-plan status/projection surfaces
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file AGENTS.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file CHANGELOG.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/architecture.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/extensions.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/hooks.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/releasing.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/roadmap.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file docs/stacking.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge-plugin/skills/profile/profile.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge-plugin/skills/recover/recover.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/config.yaml): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/kanban.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/promotion.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/registration.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/storage.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/backlog-domain.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/events-schemas-auto-build.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/events-schemas-build-evaluator.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/queue-control-contracts.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/queue-recovery.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/build-history-accepted-success.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/now/__tests__/queue-card.test.tsx): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-ac010-quality-gates (shared file test/extension-build-queue-enqueue-contract.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file .claude-plugin/marketplace.json): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file .claude/skills/eforge-daemon-restart/SKILL.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file .claude/skills/eval-analysis/SKILL.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file .pi/extensions/eforge-dev/event-tail.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file docs/images/console-recovery-build.png): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge-plugin/skills/status/status.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/backlog-curation-schemas.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/backlog-curation-source.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/canonical/lifecycle-records.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/canonical/session-plan-records.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/index.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/plan-revision-orchestration.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/planning-state-policy.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/projections/lifecycle.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/projections/session-plans.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/README.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/session-plan-actions.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/session-plan-schemas.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/shipped-evidence-git.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/shipped-evidence-limits.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/shipped-evidence-matching.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/shipped-evidence-pr.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/shipped-evidence-types.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/shipped-evidence.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/prds/detect-shipped-backlog-items-from-git-and-pr-history.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/prds/orphaned-queued-build-adoption.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file eforge/prds/same-plan-within-build-recovery.md): shared-evidence-primary-owner
- mod-resubmit-recovery-provenance -> mod-session-plan-status-surfaces (shared file packages/engine/src/queue/build-single-prd.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file .github/workflows/ci.yml): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file .github/workflows/publish.yml): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file AGENTS.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file CHANGELOG.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file CONTRIBUTING.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/architecture.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/extensions.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/hooks.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/releasing.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/roadmap.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file docs/stacking.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge-plugin/skills/profile/profile.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge-plugin/skills/recover/recover.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/config.yaml): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/dependency-update-evidence.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-guardrails/maintainability-parser.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/kanban.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/promotion.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/registration.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/storage.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/backlog-curation-full-audit.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/backlog-domain.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/events-schemas-auto-build.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/events-schemas-build-evaluator.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/queue-control-contracts.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/client/src/__tests__/queue-recovery.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/active-session-streams.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/app.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/build-history-accepted-success.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/console-shell.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/header.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/now-dashboard.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/system-view.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/__tests__/use-run-detail.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/now/__tests__/queue-card.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/console-ui/vitest.config.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file packages/monitor/src/routes/session-plan-service.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-ac010-quality-gates (shared file test/extension-build-queue-enqueue-contract.test.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge-plugin/skills/restart/restart.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge-plugin/skills/update/update.md): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/backlog-records.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/coverage.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/item-body-sections.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/planning-task-records.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/recommendation-records.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/search-dirty.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file eforge/extensions/eforge-plan/canonical/store.ts): shared-evidence-primary-owner
- mod-session-plan-status-surfaces -> mod-resubmit-recovery-provenance (shared file test/fixtures/planner/fix-removed-queue-coverage-cleanup.md): shared-evidence-primary-owner

## Shared file ownership

- .claude-plugin/marketplace.json: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- .claude/skills/eforge-daemon-restart/SKILL.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- .claude/skills/eforge-release/SKILL.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- .claude/skills/eval-analysis/SKILL.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- .github/workflows/ci.yml: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- .github/workflows/publish.yml: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/event-tail.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/index.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/README.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- AGENTS.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- CHANGELOG.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- CONTRIBUTING.md: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/architecture.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/config-migration.md: owner mod-ac010-quality-gates (single-atom-evidence)
- docs/extensions.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/hooks.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/images/console-recovery-build.png: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- docs/llm-friendly-code.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/releasing.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/roadmap.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/stacking.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- docs/webux-workspaces.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge-plugin/.mcp.json: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/config/config.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/extend/extend.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/init/init.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/profile-new/profile-new.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/profile/profile.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/recover/recover.md: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/restart/restart.md: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/stack/stack.md: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge-plugin/skills/status/status.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge-plugin/skills/update/update.md: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/config.yaml: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/dependency-update-evidence.md: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/maintainability-parser.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/kanban.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-publication.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/promotion.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/registration.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-projection-preservation.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/storage.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/agent-task-contributions.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-capture-guardrails.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-full-audit.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-schemas.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-source.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-domain.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/backlog-records.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/coverage.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/item-body-sections.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/lifecycle-records.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/planning-task-records.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/recommendation-records.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/search-dirty.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/session-plan-records.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/canonical/store.ts: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- eforge/extensions/eforge-plan/index.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- eforge/extensions/eforge-plan/plan-revision-orchestration.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/planning-state-policy.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/board.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/coverage.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/index.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/items.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/lifecycle.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/links.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/pagination.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/recommendations.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/session-plans.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/store.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/projections/types.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/promote.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- eforge/extensions/eforge-plan/README.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/session-plan-actions.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/session-plan-metadata.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- eforge/extensions/eforge-plan/session-plan-schemas.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/session-plan-view-model.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/shipped-evidence-git.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/shipped-evidence-limits.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/shipped-evidence-matching.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/shipped-evidence-pr.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/shipped-evidence-types.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/shipped-evidence.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/lifecycle-evidence-panel.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.test.tsx: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/extensions/eforge-playbooks/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/prds/detect-shipped-backlog-items-from-git-and-pr-history.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/prds/extract-standalone-eforge-playbooks-extension.md: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- eforge/prds/orphaned-queued-build-adoption.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/prds/same-plan-within-build-recovery.md: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- eforge/prds/strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup.md: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/client/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-auto-build.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-build-evaluator.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-actions.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-extension-inputs.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/events-wire-parity-invalid.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-contributions.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/queue-control-contracts.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/__tests__/queue-recovery.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/api/queue-recovery.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/client/src/api/queue.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/client/src/browser-queue-control.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/client/src/browser-queue-recovery.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/client/src/event-projections/queue.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/client/src/events/variants/build.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/client/src/routes/route-map.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/routes/session-plan.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/client/src/types/auto-build.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/console-ui/.storybook/preview.tsx: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/console-ui/src/__tests__/active-session-streams.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/app.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/build-history-accepted-success.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/console-shell.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/header.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/now-dashboard.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/system-view.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/use-run-detail.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/app.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/header/auto-build-toggle.tsx: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/console-ui/src/components/header/control-surface-links.tsx: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/now/__tests__/queue-card.test.tsx: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/components/pipeline/agent-detail-sheet.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/components/recovery/__tests__/recovery-auto-resume-provenance.test.tsx: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/views/run-detail/__tests__/pipeline-section.test.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/views/run-detail/bottom-tab-panel.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/views/run-detail/pipeline-section.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/views/run-detail/run-detail-view.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/views/run-detail/summary-chips.tsx: owner mod-session-plan-status-surfaces (single-atom-evidence)
- packages/console-ui/src/views/runs/run-plans-preview.tsx: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/console-ui/vitest.config.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/docs-gen/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/docs-gen/src/provenance.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- packages/eforge/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/eforge/src/cli/mcp-extension-contributions.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/eforge/src/cli/mcp-proxy.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/eforge/src/cli/mcp-tool-factory.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/engine/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/engine/src/harnesses/pi-mcp-bridge.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/engine/src/provenance.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- packages/engine/src/queue/build-single-prd.ts: owner mod-session-plan-status-surfaces; consumers mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/engine/src/queue/control.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/extension-sdk/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/input/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/input/src/session-plan-creation-draft.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/input/src/session-plan-realpath.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/input/src/session-planning-workflow.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/monitor/package.json: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/monitor/src/__tests__/monitor-region-markers.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- packages/monitor/src/routes/extension-content.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/monitor/src/routes/queue-control.ts: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)
- packages/monitor/src/routes/session-plan-service.ts: owner mod-ac010-quality-gates; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/monitor/src/routes/session-plans.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- packages/pi-eforge/extensions/eforge/index.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- scripts/check-agent-maintainability.mjs: owner mod-ac010-quality-gates (single-atom-evidence)
- scripts/check-skill-parity.mjs: owner mod-ac010-quality-gates (single-atom-evidence)
- test/ac008-adoption-reconciliation-regression.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/ac008-daemon-wire-ownership.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/accept-success-direct-pr-landing.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/accept-success-static-discipline.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/acceptance-criteria-inventory.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/acceptance-criteria-quality.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/acceptance-summary.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/acceptance-unknown-resolver.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/adopt.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/adopted-queue-worker-restart.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/adopted-success-preservation.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/agent-config.mixed-harness.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/agent-maintainability-check.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/continue-repair-cli-mcp.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/docs-kernel-boundary.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/extension-build-queue-enqueue-contract.test.ts: owner mod-ac010-quality-gates; consumers mod-resubmit-recovery-provenance, mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/fixtures/planner/fix-removed-queue-coverage-cleanup.md: owner mod-resubmit-recovery-provenance; consumers mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/fixtures/todo-api-repo/.pi/extensions/marker/index.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/landing-actions-provenance.test.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- test/mcp-tool-factory.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/profile-wiring-mcp-native.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/provenance.test.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- test/queue-controls-cli-mcp-pi.test.ts: owner mod-session-plan-status-surfaces (shared-evidence-primary-owner)
- test/region-marker-cleanup.test.ts: owner mod-ac010-quality-gates (single-atom-evidence)
- test/stack-runtime-landing-provenance.test.ts: owner mod-resubmit-recovery-provenance (single-atom-evidence)
- web/public/reference/events.md: owner mod-resubmit-recovery-provenance (shared-evidence-primary-owner)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "mod-session-plan-status-surfaces",
      "title": "Session-plan status/projection surfaces",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-003",
        "ac-004",
        "ac-005"
      ],
      "aspectIds": [
        "ac-001:general:general",
        "ac-002:interface:ui",
        "ac-002:interface:ui-surface",
        "ac-002:subsystem:incomplete",
        "ac-002:subsystem:mixed",
        "ac-002:subsystem:ui",
        "ac-003:subsystem:planned",
        "ac-003:subsystem:shipped",
        "ac-004:interface:extension",
        "ac-004:interface:extension-surface",
        "ac-004:subsystem:extension",
        "ac-004:subsystem:kernel",
        "ac-004:subsystem:mcp",
        "ac-005:interface:extension",
        "ac-005:interface:extension-surface",
        "ac-005:subsystem:extension"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "mod-resubmit-recovery-provenance",
      "title": "Identity-preserving resubmit recovery and provenance",
      "residue": false,
      "criterionIds": [
        "ac-006",
        "ac-007",
        "ac-008",
        "ac-009"
      ],
      "aspectIds": [
        "ac-006:subsystem:build",
        "ac-006:subsystem:deleting",
        "ac-006:subsystem:queue",
        "ac-006:subsystem:recreating",
        "ac-007:subsystem:provenance",
        "ac-007:subsystem:recommendation",
        "ac-008:subsystem:build",
        "ac-008:subsystem:queue",
        "ac-009:general:general"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "mod-ac010-quality-gates",
      "title": "AC-010 quality gates",
      "residue": false,
      "criterionIds": [
        "ac-010"
      ],
      "aspectIds": [
        "ac-010:interface:test",
        "ac-010:subsystem:test"
      ],
      "dependsOnPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude-plugin/marketplace.json",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/images/console-recovery-build.png",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/stacking.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/.mcp.json",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/restart/restart.md",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/status/status.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/update/update.md",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/dependency-update-evidence.md",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/maintainability-parser.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/promotion.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-projection-preservation.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/storage.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/agent-task-contributions.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-capture-guardrails.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-full-audit.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-source.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-domain.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/backlog-records.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/coverage.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/item-body-sections.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/lifecycle-records.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/planning-task-records.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/recommendation-records.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/search-dirty.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/session-plan-records.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/store.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/index.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/plan-revision-orchestration.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/planning-state-policy.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/board.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/coverage.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/index.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/items.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/lifecycle.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/links.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/pagination.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/recommendations.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/session-plans.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/store.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/types.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/promote.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/README.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/session-plan-actions.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/session-plan-metadata.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/session-plan-schemas.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/session-plan-view-model.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence-git.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence-limits.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence-matching.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence-pr.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence-types.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/lifecycle-evidence-panel.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.test.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/detect-shipped-backlog-items-from-git-and-pr-history.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/extract-standalone-eforge-playbooks-extension.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/orphaned-queued-build-adoption.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/same-plan-within-build-recovery.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/prds/strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup.md",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-build-evaluator.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-actions.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-inputs.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/events-wire-parity-invalid.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contributions.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/queue-control-contracts.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/queue-recovery.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/queue-recovery.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/queue.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/browser-queue-control.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/browser-queue-recovery.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/event-projections/queue.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/events/variants/build.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/routes/route-map.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/routes/session-plan.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/types/auto-build.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/.storybook/preview.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/app.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/console-shell.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/header.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-dashboard.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/system-view.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/app.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/header/auto-build-toggle.tsx",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/header/control-surface-links.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/queue-card.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/agent-detail-sheet.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/recovery-auto-resume-provenance.test.tsx",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/__tests__/pipeline-section.test.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/bottom-tab-panel.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/pipeline-section.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/run-detail-view.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/summary-chips.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/runs/run-plans-preview.tsx",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance",
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/vitest.config.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/docs-gen/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/docs-gen/src/provenance.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/eforge/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/eforge/src/cli/mcp-extension-contributions.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/mcp-proxy.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/eforge/src/cli/mcp-tool-factory.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/harnesses/pi-mcp-bridge.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/provenance.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/build-single-prd.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/queue/control.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/extension-sdk/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/input/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/input/src/session-plan-creation-draft.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/input/src/session-plan-realpath.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/input/src/session-planning-workflow.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/package.json",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/monitor-region-markers.test.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/extension-content.ts",
      "ownerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/routes/queue-control.ts",
      "ownerPlanIds": [
        "mod-resubmit-recovery-provenance"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/routes/session-plan-service.ts",
      "ownerPlanIds": [
        "mod-ac010-quality-gates"
      ],
      "consumerPlanIds": [
        "mod-session-plan-status-surfaces"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:extension",
      "kind": "interface",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "extension",
      "summary": "Shared interface extension is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:extension-surface",
      "kind": "interface",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "extension-surface",
      "summary": "Shared interface extension-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:test",
      "kind": "interface",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:ui",
      "kind": "interface",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "ui",
      "summary": "Shared interface ui is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:ui-surface",
      "kind": "interface",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "ui-surface",
      "summary": "Shared interface ui-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-session-plan-status-surfaces->mod-ac010-quality-gates:extension",
      "kind": "interface",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "extension",
      "summary": "Shared interface extension is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-session-plan-status-surfaces->mod-ac010-quality-gates:extension-surface",
      "kind": "interface",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "extension-surface",
      "summary": "Shared interface extension-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-session-plan-status-surfaces->mod-ac010-quality-gates:test",
      "kind": "interface",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-session-plan-status-surfaces->mod-ac010-quality-gates:ui",
      "kind": "interface",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "ui",
      "summary": "Shared interface ui is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "interface:mod-session-plan-status-surfaces->mod-ac010-quality-gates:ui-surface",
      "kind": "interface",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "interfaceKey": "ui-surface",
      "summary": "Shared interface ui-surface is referenced by atoms atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance, atom-rescope-test. Primary atom atom-rescope-test owns reusable interface findings for consumers atom-rescope-build, atom-rescope-build-002, atom-rescope-extension, atom-rescope-extension-002, atom-rescope-general, atom-rescope-incomplete, atom-rescope-planned, atom-rescope-provenance."
    },
    {
      "contractId": "plan-dependency:mod-ac010-quality-gates->mod-resubmit-recovery-provenance:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-ac010-quality-gates",
      "toPlanId": "mod-resubmit-recovery-provenance",
      "summary": "mod-ac010-quality-gates builds on Identity-preserving resubmit recovery and provenance"
    },
    {
      "contractId": "plan-dependency:mod-ac010-quality-gates->mod-session-plan-status-surfaces:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-ac010-quality-gates",
      "toPlanId": "mod-session-plan-status-surfaces",
      "summary": "mod-ac010-quality-gates builds on Session-plan status/projection surfaces"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/architecture.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/architecture.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge-plugin/skills/profile/profile.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/profile/profile.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge-plugin/skills/recover/recover.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/recover/recover.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/promotion.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/promotion.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/storage.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/storage.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:eforge/extensions/eforge-plan/backlog-domain.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/backlog-domain.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/client/src/__tests__/events-schemas-build-evaluator.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/events-schemas-build-evaluator.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/client/src/__tests__/queue-control-contracts.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/queue-control-contracts.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/client/src/__tests__/queue-recovery.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/queue-recovery.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/console-ui/src/components/now/__tests__/queue-card.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/now/__tests__/queue-card.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-ac010-quality-gates:test/extension-build-queue-enqueue-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "test/extension-build-queue-enqueue-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:.claude-plugin/marketplace.json",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": ".claude-plugin/marketplace.json",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:.claude/skills/eforge-daemon-restart/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:.claude/skills/eval-analysis/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:.pi/extensions/eforge-dev/event-tail.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:docs/images/console-recovery-build.png",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "docs/images/console-recovery-build.png",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge-plugin/skills/status/status.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge-plugin/skills/status/status.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/backlog-curation-source.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/backlog-curation-source.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/canonical/lifecycle-records.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/canonical/lifecycle-records.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/canonical/session-plan-records.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/canonical/session-plan-records.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/plan-revision-orchestration.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/plan-revision-orchestration.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/planning-state-policy.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/planning-state-policy.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/projections/lifecycle.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/projections/lifecycle.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/projections/session-plans.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/projections/session-plans.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/session-plan-actions.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/session-plan-actions.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/session-plan-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/session-plan-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/shipped-evidence-git.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/shipped-evidence-git.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/shipped-evidence-limits.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/shipped-evidence-limits.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/shipped-evidence-matching.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/shipped-evidence-matching.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/shipped-evidence-pr.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/shipped-evidence-pr.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/shipped-evidence-types.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/shipped-evidence-types.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/shipped-evidence.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/shipped-evidence.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/prds/detect-shipped-backlog-items-from-git-and-pr-history.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/prds/detect-shipped-backlog-items-from-git-and-pr-history.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/prds/orphaned-queued-build-adoption.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/prds/orphaned-queued-build-adoption.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:eforge/prds/same-plan-within-build-recovery.md",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "eforge/prds/same-plan-within-build-recovery.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-resubmit-recovery-provenance->mod-session-plan-status-surfaces:packages/engine/src/queue/build-single-prd.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-resubmit-recovery-provenance",
      "toPlanId": "mod-session-plan-status-surfaces",
      "path": "packages/engine/src/queue/build-single-prd.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:.github/workflows/ci.yml",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".github/workflows/ci.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:.github/workflows/publish.yml",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".github/workflows/publish.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:CONTRIBUTING.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "CONTRIBUTING.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/architecture.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/architecture.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge-plugin/skills/profile/profile.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/profile/profile.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge-plugin/skills/recover/recover.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge-plugin/skills/recover/recover.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/dependency-update-evidence.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/dependency-update-evidence.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-guardrails/maintainability-parser.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-guardrails/maintainability-parser.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/promotion.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/promotion.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-metadata.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/storage.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/storage.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/backlog-curation-full-audit.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/backlog-curation-full-audit.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/backlog-domain.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/backlog-domain.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/client/src/__tests__/events-schemas-build-evaluator.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/events-schemas-build-evaluator.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/client/src/__tests__/queue-control-contracts.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/queue-control-contracts.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/client/src/__tests__/queue-recovery.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/client/src/__tests__/queue-recovery.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/app.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/app.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/console-shell.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/console-shell.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/header.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/header.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/now-dashboard.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/now-dashboard.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/system-view.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/system-view.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/now/__tests__/queue-card.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/now/__tests__/queue-card.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/console-ui/vitest.config.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/console-ui/vitest.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:packages/monitor/src/routes/session-plan-service.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "packages/monitor/src/routes/session-plan-service.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-ac010-quality-gates:test/extension-build-queue-enqueue-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-ac010-quality-gates",
      "path": "test/extension-build-queue-enqueue-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-resubmit-recovery-provenance:eforge-plugin/skills/restart/restart.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-resubmit-recovery-provenance",
      "path": "eforge-plugin/skills/restart/restart.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-session-plan-status-surfaces->mod-resubmit-recovery-provenance:eforge-plugin/skills/update/update.md",
      "kind": "shared-file",
      "fromPlanId": "mod-session-plan-status-surfaces",
      "toPlanId": "mod-resubmit-recovery-provenance",
      "path": "eforge-plugin/skills/update/update.md",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```