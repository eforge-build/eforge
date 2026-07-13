# Planner Compiler Architecture

## Summary

Deterministic single-atom passthrough of atom-root. Promote the existing queue-recovery flow into the failed-build dialog's primary UI while preserving advanced cascade repair. Automatically analyze on open, derive strict simple-retry eligibility, gate mutation behind confirmation, apply the analyzed queue strategy exactly once, retain warnings/results, audit competing route-backed controls, and add focused console UI coverage.

## Compiler status

Compiler status: complete
Source hash: ef94cdc921d0dd48ebfa8bdaf87c4caa8f31f644dd79850a1476b0ffff9d75e4

## Plan boundaries

### console-failed-build-retry — Console failed-build retry flow

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:subsystem:analysis, ac-006:subsystem:apply, ac-007:general:general, ac-008:general:general, ac-009:subsystem:dependency, ac-009:subsystem:reactivation, ac-009:subsystem:repair, ac-009:subsystem:stack-parent, ac-010:interface:route, ac-010:interface:route-api, ac-010:subsystem:route, ac-011:interface:test, ac-011:subsystem:descendant, ac-011:subsystem:override, ac-011:subsystem:repair, ac-011:subsystem:test, ac-011:subsystem:warning, ac-012:interface:test, ac-012:interface:ui, ac-012:interface:ui-surface, ac-012:subsystem:console-ui, ac-012:subsystem:eforge-build, ac-012:subsystem:test, ac-012:subsystem:ui
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-daemon-restart/SKILL.md, .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/event-tail.ts, .pi/extensions/eforge-dev/index.ts, .pi/extensions/eforge-dev/README.md, .pi/git-workflow.json, AGENTS.md, CHANGELOG.md, CONTRIBUTING.md, docs/architecture.md, docs/config-migration.md, docs/config.md, docs/llm-friendly-code.md, docs/releasing.md, docs/roadmap.md, eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/init/init.md, eforge-plugin/skills/profile-new/profile-new.md, eforge-plugin/skills/profile/profile.md, eforge-plugin/skills/recover/recover.md, eforge-plugin/skills/stack/stack.md, eforge/config.yaml, eforge/dependency-update-evidence.md, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts, eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts, eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-status-surfaces.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts, eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts, eforge/extensions/eforge-plan/backlog-curation-apply.ts, eforge/extensions/eforge-plan/backlog-curation-git-delta.ts, eforge/playbooks/dependency-update.md, packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts, packages/client/src/__tests__/events-wire-parity-stack-fixtures.ts, packages/client/src/__tests__/events-wire-parity-stack.test.ts, packages/client/src/api/accept-recovery-success.ts, packages/client/src/api/apply-recovery.ts, packages/client/src/api/config.ts, packages/client/src/api/continue-repair-eligibility.ts, packages/client/src/api/continue-repair.ts, packages/client/src/api/daemon.ts, packages/client/src/api/stack.ts, packages/client/src/browser-queue-recovery.ts, packages/client/src/events/shared/stack-wire.ts, packages/client/src/events/variants/stack.ts, packages/client/src/queue-recovery.ts, packages/client/src/routes/route-map.ts, packages/client/src/routes/stack.ts, packages/console-ui/.storybook/preview.tsx, packages/console-ui/src/__tests__/active-session-streams.test.tsx, packages/console-ui/src/__tests__/app.test.tsx, packages/console-ui/src/__tests__/console-shell.test.tsx, packages/console-ui/src/__tests__/header.test.tsx, packages/console-ui/src/__tests__/now-dashboard.test.tsx, packages/console-ui/src/__tests__/system-view.test.tsx, packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/app.tsx, packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx, packages/console-ui/src/components/activity/activity-drawer.tsx, packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx, packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx, packages/console-ui/src/components/graph/dependency-graph.tsx, packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx, packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx, packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx, packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx, packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx, packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx, packages/console-ui/src/components/now/attention-panel.tsx, packages/console-ui/src/components/now/queue-stack-card.tsx, packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts, packages/console-ui/src/components/recovery/advanced-cascade-section.tsx, packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx, packages/console-ui/src/components/recovery/queue-cascade-repair-state.ts, packages/console-ui/src/components/recovery/recovery-report-panel.tsx, packages/console-ui/src/components/shell/route-placeholder.tsx, packages/console-ui/src/hooks/use-auto-build.test.tsx, packages/console-ui/src/lib/selectors/__tests__/queue-dependency-live-projection.test.ts, packages/engine/src/agents/dependency-detector.ts, packages/engine/src/evaluation/apply.ts, packages/engine/src/extensions/dependency-resolution.ts, packages/engine/src/planner-compiler/source-analysis.ts, packages/engine/src/planner-compiler/source-localization-repair.ts, packages/engine/src/planning-quality/apply-fixes.ts, packages/engine/src/prompts/dependency-detector.md, packages/engine/src/prompts/validation-repair-fixer.md, packages/engine/src/queue/recovery-cascade.ts, packages/engine/src/queue/stack-parent-inference.ts, packages/engine/src/recovery/apply.ts, packages/engine/src/stacking/base-repair.ts, packages/engine/test/stack-parent-inference.test.ts, packages/monitor/src/__tests__/auto-build-route.test.ts, packages/monitor/src/__tests__/efficiency-analytics-route.test.ts, packages/monitor/src/__tests__/resume-plans-route.test.ts, packages/monitor/src/__tests__/route-test-harness.ts, packages/monitor/src/__tests__/stack-layers-route.test.ts, packages/monitor/src/http/route-errors.ts, packages/monitor/src/routes/continue-repair-service.ts, packages/monitor/src/routes/continue-repair.ts, packages/monitor/src/routes/queue-recovery.ts, test/api-route-helpers.ts, test/apply-recovery-accept-success.test.ts, test/apply-recovery-route.test.ts, test/apply-recovery.test.ts, test/continue-repair-cli-mcp.test.ts, test/continue-repair-eligibility-route.test.ts, test/continue-repair-public-surface.test.ts, test/continue-repair-route.test.ts, test/dependency-detector.test.ts, test/dependency-graph.test.ts, test/extension-dependency-contracts.test.ts, test/onsuccess-override-precedence.test.ts, test/per-build-profile-override.test.ts, test/planning-compiler-repair-loop.test.ts, test/stack-sync-route.test.ts
Validation: Tests demonstrate automatic analysis, strict eligibility and copy, primary blockers, warning override, confirmation-only mutation, exact queue-recovery invocation, no sidecar apply, queue refresh, persistent outcomes, idempotency/pending guards, no competing retry control, and unchanged complex repair behavior. Run the four commands required by ac-012.

## Integration contracts

- (none)

## Shared file ownership

- .claude/skills/eforge-daemon-restart/SKILL.md: owner console-failed-build-retry (single-atom-evidence)
- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner console-failed-build-retry (single-atom-evidence)
- .claude/skills/eforge-release/SKILL.md: owner console-failed-build-retry (single-atom-evidence)
- .claude/skills/eval-analysis/SKILL.md: owner console-failed-build-retry (single-atom-evidence)
- .github/workflows/ci.yml: owner console-failed-build-retry (single-atom-evidence)
- .github/workflows/publish.yml: owner console-failed-build-retry (single-atom-evidence)
- .pi/extensions/eforge-dev/event-tail.ts: owner console-failed-build-retry (single-atom-evidence)
- .pi/extensions/eforge-dev/index.ts: owner console-failed-build-retry (single-atom-evidence)
- .pi/extensions/eforge-dev/README.md: owner console-failed-build-retry (single-atom-evidence)
- .pi/git-workflow.json: owner console-failed-build-retry (single-atom-evidence)
- AGENTS.md: owner console-failed-build-retry (single-atom-evidence)
- CHANGELOG.md: owner console-failed-build-retry (single-atom-evidence)
- CONTRIBUTING.md: owner console-failed-build-retry (single-atom-evidence)
- docs/architecture.md: owner console-failed-build-retry (single-atom-evidence)
- docs/config-migration.md: owner console-failed-build-retry (single-atom-evidence)
- docs/config.md: owner console-failed-build-retry (single-atom-evidence)
- docs/llm-friendly-code.md: owner console-failed-build-retry (single-atom-evidence)
- docs/releasing.md: owner console-failed-build-retry (single-atom-evidence)
- docs/roadmap.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/.claude-plugin/plugin.json: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/config/config.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/extend/extend.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/init/init.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/profile-new/profile-new.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/profile/profile.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/recover/recover.md: owner console-failed-build-retry (single-atom-evidence)
- eforge-plugin/skills/stack/stack.md: owner console-failed-build-retry (single-atom-evidence)
- eforge/config.yaml: owner console-failed-build-retry (single-atom-evidence)
- eforge/dependency-update-evidence.md: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-guardrails/index.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/session-plan-status-surfaces.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-apply.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-git-delta.ts: owner console-failed-build-retry (single-atom-evidence)
- eforge/playbooks/dependency-update.md: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/__tests__/events-wire-parity-stack-fixtures.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/__tests__/events-wire-parity-stack.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/accept-recovery-success.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/apply-recovery.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/config.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/continue-repair-eligibility.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/continue-repair.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/daemon.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/api/stack.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/browser-queue-recovery.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/events/shared/stack-wire.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/events/variants/stack.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/queue-recovery.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/routes/route-map.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/client/src/routes/stack.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/.storybook/preview.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/active-session-streams.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/app.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/console-shell.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/header.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/now-dashboard.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/system-view.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/__tests__/use-run-detail.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/app.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/activity/activity-drawer.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/graph/dependency-graph.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/attention-panel.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/now/queue-stack-card.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/recovery/advanced-cascade-section.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/recovery/queue-cascade-repair-state.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/recovery/recovery-report-panel.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/components/shell/route-placeholder.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/hooks/use-auto-build.test.tsx: owner console-failed-build-retry (single-atom-evidence)
- packages/console-ui/src/lib/selectors/__tests__/queue-dependency-live-projection.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/agents/dependency-detector.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/evaluation/apply.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/extensions/dependency-resolution.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/planner-compiler/source-analysis.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/planner-compiler/source-localization-repair.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/planning-quality/apply-fixes.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/prompts/dependency-detector.md: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/prompts/validation-repair-fixer.md: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/queue/recovery-cascade.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/queue/stack-parent-inference.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/recovery/apply.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/src/stacking/base-repair.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/engine/test/stack-parent-inference.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/__tests__/auto-build-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/__tests__/efficiency-analytics-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/__tests__/resume-plans-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/__tests__/route-test-harness.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/__tests__/stack-layers-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/http/route-errors.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/routes/continue-repair-service.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/routes/continue-repair.ts: owner console-failed-build-retry (single-atom-evidence)
- packages/monitor/src/routes/queue-recovery.ts: owner console-failed-build-retry (single-atom-evidence)
- test/api-route-helpers.ts: owner console-failed-build-retry (single-atom-evidence)
- test/apply-recovery-accept-success.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/apply-recovery-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/apply-recovery.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/continue-repair-cli-mcp.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/continue-repair-eligibility-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/continue-repair-public-surface.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/continue-repair-route.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/dependency-detector.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/dependency-graph.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/extension-dependency-contracts.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/onsuccess-override-precedence.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/per-build-profile-override.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/planning-compiler-repair-loop.test.ts: owner console-failed-build-retry (single-atom-evidence)
- test/stack-sync-route.test.ts: owner console-failed-build-retry (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "console-failed-build-retry",
      "title": "Console failed-build retry flow",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-003",
        "ac-004",
        "ac-005",
        "ac-006",
        "ac-007",
        "ac-008",
        "ac-009",
        "ac-010",
        "ac-011",
        "ac-012"
      ],
      "aspectIds": [
        "ac-001:general:general",
        "ac-002:general:general",
        "ac-003:general:general",
        "ac-004:general:general",
        "ac-005:general:general",
        "ac-006:subsystem:analysis",
        "ac-006:subsystem:apply",
        "ac-007:general:general",
        "ac-008:general:general",
        "ac-009:subsystem:dependency",
        "ac-009:subsystem:reactivation",
        "ac-009:subsystem:repair",
        "ac-009:subsystem:stack-parent",
        "ac-010:interface:route",
        "ac-010:interface:route-api",
        "ac-010:subsystem:route",
        "ac-011:interface:test",
        "ac-011:subsystem:descendant",
        "ac-011:subsystem:override",
        "ac-011:subsystem:repair",
        "ac-011:subsystem:test",
        "ac-011:subsystem:warning",
        "ac-012:interface:test",
        "ac-012:interface:ui",
        "ac-012:interface:ui-surface",
        "ac-012:subsystem:console-ui",
        "ac-012:subsystem:eforge-build",
        "ac-012:subsystem:test",
        "ac-012:subsystem:ui"
      ],
      "dependsOnPlanIds": []
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/git-workflow.json",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/dependency-update-evidence.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-status-surfaces.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply-utils.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-apply.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-git-delta.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/playbooks/dependency-update.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-wire-parity-stack-fixtures.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-wire-parity-stack.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/accept-recovery-success.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/apply-recovery.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/config.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/continue-repair-eligibility.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/continue-repair.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/daemon.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/stack.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/browser-queue-recovery.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/stack-wire.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/variants/stack.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/queue-recovery.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/routes/route-map.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/routes/stack.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/.storybook/preview.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/app.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/console-shell.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/header.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-dashboard.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/system-view.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/app.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/graph/dependency-graph.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/header/__tests__/auto-build-toggle-recovery-auto-resume.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/build-history-card.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/attention-panel.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/queue-stack-card.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/advanced-cascade-section.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/queue-cascade-repair-state.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/recovery-report-panel.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/shell/route-placeholder.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-auto-build.test.tsx",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/selectors/__tests__/queue-dependency-live-projection.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/dependency-detector.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/evaluation/apply.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/dependency-resolution.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/source-analysis.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/source-localization-repair.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planning-quality/apply-fixes.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/prompts/dependency-detector.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/prompts/validation-repair-fixer.md",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/recovery-cascade.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/stack-parent-inference.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/apply.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/stacking/base-repair.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/test/stack-parent-inference.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/http/route-errors.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/continue-repair-service.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/continue-repair.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/queue-recovery.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/api-route-helpers.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery-accept-success.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-cli-mcp.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-eligibility-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-public-surface.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/dependency-detector.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/dependency-graph.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/extension-dependency-contracts.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/onsuccess-override-precedence.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/per-build-profile-override.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-compiler-repair-loop.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/stack-sync-route.test.ts",
      "ownerPlanIds": [
        "console-failed-build-retry"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    }
  ],
  "contracts": [],
  "conflicts": []
}
```