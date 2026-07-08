# Planner Compiler Architecture

## Summary

Merged same-plan recovery inputs into two buildable modules: the recovery core (eligibility, lifecycle evidence, budget, recheck gate, rejected/unresolved fixer context, and safe fallback/refusal behavior) and recovery visibility/refusal regressions (Console projection plus cross-plan/upstream refusal tests). No conflicts. One repair-only source-localization diagnostic remains because producers did not provide concrete owner paths for AC-002 event sources, AC-007 projections, or AC-008 test helpers.

## Compiler status

Compiler status: complete
Source hash: 253e535f99c439f4fdcdd3cb26e069429750c0f82760cc7aa7dbbc2731270efa

## Plan boundaries

### mod-same-plan-recovery-core — Same-plan recovery core

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006
Aspects: ac-001:interface:test, ac-001:subsystem:human-review, ac-001:subsystem:manual, ac-001:subsystem:review, ac-001:subsystem:test, ac-002:evidence:start-attempt-result-skip-or-exhausted, ac-003:general:general, ac-004:subsystem:rejected, ac-004:subsystem:unresolved, ac-005:general:general, ac-006:subsystem:cross-plan, ac-006:subsystem:failure, ac-006:subsystem:preflight, ac-006:subsystem:sidecar, ac-006:subsystem:upstream, ac-006:subsystem:worktree
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-daemon-restart/SKILL.md, .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .pi/extensions/eforge-dev/event-tail.ts, .pi/extensions/eforge-dev/index.ts, CHANGELOG.md, docs/architecture.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/roadmap.md, docs/stacking.md, docs/webux-workspaces.md, eforge-plugin/skills/config/config.md, eforge-plugin/skills/profile-new/profile-new.md, eforge-plugin/skills/profile/profile.md, eforge-plugin/skills/recover/recover.md, eforge-plugin/skills/restart/restart.md, eforge-plugin/skills/stack/stack.md, eforge-plugin/skills/status/status.md, eforge-plugin/skills/update/update.md, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts, eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.test.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.test.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx, packages/client/src/__tests__/terminal-failure-event.test.ts, packages/client/src/api/extension-contribution-failure-envelope.ts, packages/client/src/api/recovery-sidecar.ts, packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts, packages/console-ui/src/components/common/failure-banner.tsx, packages/console-ui/src/lib/auto-start.ts, packages/console-ui/src/lib/selectors/queue-dispatch-failure.ts, packages/eforge/src/cli/run-or-delegate.ts, packages/engine/src/compile-resilience/preflight.ts, packages/engine/src/orchestrator/validation-dirty-worktree.ts, packages/engine/src/queue/recovery-preflight.ts, packages/engine/src/recovery/applied-sidecar.ts, packages/engine/src/recovery/failed-resume-sidecar-finalization.ts, packages/engine/src/recovery/failure-summary.ts, packages/engine/src/recovery/resume-sidecar.ts, packages/engine/src/recovery/sidecar-markdown.ts, packages/engine/src/recovery/sidecar-payload.ts, packages/engine/src/recovery/sidecar-read.ts, packages/engine/src/recovery/sidecar.ts, packages/engine/src/recovery/terminal-failure-history.ts, packages/engine/src/terminal-failure.ts, packages/engine/src/worktree-manager.ts, packages/engine/src/worktree-ops.ts, packages/engine/test/events.agent-start.test.ts, packages/monitor/src/__tests__/queue-dispatch-failure-projection.test.ts, packages/monitor/src/routes/recovery-sidecar-service.ts, start/attempt/result/skip-or-exhausted, test/agent-start-toolbelt-fields.test.ts, test/auto-build-pause-on-failure.test.ts, test/auto-build-resume-after-failure.test.ts, test/client-no-start-api-helpers.test.ts, test/compile-preflight-boundaries.test.ts, test/compile-preflight-engine.test.ts, test/compile-preflight.test.ts, test/pi-ambient-status-no-start.test.ts, test/pi-harness-result-extraction.test.ts, test/pi-no-start-policy.test.ts, test/recovery-compile-scope-sidecar-rendering.test.ts, test/recovery-decomposition-sidecar-rendering.test.ts, test/recovery-failure-summary.test.ts, test/recovery-sidecar-analyst-network-fallback.test.ts, test/stack-runtime-landing-metadata-preflight.test.ts, test/worktree-integration.test.ts, test/worktree-manager.test.ts, test/worktree-reconciliation.test.ts
Validation: Author targeted Vitest for active-plan eligibility, other-plan/manual/human-review exclusions, lifecycle events, budget exhaustion, rerun gating, stale pass data refusal, rejected/unresolved context rendering, no review-counter reuse, and terminal/sidecar fallback. Run pnpm type-check and focused tests.

### mod-recovery-visibility-refusal-regressions — Recovery visibility/refusal regressions

Criteria: ac-007, ac-008
Aspects: ac-007:interface:test, ac-007:subsystem:console, ac-007:subsystem:review, ac-007:subsystem:run, ac-007:subsystem:test, ac-008:interface:test, ac-008:subsystem:cross-plan, ac-008:subsystem:test, ac-008:subsystem:upstream
Depends on: mod-same-plan-recovery-core
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/README.md, CONTRIBUTING.md, docs/config-migration.md, docs/images/console-recovery-build.png, docs/releasing.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/init/init.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/kanban.test.ts, eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts, eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx, eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts, eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts, eforge/extensions/eforge-playbooks/run-playbook-action.ts, eforge/prds/console-efficiency-telemetry-and-analytics.md, eforge/prds/implement-iframe-bundled-console-workstation-sdk.md, packages/client/src/__tests__/events-schemas-review-cycle.test.ts, packages/client/src/events/constants.ts, packages/client/src/events/decisions.ts, packages/client/src/events/envelope.ts, packages/client/src/events/parse.ts, packages/client/src/events/queue-events.ts, packages/client/src/events/root.ts, packages/client/src/events/shared/agent-fields.ts, packages/client/src/events/shared/compile-resilience.ts, packages/client/src/events/shared/extension-actions.ts, packages/client/src/events/shared/planning-decomposition.ts, packages/client/src/events/shared/recovery-auto-resume.ts, packages/client/src/events/shared/schemas.ts, packages/client/src/run-status.ts, packages/console-ui/.gitignore, packages/console-ui/.storybook/main.ts, packages/console-ui/.storybook/preview.tsx, packages/console-ui/components.json, packages/console-ui/index.html, packages/console-ui/package.json, packages/console-ui/postcss.config.js, packages/console-ui/public/eforge-logo.svg, packages/console-ui/src/__tests__/active-builds.test.ts, packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts, packages/console-ui/src/__tests__/active-session-streams.test.tsx, packages/console-ui/src/__tests__/activity-base-sync-selectors.test.ts, packages/console-ui/src/__tests__/activity-selectors.test.ts, packages/console-ui/src/__tests__/app.test.tsx, packages/console-ui/src/__tests__/build-history-accepted-success.test.ts, packages/console-ui/src/__tests__/compile-resilience-format.test.ts, packages/console-ui/src/__tests__/console-shell.test.tsx, packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts, packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts, packages/console-ui/src/__tests__/header.test.tsx, packages/console-ui/src/__tests__/now-dashboard.test.tsx, packages/console-ui/src/__tests__/system-view.test.tsx, packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/app.tsx, packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx, packages/console-ui/src/components/header/control-surface-links.tsx, packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts, packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx, packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts, packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx, packages/console-ui/src/hooks/use-run-detail.ts, packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts, packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts, packages/console-ui/src/main.tsx, packages/engine/src/agent-runtime-registry.ts, packages/engine/src/agents/acceptance-unknown-resolver.ts, packages/engine/src/agents/builder.ts, packages/engine/src/agents/common.ts, packages/engine/src/agents/dependency-detector.ts, packages/engine/src/agents/doc-author.ts, packages/engine/src/agents/review-fixer-issue-references.ts, packages/engine/src/agents/review-fixer.ts, packages/engine/src/artifacts/index.ts, packages/engine/src/evaluation/index.ts, packages/engine/src/extensions/index.ts, packages/engine/src/index.ts, packages/engine/src/pipeline/index.ts, packages/engine/src/pipeline/review-cycle-feedback.ts, packages/engine/src/pipeline/stages/planning-quality-review-cycle.ts, packages/engine/src/prompts/review-fixer.md, packages/engine/src/review-cycle-perspectives.ts, packages/engine/src/stacking/index.ts, packages/monitor/src/__tests__/accept-success-projection-parity.test.ts, packages/monitor/src/__tests__/agent-task-events.test.ts, packages/monitor/src/__tests__/auto-build-route.test.ts, packages/monitor/src/__tests__/auto-build-supervisor.test.ts, packages/monitor/src/__tests__/context.test.ts, packages/monitor/src/__tests__/daemon-event-reactions.test.ts, packages/monitor/src/__tests__/daemon-sse-handshake.test.ts, packages/monitor/src/__tests__/daily-spend-db.test.ts, packages/monitor/src/index.ts, packages/monitor/src/routes/extensions/index.ts, packages/monitor/src/routes/index.ts, packages/monitor/src/server.ts, test/agent-wiring-parallel-review.test.ts, test/plan-review-fix-application.test.ts, test/planning-quality-review-cycle.test.ts, test/recovery-review-failure-details.test.ts, test/review-context-filtering.test.ts, test/review-cycle-adaptive.test.ts, test/review-cycle-perspectives.test.ts, test/review-cycle-round-metadata.test.ts, test/review-fixer-continuation.test.ts
Validation: Author tests for projection preservation, Console-visible recovery state, cross-plan blocker refusal, upstream/base-owned blocker refusal, and terminal-state preservation. Run pnpm type-check and focused projection/UI/Vitest suites.

## Integration contracts

- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (interface test): Shared interface test is referenced by atoms atom-rescope-attempt, atom-rescope-console, atom-rescope-cross-plan, atom-rescope-cross-plan-002, atom-rescope-general, atom-rescope-human-review, atom-rescope-rejected. Primary atom atom-rescope-console owns reusable interface findings for consumers atom-rescope-attempt, atom-rescope-cross-plan, atom-rescope-cross-plan-002, atom-rescope-general, atom-rescope-human-review, atom-rescope-rejected.
- mod-recovery-visibility-refusal-regressions -> mod-same-plan-recovery-core (plan dependency): mod-recovery-visibility-refusal-regressions builds on Same-plan recovery core
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file .github/workflows/ci.yml): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file .github/workflows/publish.yml): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file CONTRIBUTING.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file docs/config-migration.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file docs/releasing.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/config.yaml): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/kanban.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/client/src/__tests__/events-schemas-review-cycle.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/active-builds.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/active-session-streams.test.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/activity-base-sync-selectors.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/activity-selectors.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/app.test.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/build-history-accepted-success.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/compile-resilience-format.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/console-shell.test.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/__tests__/use-run-detail.test.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/engine/src/agents/review-fixer-issue-references.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/engine/src/agents/review-fixer.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/engine/src/pipeline/review-cycle-feedback.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/engine/src/pipeline/stages/planning-quality-review-cycle.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/engine/src/prompts/review-fixer.md): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file packages/engine/src/review-cycle-perspectives.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/agent-wiring-parallel-review.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/plan-review-fix-application.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/planning-quality-review-cycle.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/recovery-review-failure-details.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/review-context-filtering.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/review-cycle-adaptive.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/review-cycle-perspectives.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/review-cycle-round-metadata.test.ts): shared-evidence-primary-owner
- mod-same-plan-recovery-core -> mod-recovery-visibility-refusal-regressions (shared file test/review-fixer-continuation.test.ts): shared-evidence-primary-owner

## Shared file ownership

- .claude/skills/eforge-daemon-restart/SKILL.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- .claude/skills/eforge-release/SKILL.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- .claude/skills/eval-analysis/SKILL.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- .github/workflows/ci.yml: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- .github/workflows/publish.yml: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/event-tail.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- .pi/extensions/eforge-dev/index.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- .pi/extensions/eforge-dev/README.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- CHANGELOG.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- CONTRIBUTING.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- docs/architecture.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- docs/config-migration.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- docs/config.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- docs/extensions-api.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- docs/extensions.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- docs/hooks.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- docs/images/console-recovery-build.png: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- docs/releasing.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- docs/roadmap.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- docs/stacking.md: owner mod-same-plan-recovery-core (shared-evidence-primary-owner)
- docs/webux-workspaces.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge-plugin/skills/config/config.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/skills/init/init.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge-plugin/skills/profile-new/profile-new.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/skills/profile/profile.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/skills/recover/recover.md: owner mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge-plugin/skills/restart/restart.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/skills/stack/stack.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/skills/status/status.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge-plugin/skills/update/update.md: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/config.yaml: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/kanban.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts: owner mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.test.tsx: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx: owner mod-same-plan-recovery-core (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- eforge/extensions/eforge-playbooks/run-playbook-action.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- eforge/prds/console-efficiency-telemetry-and-analytics.md: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- eforge/prds/implement-iframe-bundled-console-workstation-sdk.md: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-review-cycle.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/client/src/__tests__/terminal-failure-event.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/client/src/api/extension-contribution-failure-envelope.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/client/src/api/recovery-sidecar.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/client/src/events/constants.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/decisions.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/envelope.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/parse.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/queue-events.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/root.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/shared/agent-fields.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/shared/compile-resilience.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/shared/extension-actions.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/shared/planning-decomposition.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/shared/recovery-auto-resume.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/events/shared/schemas.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/client/src/run-status.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/.gitignore: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/.storybook/main.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/.storybook/preview.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/components.json: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/index.html: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/package.json: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/postcss.config.js: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/public/eforge-logo.svg: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/__tests__/active-builds.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/active-session-streams.test.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/activity-base-sync-selectors.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/activity-selectors.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/app.test.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/build-history-accepted-success.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/compile-resilience-format.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/console-shell.test.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/header.test.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/__tests__/now-dashboard.test.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/console-ui/src/__tests__/system-view.test.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/__tests__/use-run-detail.test.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/app.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/components/common/failure-banner.tsx: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/console-ui/src/components/header/control-surface-links.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/hooks/use-run-detail.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/lib/auto-start.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/console-ui/src/lib/selectors/queue-dispatch-failure.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/console-ui/src/main.tsx: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/eforge/src/cli/run-or-delegate.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/agent-runtime-registry.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/agents/acceptance-unknown-resolver.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/agents/builder.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/agents/common.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/agents/dependency-detector.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/agents/doc-author.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/agents/review-fixer-issue-references.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/engine/src/agents/review-fixer.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/engine/src/artifacts/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/compile-resilience/preflight.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/evaluation/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/extensions/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/orchestrator/validation-dirty-worktree.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/pipeline/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/pipeline/review-cycle-feedback.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/engine/src/pipeline/stages/planning-quality-review-cycle.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/engine/src/prompts/review-fixer.md: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/engine/src/queue/recovery-preflight.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/applied-sidecar.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/failed-resume-sidecar-finalization.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/failure-summary.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/resume-sidecar.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/sidecar-markdown.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/sidecar-payload.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/sidecar-read.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/sidecar.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/recovery/terminal-failure-history.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/review-cycle-perspectives.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- packages/engine/src/stacking/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/engine/src/terminal-failure.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/worktree-manager.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/src/worktree-ops.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/engine/test/events.agent-start.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/monitor/src/__tests__/accept-success-projection-parity.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/agent-task-events.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/auto-build-route.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/auto-build-supervisor.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/context.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/daemon-event-reactions.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/daemon-sse-handshake.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/daily-spend-db.test.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/__tests__/queue-dispatch-failure-projection.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/monitor/src/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/routes/extensions/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/routes/index.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- packages/monitor/src/routes/recovery-sidecar-service.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- packages/monitor/src/server.ts: owner mod-recovery-visibility-refusal-regressions (single-atom-evidence)
- start/attempt/result/skip-or-exhausted: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/agent-start-toolbelt-fields.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/agent-wiring-parallel-review.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/auto-build-pause-on-failure.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/auto-build-resume-after-failure.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/client-no-start-api-helpers.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/compile-preflight-boundaries.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/compile-preflight-engine.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/compile-preflight.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/pi-ambient-status-no-start.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/pi-harness-result-extraction.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/pi-no-start-policy.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/plan-review-fix-application.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/planning-quality-review-cycle.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/recovery-compile-scope-sidecar-rendering.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/recovery-decomposition-sidecar-rendering.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/recovery-failure-summary.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/recovery-review-failure-details.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/recovery-sidecar-analyst-network-fallback.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/review-context-filtering.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/review-cycle-adaptive.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/review-cycle-perspectives.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/review-cycle-round-metadata.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/review-fixer-continuation.test.ts: owner mod-recovery-visibility-refusal-regressions; consumers mod-same-plan-recovery-core (shared-evidence-primary-owner)
- test/stack-runtime-landing-metadata-preflight.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/worktree-integration.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/worktree-manager.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)
- test/worktree-reconciliation.test.ts: owner mod-same-plan-recovery-core (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "mod-same-plan-recovery-core",
      "title": "Same-plan recovery core",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-003",
        "ac-004",
        "ac-005",
        "ac-006"
      ],
      "aspectIds": [
        "ac-001:interface:test",
        "ac-001:subsystem:human-review",
        "ac-001:subsystem:manual",
        "ac-001:subsystem:review",
        "ac-001:subsystem:test",
        "ac-002:evidence:start-attempt-result-skip-or-exhausted",
        "ac-003:general:general",
        "ac-004:subsystem:rejected",
        "ac-004:subsystem:unresolved",
        "ac-005:general:general",
        "ac-006:subsystem:cross-plan",
        "ac-006:subsystem:failure",
        "ac-006:subsystem:preflight",
        "ac-006:subsystem:sidecar",
        "ac-006:subsystem:upstream",
        "ac-006:subsystem:worktree"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "mod-recovery-visibility-refusal-regressions",
      "title": "Recovery visibility/refusal regressions",
      "residue": false,
      "criterionIds": [
        "ac-007",
        "ac-008"
      ],
      "aspectIds": [
        "ac-007:interface:test",
        "ac-007:subsystem:console",
        "ac-007:subsystem:review",
        "ac-007:subsystem:run",
        "ac-007:subsystem:test",
        "ac-008:interface:test",
        "ac-008:subsystem:cross-plan",
        "ac-008:subsystem:test",
        "ac-008:subsystem:upstream"
      ],
      "dependsOnPlanIds": [
        "mod-same-plan-recovery-core"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/images/console-recovery-build.png",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/stacking.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/restart/restart.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/status/status.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/update/update.md",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.test.tsx",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/run-playbook-action.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/console-efficiency-telemetry-and-analytics.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/implement-iframe-bundled-console-workstation-sdk.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-review-cycle.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/terminal-failure-event.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-failure-envelope.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/recovery-sidecar.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/constants.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/decisions.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/envelope.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/parse.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/queue-events.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/root.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/agent-fields.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/compile-resilience.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/extension-actions.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/planning-decomposition.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/recovery-auto-resume.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/schemas.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/run-status.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/.gitignore",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/.storybook/main.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/.storybook/preview.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/components.json",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/index.html",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/package.json",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/postcss.config.js",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/public/eforge-logo.svg",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-builds.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/activity-base-sync-selectors.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/activity-selectors.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/app.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/compile-resilience-format.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/console-shell.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/header.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-dashboard.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/system-view.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/app.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/common/failure-banner.tsx",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/header/control-surface-links.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/hooks/use-run-detail.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/auto-start.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/selectors/queue-dispatch-failure.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/main.tsx",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/eforge/src/cli/run-or-delegate.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agent-runtime-registry.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/acceptance-unknown-resolver.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/builder.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/common.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/dependency-detector.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/doc-author.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/review-fixer-issue-references.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/agents/review-fixer.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/artifacts/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/compile-resilience/preflight.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/evaluation/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/orchestrator/validation-dirty-worktree.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/pipeline/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/pipeline/review-cycle-feedback.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/pipeline/stages/planning-quality-review-cycle.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/prompts/review-fixer.md",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/queue/recovery-preflight.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/applied-sidecar.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/failed-resume-sidecar-finalization.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/failure-summary.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/resume-sidecar.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/sidecar-markdown.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/sidecar-payload.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/sidecar-read.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/sidecar.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/terminal-failure-history.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/review-cycle-perspectives.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/stacking/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/terminal-failure.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/worktree-manager.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/worktree-ops.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/test/events.agent-start.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/accept-success-projection-parity.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/agent-task-events.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-supervisor.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/context.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daemon-event-reactions.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daemon-sse-handshake.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/daily-spend-db.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/queue-dispatch-failure-projection.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/extensions/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/index.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/recovery-sidecar-service.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/server.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "start/attempt/result/skip-or-exhausted",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/agent-start-toolbelt-fields.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/agent-wiring-parallel-review.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/auto-build-pause-on-failure.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/auto-build-resume-after-failure.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/client-no-start-api-helpers.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/compile-preflight-boundaries.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/compile-preflight-engine.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/compile-preflight.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/pi-ambient-status-no-start.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/pi-harness-result-extraction.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/pi-no-start-policy.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/plan-review-fix-application.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/planning-quality-review-cycle.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/recovery-compile-scope-sidecar-rendering.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/recovery-decomposition-sidecar-rendering.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/recovery-failure-summary.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/recovery-review-failure-details.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/recovery-sidecar-analyst-network-fallback.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/review-context-filtering.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/review-cycle-adaptive.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/review-cycle-perspectives.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/review-cycle-round-metadata.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/review-fixer-continuation.test.ts",
      "ownerPlanIds": [
        "mod-recovery-visibility-refusal-regressions"
      ],
      "consumerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/stack-runtime-landing-metadata-preflight.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-integration.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-manager.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-reconciliation.test.ts",
      "ownerPlanIds": [
        "mod-same-plan-recovery-core"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test",
      "kind": "interface",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-attempt, atom-rescope-console, atom-rescope-cross-plan, atom-rescope-cross-plan-002, atom-rescope-general, atom-rescope-human-review, atom-rescope-rejected. Primary atom atom-rescope-console owns reusable interface findings for consumers atom-rescope-attempt, atom-rescope-cross-plan, atom-rescope-cross-plan-002, atom-rescope-general, atom-rescope-human-review, atom-rescope-rejected."
    },
    {
      "contractId": "plan-dependency:mod-recovery-visibility-refusal-regressions->mod-same-plan-recovery-core:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-recovery-visibility-refusal-regressions",
      "toPlanId": "mod-same-plan-recovery-core",
      "summary": "mod-recovery-visibility-refusal-regressions builds on Same-plan recovery core"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:.github/workflows/ci.yml",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": ".github/workflows/ci.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:.github/workflows/publish.yml",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": ".github/workflows/publish.yml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:CONTRIBUTING.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "CONTRIBUTING.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-playbooks/__tests__/console-contribution.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/client/src/__tests__/events-schemas-review-cycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/client/src/__tests__/events-schemas-review-cycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/active-builds.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/active-builds.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/activity-base-sync-selectors.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/activity-base-sync-selectors.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/activity-selectors.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/activity-selectors.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/app.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/app.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/build-history-accepted-success.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/compile-resilience-format.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/compile-resilience-format.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/console-shell.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/console-shell.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/engine/src/agents/review-fixer-issue-references.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/engine/src/agents/review-fixer-issue-references.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/engine/src/agents/review-fixer.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/engine/src/agents/review-fixer.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/engine/src/pipeline/review-cycle-feedback.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/engine/src/pipeline/review-cycle-feedback.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/engine/src/pipeline/stages/planning-quality-review-cycle.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/engine/src/pipeline/stages/planning-quality-review-cycle.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/engine/src/prompts/review-fixer.md",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/engine/src/prompts/review-fixer.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:packages/engine/src/review-cycle-perspectives.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "packages/engine/src/review-cycle-perspectives.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/agent-wiring-parallel-review.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/agent-wiring-parallel-review.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/plan-review-fix-application.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/plan-review-fix-application.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/planning-quality-review-cycle.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/planning-quality-review-cycle.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/recovery-review-failure-details.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/recovery-review-failure-details.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/review-context-filtering.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/review-context-filtering.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/review-cycle-adaptive.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/review-cycle-adaptive.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/review-cycle-perspectives.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/review-cycle-perspectives.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/review-cycle-round-metadata.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/review-cycle-round-metadata.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-same-plan-recovery-core->mod-recovery-visibility-refusal-regressions:test/review-fixer-continuation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-same-plan-recovery-core",
      "toPlanId": "mod-recovery-visibility-refusal-regressions",
      "path": "test/review-fixer-continuation.test.ts",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```