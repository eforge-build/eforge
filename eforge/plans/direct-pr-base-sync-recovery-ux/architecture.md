# Planner Compiler Architecture

## Summary

Merged child digests into 5 buildable module candidates covering ac-001 through ac-010. Config work and AC-010 clamping tests are consolidated; event schema, CLI rendering, and import-discipline work are consolidated; AC-008 keeps selector-derived labels feeding lane rendering. No conflicts or representation-required gaps. Implementation notes retained: confirm existing config key style and derive clamp bounds from existing owners rather than inventing new limits.

## Compiler status

Compiler status: complete
Source hash: e7ec101a2a1d73b8cb4e6ef7994342fffa40265c0d0c1cab0e988dfc936ecbf8

## Plan boundaries

### direct-base-sync-budget-config — Direct base-sync budget configuration

Criteria: ac-001, ac-003, ac-006, ac-010
Aspects: ac-001:interface:config, ac-001:interface:configuration, ac-001:subsystem:config, ac-003:interface:config, ac-003:interface:configuration, ac-003:subsystem:config, ac-006:interface:config, ac-006:interface:configuration, ac-006:subsystem:config, ac-010:evidence:override-default-clamping, ac-010:interface:command-surface, ac-010:interface:config, ac-010:interface:configuration, ac-010:interface:test
Depends on: (none)
Residue: no
Owned files: docs/architecture.md, docs/config.md, docs/extensions.md, eforge-plugin/.mcp.json, eforge-plugin/skills/stack/stack.md, eforge/config.yaml, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts, eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts, eforge/extensions/eforge-plan/tsup.config.ts, eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js, eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts, eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts, eforge/extensions/eforge-playbooks/tsup.config.ts, override/default/clamping, packages/client/src/api/config.ts, packages/client/tsup.config.ts, packages/console-ui/postcss.config.js, packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts, packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx, packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx, packages/console-ui/src/lib/run-state/handlers/handle-agent.ts, packages/eforge/src/cli/display.ts, packages/engine/src/config.ts, packages/engine/test/config.legacy-rejection.test.ts, packages/engine/test/plan-file.agent-config.test.ts, packages/monitor/src/__tests__/projections-config-redaction.test.ts, packages/monitor/src/__tests__/routes-config-context.test.ts, packages/monitor/src/__tests__/routes-config-profile-stack.test.ts, packages/pi-eforge/extensions/eforge/config-command.ts, test/agent-config.mixed-harness.test.ts, test/cli-landing-options.test.ts, test/fixtures/todo-api-repo/eforge/config.yaml, test/fixtures/todo-api-repo/vitest.config.ts, test/onsuccess-override-precedence.test.ts, test/per-build-profile-override.test.ts
Validation: Author tests for defaults, explicit overrides, precedence, boundary clamps, and resolved count behavior; update existing docs that describe the changed config behavior.

### direct-base-sync-budget-flow — Direct base-sync fixed budget flow

Criteria: ac-002, ac-004
Aspects: ac-002:general:general, ac-004:general:general
Depends on: direct-base-sync-budget-config
Residue: no
Owned files: (none)
Validation: Author flow tests proving direct PR base sync uses the resolved budget from config and does not auto-scale under load or progress changes.

### base-sync-events-contract-cli — Base-sync event contract, CLI rendering, and import discipline

Criteria: ac-005, ac-007, ac-009
Aspects: ac-005:general:general, ac-007:interface:command-surface, ac-009:interface:schema, ac-009:interface:schema-contract, ac-009:subsystem:client, ac-009:subsystem:eforge-build, ac-009:subsystem:import, ac-009:subsystem:schema, ac-009:subsystem:use
Depends on: direct-base-sync-budget-flow
Residue: no
Owned files: .claude/skills/eforge-daemon-restart/SKILL.md, .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eforge-release/SKILL.md, .pi/extensions/eforge-dev/event-tail.ts, .pi/extensions/eforge-dev/index.ts, .pi/extensions/eforge-dev/README.md, AGENTS.md, CHANGELOG.md, docs/config-migration.md, docs/extensions-api.md, docs/hooks.md, docs/llm-friendly-code.md, docs/releasing.md, docs/roadmap.md, docs/stacking.md, docs/webux-workspaces.md, eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/init/init.md, eforge-plugin/skills/profile-new/profile-new.md, eforge-plugin/skills/profile/profile.md, eforge-plugin/skills/restart/restart.md, eforge/dependency-update-evidence.md, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-guardrails/maintainability-parser.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts, eforge/extensions/eforge-plan/__tests__/package-publication.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts, eforge/extensions/eforge-plan/backlog-curation-item-audit-cache.ts, eforge/extensions/eforge-plan/backlog-curation-packets.ts, eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts, eforge/extensions/eforge-plan/backlog-curation-schemas.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.test.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-escape-to-close.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.test.tsx, eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts, packages/client/package.json, packages/client/README.md, packages/client/src/__tests__/aggregate-session-summary.test.ts, packages/client/src/__tests__/client-contract-public-exports.test.ts, packages/client/src/__tests__/compile-resilience-contracts.test.ts, packages/client/src/__tests__/efficiency-metrics.test.ts, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/events-schemas-auto-build.test.ts, packages/client/src/__tests__/events-schemas-build-evaluator.test.ts, packages/client/src/__tests__/events-schemas-extension-actions.test.ts, packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts, packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/events/variants/build.ts, packages/client/src/schema-utils.ts, packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx, packages/console-ui/src/__tests__/use-run-detail.test.tsx, packages/console-ui/src/components/graph/use-graph-layout.ts, packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts, packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx, packages/console-ui/src/lib/run-state/lane-registry.ts, packages/engine/src/direct-pr-base-sync.ts, packages/engine/src/orchestrator/phases.ts, packages/engine/src/recovery/accept-success-landing.ts, packages/extension-sdk/src/schema.ts, packages/input/src/session-plan-set/schema.ts, README.md, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/profile-list-client-contract.test.ts, test/recovery-verdict-schema.test.ts, test/zod-import-allowlist.test.ts
Validation: Author schema/runtime parse tests, event emission tests, CLI rendering tests, and import-discipline checks that prevent event wire-shape redeclarations.

### console-direct-base-sync-selectors — Console selector labels for direct base-sync recovery

Criteria: ac-008
Aspects: ac-008:subsystem:selectors
Depends on: base-sync-events-contract-cli
Residue: no
Owned files: eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/kanban.test.ts, eforge/extensions/eforge-plan/__tests__/registration.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts, packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts, packages/console-ui/src/__tests__/activity-selectors.test.ts, packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts, packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts, packages/console-ui/src/__tests__/metrics-selectors.test.ts, packages/console-ui/src/__tests__/now-accepted-success-selectors.test.ts, packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts, packages/console-ui/src/__tests__/now-failed-enqueue-selectors.test.ts, packages/console-ui/src/__tests__/now-planning-row-selectors.test.ts, packages/console-ui/src/__tests__/now-selectors.test.ts, packages/console-ui/src/__tests__/runs-selectors.test.ts, packages/console-ui/src/__tests__/spend-selectors.test.ts, packages/console-ui/src/components/pipeline/__tests__/pack-lanes.test.ts, packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-lanes.test.tsx, packages/console-ui/src/components/pipeline/pack-lanes.ts, packages/console-ui/src/lib/run-state/selectors/plan-progress.ts
Validation: Author selector tests covering direct base-sync, merge-resolver association, and feature-branch planId display; keep existing selector tests green.

### console-direct-base-sync-lanes — Pipeline lane labels for base-sync and merge-resolver activity

Criteria: ac-008
Aspects: ac-008:subsystem:lanes
Depends on: console-direct-base-sync-selectors
Residue: no
Owned files: eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts, eforge/extensions/eforge-plan/__tests__/kanban.test.ts, eforge/extensions/eforge-plan/__tests__/registration.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts, packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts, packages/console-ui/src/__tests__/activity-selectors.test.ts, packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts, packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts, packages/console-ui/src/__tests__/metrics-selectors.test.ts, packages/console-ui/src/__tests__/now-accepted-success-selectors.test.ts, packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts, packages/console-ui/src/__tests__/now-failed-enqueue-selectors.test.ts, packages/console-ui/src/__tests__/now-planning-row-selectors.test.ts, packages/console-ui/src/__tests__/now-selectors.test.ts, packages/console-ui/src/__tests__/runs-selectors.test.ts, packages/console-ui/src/__tests__/spend-selectors.test.ts, packages/console-ui/src/components/pipeline/__tests__/pack-lanes.test.ts, packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-lanes.test.tsx, packages/console-ui/src/components/pipeline/pack-lanes.ts, packages/console-ui/src/lib/run-state/selectors/plan-progress.ts
Validation: Author or extend lane rendering tests for direct base-sync, merge-resolver association, and feature-branch planId labels; existing pack-lanes tests should remain unchanged and green.

## Integration contracts

- console-direct-base-sync-lanes -> base-sync-events-contract-cli (interface command-surface): Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (interface config): Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (interface schema): Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (interface test): Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (interface command-surface): Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (interface config): Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (interface schema): Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (interface test): Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-config -> base-sync-events-contract-cli (interface command-surface): Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-config -> base-sync-events-contract-cli (interface config): Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-config -> base-sync-events-contract-cli (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-config -> base-sync-events-contract-cli (interface schema): Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-config -> base-sync-events-contract-cli (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-config -> base-sync-events-contract-cli (interface test): Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (interface command-surface): Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (interface config): Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (interface configuration): Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (interface schema): Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (interface test): Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes.
- base-sync-events-contract-cli -> direct-base-sync-budget-flow (plan dependency): base-sync-events-contract-cli builds on Direct base-sync fixed budget flow
- console-direct-base-sync-lanes -> console-direct-base-sync-selectors (plan dependency): console-direct-base-sync-lanes builds on Console selector labels for direct base-sync recovery
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (plan dependency): console-direct-base-sync-selectors builds on Base-sync event contract, CLI rendering, and import discipline
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (plan dependency): direct-base-sync-budget-flow builds on Direct base-sync budget configuration
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file docs/architecture.md): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file docs/config.md): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file docs/extensions.md): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file eforge-plugin/.mcp.json): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file eforge-plugin/skills/stack/stack.md): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file eforge/config.yaml): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/console-ui/src/lib/run-state/handlers/handle-agent.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/eforge/src/cli/display.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/engine/test/config.legacy-rejection.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/engine/test/plan-file.agent-config.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/monitor/src/__tests__/projections-config-redaction.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/monitor/src/__tests__/routes-config-context.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/monitor/src/__tests__/routes-config-profile-stack.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file packages/pi-eforge/extensions/eforge/config-command.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file test/cli-landing-options.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file test/fixtures/todo-api-repo/eforge/config.yaml): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file test/fixtures/todo-api-repo/vitest.config.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file test/onsuccess-override-precedence.test.ts): shared-evidence-primary-owner
- base-sync-events-contract-cli -> direct-base-sync-budget-config (shared file test/per-build-profile-override.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file AGENTS.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file CHANGELOG.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/config-migration.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/extensions-api.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/hooks.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/releasing.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/roadmap.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/stacking.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge-plugin/skills/restart/restart.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/dependency-update-evidence.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/backlog-curation-schemas.ts): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> base-sync-events-contract-cli (shared file README.md): shared-evidence-primary-owner
- console-direct-base-sync-lanes -> direct-base-sync-budget-config (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file AGENTS.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file CHANGELOG.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/config-migration.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/extensions-api.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/hooks.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/releasing.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/roadmap.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/stacking.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge-plugin/skills/restart/restart.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/dependency-update-evidence.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/backlog-curation-schemas.ts): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> base-sync-events-contract-cli (shared file README.md): shared-evidence-primary-owner
- console-direct-base-sync-selectors -> direct-base-sync-budget-config (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/event-tail.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file AGENTS.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file CHANGELOG.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/config-migration.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/extensions-api.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/hooks.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/releasing.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/roadmap.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/stacking.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge-plugin/skills/restart/restart.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/dependency-update-evidence.md): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/backlog-curation-schemas.ts): shared-evidence-primary-owner
- direct-base-sync-budget-config -> base-sync-events-contract-cli (shared file README.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file .claude/skills/eforge-release/SKILL.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/index.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file AGENTS.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file CHANGELOG.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/config-migration.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/extensions-api.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/hooks.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/releasing.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/roadmap.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/stacking.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file docs/webux-workspaces.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge-plugin/skills/config/config.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge-plugin/skills/init/init.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge-plugin/skills/profile-new/profile-new.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge-plugin/skills/restart/restart.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/dependency-update-evidence.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/package-publication.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file eforge/extensions/eforge-plan/backlog-curation-schemas.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> base-sync-events-contract-cli (shared file README.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file docs/architecture.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file docs/config.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file docs/extensions.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file eforge-plugin/.mcp.json): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file eforge-plugin/skills/stack/stack.md): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file eforge/config.yaml): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/console-ui/src/lib/run-state/handlers/handle-agent.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/eforge/src/cli/display.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/engine/test/config.legacy-rejection.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/engine/test/plan-file.agent-config.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/monitor/src/__tests__/projections-config-redaction.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/monitor/src/__tests__/routes-config-context.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/monitor/src/__tests__/routes-config-profile-stack.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file packages/pi-eforge/extensions/eforge/config-command.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file test/agent-config.mixed-harness.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file test/cli-landing-options.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file test/fixtures/todo-api-repo/eforge/config.yaml): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file test/fixtures/todo-api-repo/vitest.config.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file test/onsuccess-override-precedence.test.ts): shared-evidence-primary-owner
- direct-base-sync-budget-flow -> direct-base-sync-budget-config (shared file test/per-build-profile-override.test.ts): shared-evidence-primary-owner

## Shared file ownership

- .claude/skills/eforge-daemon-restart/SKILL.md: owner base-sync-events-contract-cli (single-atom-evidence)
- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- .claude/skills/eforge-release/SKILL.md: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/event-tail.ts: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/index.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- .pi/extensions/eforge-dev/README.md: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- AGENTS.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- CHANGELOG.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/architecture.md: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/config-migration.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/config.md: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/extensions-api.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/extensions.md: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/hooks.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/llm-friendly-code.md: owner base-sync-events-contract-cli (single-atom-evidence)
- docs/releasing.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/roadmap.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/stacking.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- docs/webux-workspaces.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/.claude-plugin/plugin.json: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge-plugin/.mcp.json: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/skills/config/config.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/skills/extend/extend.md: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge-plugin/skills/init/init.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/skills/profile-new/profile-new.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/skills/profile/profile.md: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge-plugin/skills/restart/restart.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge-plugin/skills/stack/stack.md: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/config.yaml: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/dependency-update-evidence.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/maintainability-parser.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner direct-base-sync-budget-config; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner base-sync-events-contract-cli; consumers direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/kanban.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/package-publication.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts: owner direct-base-sync-budget-config (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/registration.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-item-audit-cache.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-packets.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-schemas.ts: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/schema.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/sqlite/schema.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/tsup.config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-escape-to-close.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.test.tsx: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- eforge/extensions/eforge-playbooks/tsup.config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- override/default/clamping: owner direct-base-sync-budget-config (single-atom-evidence)
- packages/client/package.json: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/README.md: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/aggregate-session-summary.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/client-contract-public-exports.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/compile-resilience-contracts.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/efficiency-metrics.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/events-schema-shape.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/events-schema-test-helpers.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-auto-build.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-build-evaluator.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-extension-actions.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/__tests__/schema-utils.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/api/config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- packages/client/src/events/variants/build.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/src/schema-utils.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/client/tsup.config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- packages/console-ui/postcss.config.js: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/activity-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/metrics-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/now-accepted-success-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/now-failed-enqueue-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/now-planning-row-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/now-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/runs-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/spend-selectors.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/__tests__/use-run-detail.test.tsx: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/console-ui/src/components/graph/use-graph-layout.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/components/pipeline/__tests__/pack-lanes.test.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-lanes.test.tsx: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/components/pipeline/pack-lanes.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/handlers/handle-agent.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/console-ui/src/lib/run-state/lane-registry.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/console-ui/src/lib/run-state/selectors/plan-progress.ts: owner console-direct-base-sync-lanes, console-direct-base-sync-selectors (single-atom-evidence)
- packages/eforge/src/cli/display.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/engine/src/config.ts: owner direct-base-sync-budget-config (shared-evidence-primary-owner)
- packages/engine/src/direct-pr-base-sync.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/engine/src/orchestrator/phases.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/engine/src/recovery/accept-success-landing.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/engine/test/config.legacy-rejection.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/engine/test/plan-file.agent-config.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/extension-sdk/src/schema.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/input/src/session-plan-set/schema.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- packages/monitor/src/__tests__/projections-config-redaction.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/routes-config-context.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/monitor/src/__tests__/routes-config-profile-stack.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- packages/pi-eforge/extensions/eforge/config-command.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- README.md: owner base-sync-events-contract-cli; consumers console-direct-base-sync-lanes, console-direct-base-sync-selectors, direct-base-sync-budget-config, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/agent-config.mixed-harness.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/cli-landing-options.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/config-schema.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- test/config.agent-runtimes.schema.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- test/fixtures/todo-api-repo/eforge/config.yaml: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/fixtures/todo-api-repo/vitest.config.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/onsuccess-override-precedence.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/per-build-profile-override.test.ts: owner direct-base-sync-budget-config; consumers base-sync-events-contract-cli, direct-base-sync-budget-flow (shared-evidence-primary-owner)
- test/profile-list-client-contract.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- test/recovery-verdict-schema.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)
- test/zod-import-allowlist.test.ts: owner base-sync-events-contract-cli (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "direct-base-sync-budget-config",
      "title": "Direct base-sync budget configuration",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-003",
        "ac-006",
        "ac-010"
      ],
      "aspectIds": [
        "ac-001:interface:config",
        "ac-001:interface:configuration",
        "ac-001:subsystem:config",
        "ac-003:interface:config",
        "ac-003:interface:configuration",
        "ac-003:subsystem:config",
        "ac-006:interface:config",
        "ac-006:interface:configuration",
        "ac-006:subsystem:config",
        "ac-010:evidence:override-default-clamping",
        "ac-010:interface:command-surface",
        "ac-010:interface:config",
        "ac-010:interface:configuration",
        "ac-010:interface:test"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "direct-base-sync-budget-flow",
      "title": "Direct base-sync fixed budget flow",
      "residue": false,
      "criterionIds": [
        "ac-002",
        "ac-004"
      ],
      "aspectIds": [
        "ac-002:general:general",
        "ac-004:general:general"
      ],
      "dependsOnPlanIds": [
        "direct-base-sync-budget-config"
      ]
    },
    {
      "planId": "base-sync-events-contract-cli",
      "title": "Base-sync event contract, CLI rendering, and import discipline",
      "residue": false,
      "criterionIds": [
        "ac-005",
        "ac-007",
        "ac-009"
      ],
      "aspectIds": [
        "ac-005:general:general",
        "ac-007:interface:command-surface",
        "ac-009:interface:schema",
        "ac-009:interface:schema-contract",
        "ac-009:subsystem:client",
        "ac-009:subsystem:eforge-build",
        "ac-009:subsystem:import",
        "ac-009:subsystem:schema",
        "ac-009:subsystem:use"
      ],
      "dependsOnPlanIds": [
        "direct-base-sync-budget-flow"
      ]
    },
    {
      "planId": "console-direct-base-sync-selectors",
      "title": "Console selector labels for direct base-sync recovery",
      "residue": false,
      "criterionIds": [
        "ac-008"
      ],
      "aspectIds": [
        "ac-008:subsystem:selectors"
      ],
      "dependsOnPlanIds": [
        "base-sync-events-contract-cli"
      ]
    },
    {
      "planId": "console-direct-base-sync-lanes",
      "title": "Pipeline lane labels for base-sync and merge-resolver activity",
      "residue": false,
      "criterionIds": [
        "ac-008"
      ],
      "aspectIds": [
        "ac-008:subsystem:lanes"
      ],
      "dependsOnPlanIds": [
        "console-direct-base-sync-selectors"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/stacking.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/.mcp.json",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/restart/restart.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/dependency-update-evidence.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/maintainability-parser.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-item-audit-cache.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-packets.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/schema.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/schema.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/tsup.config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-escape-to-close.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.test.tsx",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/tsup.config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "override/default/clamping",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/package.json",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/README.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/aggregate-session-summary.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/client-contract-public-exports.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/compile-resilience-contracts.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/efficiency-metrics.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-shape.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-test-helpers.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-auto-build.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-build-evaluator.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-actions.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/schema-utils.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/events/variants/build.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/schema-utils.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/tsup.config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/postcss.config.js",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/activity-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/enqueue-cards-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/metrics-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-accepted-success-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-failed-enqueue-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-planning-row-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/runs-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/spend-selectors.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/components/graph/use-graph-layout.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/pack-lanes.test.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-lanes.test.tsx",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/pack-lanes.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-agent.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/lane-registry.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/selectors/plan-progress.ts",
      "ownerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/eforge/src/cli/display.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/src/direct-pr-base-sync.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/orchestrator/phases.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/accept-success-landing.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/extension-sdk/src/schema.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/input/src/session-plan-set/schema.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/pi-eforge/extensions/eforge/config-command.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "README.md",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [
        "console-direct-base-sync-lanes",
        "console-direct-base-sync-selectors",
        "direct-base-sync-budget-config",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/agent-config.mixed-harness.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/cli-landing-options.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/config-schema.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/config.agent-runtimes.schema.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/fixtures/todo-api-repo/eforge/config.yaml",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/fixtures/todo-api-repo/vitest.config.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/onsuccess-override-precedence.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/per-build-profile-override.test.ts",
      "ownerPlanIds": [
        "direct-base-sync-budget-config"
      ],
      "consumerPlanIds": [
        "base-sync-events-contract-cli",
        "direct-base-sync-budget-flow"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/profile-list-client-contract.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/recovery-verdict-schema.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/zod-import-allowlist.test.ts",
      "ownerPlanIds": [
        "base-sync-events-contract-cli"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:console-direct-base-sync-lanes->base-sync-events-contract-cli:command-surface",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "command-surface",
      "summary": "Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-lanes->base-sync-events-contract-cli:config",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-lanes->base-sync-events-contract-cli:configuration",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-lanes->base-sync-events-contract-cli:schema",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-lanes->base-sync-events-contract-cli:schema-contract",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-lanes->base-sync-events-contract-cli:test",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-selectors->base-sync-events-contract-cli:command-surface",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "command-surface",
      "summary": "Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-selectors->base-sync-events-contract-cli:config",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-selectors->base-sync-events-contract-cli:configuration",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-selectors->base-sync-events-contract-cli:schema",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-selectors->base-sync-events-contract-cli:schema-contract",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:console-direct-base-sync-selectors->base-sync-events-contract-cli:test",
      "kind": "interface",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-config->base-sync-events-contract-cli:command-surface",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "command-surface",
      "summary": "Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-config->base-sync-events-contract-cli:config",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-config->base-sync-events-contract-cli:configuration",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-config->base-sync-events-contract-cli:schema",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-config->base-sync-events-contract-cli:schema-contract",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-config->base-sync-events-contract-cli:test",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-flow->base-sync-events-contract-cli:command-surface",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "command-surface",
      "summary": "Shared interface command-surface is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-flow->base-sync-events-contract-cli:config",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "config",
      "summary": "Shared interface config is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-flow->base-sync-events-contract-cli:configuration",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "configuration",
      "summary": "Shared interface configuration is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-flow->base-sync-events-contract-cli:schema",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema",
      "summary": "Shared interface schema is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-flow->base-sync-events-contract-cli:schema-contract",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "interface:direct-base-sync-budget-flow->base-sync-events-contract-cli:test",
      "kind": "interface",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-clamping, atom-rescope-client, atom-rescope-config, atom-rescope-general, atom-rescope-lanes. Primary atom atom-rescope-client owns reusable interface findings for consumers atom-rescope-clamping, atom-rescope-config, atom-rescope-general, atom-rescope-lanes."
    },
    {
      "contractId": "plan-dependency:base-sync-events-contract-cli->direct-base-sync-budget-flow:",
      "kind": "plan-dependency",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-flow",
      "summary": "base-sync-events-contract-cli builds on Direct base-sync fixed budget flow"
    },
    {
      "contractId": "plan-dependency:console-direct-base-sync-lanes->console-direct-base-sync-selectors:",
      "kind": "plan-dependency",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "console-direct-base-sync-selectors",
      "summary": "console-direct-base-sync-lanes builds on Console selector labels for direct base-sync recovery"
    },
    {
      "contractId": "plan-dependency:console-direct-base-sync-selectors->base-sync-events-contract-cli:",
      "kind": "plan-dependency",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "summary": "console-direct-base-sync-selectors builds on Base-sync event contract, CLI rendering, and import discipline"
    },
    {
      "contractId": "plan-dependency:direct-base-sync-budget-flow->direct-base-sync-budget-config:",
      "kind": "plan-dependency",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "summary": "direct-base-sync-budget-flow builds on Direct base-sync budget configuration"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:docs/architecture.md",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "docs/architecture.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:docs/config.md",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "docs/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:eforge-plugin/.mcp.json",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge-plugin/.mcp.json",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:eforge-plugin/skills/stack/stack.md",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge-plugin/skills/stack/stack.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/console-ui/src/lib/run-state/handlers/handle-agent.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-agent.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/eforge/src/cli/display.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/eforge/src/cli/display.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/engine/test/config.legacy-rejection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/engine/test/plan-file.agent-config.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/monitor/src/__tests__/routes-config-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:packages/pi-eforge/extensions/eforge/config-command.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/pi-eforge/extensions/eforge/config-command.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:test/cli-landing-options.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/cli-landing-options.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:test/fixtures/todo-api-repo/eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/fixtures/todo-api-repo/eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:test/fixtures/todo-api-repo/vitest.config.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/fixtures/todo-api-repo/vitest.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:test/onsuccess-override-precedence.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/onsuccess-override-precedence.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:base-sync-events-contract-cli->direct-base-sync-budget-config:test/per-build-profile-override.test.ts",
      "kind": "shared-file",
      "fromPlanId": "base-sync-events-contract-cli",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/per-build-profile-override.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge-plugin/skills/restart/restart.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/restart/restart.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/dependency-update-evidence.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/dependency-update-evidence.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->base-sync-events-contract-cli:README.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-lanes->direct-base-sync-budget-config:eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-lanes",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge-plugin/skills/restart/restart.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/restart/restart.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/dependency-update-evidence.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/dependency-update-evidence.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->base-sync-events-contract-cli:README.md",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-direct-base-sync-selectors->direct-base-sync-budget-config:eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-direct-base-sync-selectors",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:.pi/extensions/eforge-dev/event-tail.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge-plugin/skills/restart/restart.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/restart/restart.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/dependency-update-evidence.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/dependency-update-evidence.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-config->base-sync-events-contract-cli:README.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-config",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:.claude/skills/eforge-release/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".claude/skills/eforge-release/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:.pi/extensions/eforge-dev/index.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/config-migration.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/config-migration.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/hooks.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/hooks.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/roadmap.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/roadmap.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/stacking.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/stacking.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:docs/webux-workspaces.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "docs/webux-workspaces.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge-plugin/skills/config/config.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/config/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge-plugin/skills/init/init.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/init/init.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge-plugin/skills/profile-new/profile-new.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge-plugin/skills/restart/restart.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge-plugin/skills/restart/restart.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/dependency-update-evidence.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/dependency-update-evidence.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/package-publication.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->base-sync-events-contract-cli:README.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "base-sync-events-contract-cli",
      "path": "README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:docs/architecture.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "docs/architecture.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:docs/config.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "docs/config.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:docs/extensions.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "docs/extensions.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:eforge-plugin/.mcp.json",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge-plugin/.mcp.json",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:eforge-plugin/skills/stack/stack.md",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge-plugin/skills/stack/stack.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/console-ui/src/lib/run-state/handlers/handle-agent.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/console-ui/src/lib/run-state/handlers/handle-agent.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/eforge/src/cli/display.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/eforge/src/cli/display.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/engine/test/config.legacy-rejection.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/engine/test/config.legacy-rejection.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/engine/test/plan-file.agent-config.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/engine/test/plan-file.agent-config.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/monitor/src/__tests__/projections-config-redaction.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/monitor/src/__tests__/routes-config-context.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/monitor/src/__tests__/routes-config-context.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/monitor/src/__tests__/routes-config-profile-stack.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:packages/pi-eforge/extensions/eforge/config-command.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "packages/pi-eforge/extensions/eforge/config-command.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:test/agent-config.mixed-harness.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/agent-config.mixed-harness.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:test/cli-landing-options.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/cli-landing-options.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:test/fixtures/todo-api-repo/eforge/config.yaml",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/fixtures/todo-api-repo/eforge/config.yaml",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:test/fixtures/todo-api-repo/vitest.config.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/fixtures/todo-api-repo/vitest.config.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:test/onsuccess-override-precedence.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/onsuccess-override-precedence.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:direct-base-sync-budget-flow->direct-base-sync-budget-config:test/per-build-profile-override.test.ts",
      "kind": "shared-file",
      "fromPlanId": "direct-base-sync-budget-flow",
      "toPlanId": "direct-base-sync-budget-config",
      "path": "test/per-build-profile-override.test.ts",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```