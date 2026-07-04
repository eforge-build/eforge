# Planner Compiler Architecture

## Summary

Deterministic single-atom passthrough of atom-root. Plan adaptive source-localization rescoping by adding structured exploration outcomes/diagnostics, deterministic degraded-scope splitting, adaptive rerun preservation, and focused tests. Path-only evidence identifies planner-compiler targets; unrelated materialized skill/backlog excerpts are not implementation targets.

## Compiler status

Compiler status: complete
Source hash: ad5d1d21b48c102550a006b9935560af750e64660d9b9bc800eb72f130526bb1

## Plan boundaries

### exploration-outcome-resilience — Structured exploration budget-exhaustion outcomes

Criteria: ac-001, ac-002, ac-003
Aspects: ac-001:interface:schema, ac-001:interface:schema-contract, ac-001:subsystem:schema, ac-002:general:general, ac-003:general:general
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/README.md, CHANGELOG.md, CONTRIBUTING.md, criteria/aspects, docs/architecture.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/releasing.md, docs/roadmap.md, docs/webux-workspaces.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/recover/recover.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/backlog-capture-guardrails.ts, eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, localization/exploration, localization/rescope, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/events/constants.ts, packages/client/src/events/decisions.ts, packages/client/src/events/envelope.ts, packages/client/src/events/parse.ts, packages/client/src/events/queue-events.ts, packages/client/src/events/root.ts, packages/client/src/events/shared/agent-fields.ts, packages/client/src/events/shared/compile-resilience.ts, packages/client/src/events/shared/extension-actions.ts, packages/client/src/events/shared/planning-decomposition.ts, packages/client/src/events/shared/schemas.ts, packages/client/src/events/shared/stack-wire.ts, packages/client/src/schema-utils.ts, packages/engine/src/compile-resilience/planning-decomposition-limits.ts, packages/engine/src/planner-compiler/atom-graph.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/src/planner-compiler/compiler-diagnostics.ts, packages/engine/src/planner-compiler/compiler-runner.ts, packages/engine/src/planner-compiler/exploration-agent.ts, packages/engine/src/planner-compiler/exploration-contracts.ts, packages/engine/src/planner-compiler/satisfaction-gate-agent.ts, packages/engine/src/planner-compiler/source-localization-contracts.ts, packages/engine/src/planner-compiler/source-localization-repair.ts, packages/engine/src/planner-compiler/source-localization.ts, packages/engine/src/validation/acceptance-criteria-inventory.ts, packages/engine/src/validation/acceptance-criteria.ts, packages/extension-sdk/src/schema.ts, packages/input/src/acceptance-criteria-quality.ts, packages/input/src/session-plan-set/schema.ts, test/acceptance-criteria-inventory.test.ts, test/acceptance-criteria-quality.test.ts, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/planning-exploration-agent.test.ts, test/planning-source-localization.test.ts, test/recovery-verdict-schema.test.ts
Validation: Schema validation accepts submitted and synthesized budget-exhausted outcomes; downstream compiler code receives structured outcomes in both cases; diagnostics expose unresolved needs, reasons, attempted query context, and tool-use count.

### deterministic-rescope-splitting — Deterministic degraded-scope atom splitting

Criteria: ac-004, ac-006, ac-009
Aspects: ac-004:evidence:criteria-aspects, ac-004:interface:schema-contract, ac-006:general:general, ac-009:general:general
Depends on: exploration-outcome-resilience
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/README.md, CHANGELOG.md, CONTRIBUTING.md, criteria/aspects, docs/architecture.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/releasing.md, docs/roadmap.md, docs/webux-workspaces.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/recover/recover.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/backlog-capture-guardrails.ts, eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, localization/exploration, localization/rescope, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/events/constants.ts, packages/client/src/events/decisions.ts, packages/client/src/events/envelope.ts, packages/client/src/events/parse.ts, packages/client/src/events/queue-events.ts, packages/client/src/events/root.ts, packages/client/src/events/shared/agent-fields.ts, packages/client/src/events/shared/compile-resilience.ts, packages/client/src/events/shared/extension-actions.ts, packages/client/src/events/shared/planning-decomposition.ts, packages/client/src/events/shared/schemas.ts, packages/client/src/events/shared/stack-wire.ts, packages/client/src/schema-utils.ts, packages/engine/src/compile-resilience/planning-decomposition-limits.ts, packages/engine/src/planner-compiler/atom-graph.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/src/planner-compiler/compiler-diagnostics.ts, packages/engine/src/planner-compiler/compiler-runner.ts, packages/engine/src/planner-compiler/exploration-agent.ts, packages/engine/src/planner-compiler/exploration-contracts.ts, packages/engine/src/planner-compiler/satisfaction-gate-agent.ts, packages/engine/src/planner-compiler/source-localization-contracts.ts, packages/engine/src/planner-compiler/source-localization-repair.ts, packages/engine/src/planner-compiler/source-localization.ts, packages/engine/src/validation/acceptance-criteria-inventory.ts, packages/engine/src/validation/acceptance-criteria.ts, packages/extension-sdk/src/schema.ts, packages/input/src/acceptance-criteria-quality.ts, packages/input/src/session-plan-set/schema.ts, test/acceptance-criteria-inventory.test.ts, test/acceptance-criteria-quality.test.ts, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/planning-exploration-agent.test.ts, test/planning-source-localization.test.ts, test/recovery-verdict-schema.test.ts
Validation: Repeated runs with the same degraded input produce identical split scopes; cross-cutting degraded atom-root does not proceed unsplit unless deterministic localization confidence is sufficient; exhausted rescoping returns fail-closed diagnostics.

### adaptive-rerun-preservation — Affected-scope localization reruns and preservation

Criteria: ac-005, ac-007, ac-008
Aspects: ac-005:evidence:localization-exploration, ac-007:general:general, ac-008:evidence:localization-rescope
Depends on: deterministic-rescope-splitting, exploration-outcome-resilience
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/README.md, CHANGELOG.md, CONTRIBUTING.md, criteria/aspects, docs/architecture.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/releasing.md, docs/roadmap.md, docs/webux-workspaces.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/recover/recover.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/backlog-capture-guardrails.ts, eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, localization/exploration, localization/rescope, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/events/constants.ts, packages/client/src/events/decisions.ts, packages/client/src/events/envelope.ts, packages/client/src/events/parse.ts, packages/client/src/events/queue-events.ts, packages/client/src/events/root.ts, packages/client/src/events/shared/agent-fields.ts, packages/client/src/events/shared/compile-resilience.ts, packages/client/src/events/shared/extension-actions.ts, packages/client/src/events/shared/planning-decomposition.ts, packages/client/src/events/shared/schemas.ts, packages/client/src/events/shared/stack-wire.ts, packages/client/src/schema-utils.ts, packages/engine/src/compile-resilience/planning-decomposition-limits.ts, packages/engine/src/planner-compiler/atom-graph.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/src/planner-compiler/compiler-diagnostics.ts, packages/engine/src/planner-compiler/compiler-runner.ts, packages/engine/src/planner-compiler/exploration-agent.ts, packages/engine/src/planner-compiler/exploration-contracts.ts, packages/engine/src/planner-compiler/satisfaction-gate-agent.ts, packages/engine/src/planner-compiler/source-localization-contracts.ts, packages/engine/src/planner-compiler/source-localization-repair.ts, packages/engine/src/planner-compiler/source-localization.ts, packages/engine/src/validation/acceptance-criteria-inventory.ts, packages/engine/src/validation/acceptance-criteria.ts, packages/extension-sdk/src/schema.ts, packages/input/src/acceptance-criteria-quality.ts, packages/input/src/session-plan-set/schema.ts, test/acceptance-criteria-inventory.test.ts, test/acceptance-criteria-quality.test.ts, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/planning-exploration-agent.test.ts, test/planning-source-localization.test.ts, test/recovery-verdict-schema.test.ts
Validation: A rescope that affects one scope reruns only that scope and reuses successful unaffected localization/atom outputs where applicable; planner/reducer harnesses remain tool-less; exploration result schemas reject or ignore module/dependency authoring.

### planner-compiler-rescope-tests — Planner compiler rescoping regression tests

Criteria: ac-010
Aspects: ac-010:interface:test, ac-010:subsystem:test
Depends on: adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/README.md, CHANGELOG.md, CONTRIBUTING.md, criteria/aspects, docs/architecture.md, docs/config-migration.md, docs/config.md, docs/extensions-api.md, docs/extensions.md, docs/hooks.md, docs/releasing.md, docs/roadmap.md, docs/webux-workspaces.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/recover/recover.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/backlog-capture-guardrails.ts, eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts, eforge/extensions/eforge-plan/schema.ts, eforge/extensions/eforge-plan/sqlite/schema.ts, localization/exploration, localization/rescope, packages/client/src/__tests__/events-schema-shape.test.ts, packages/client/src/__tests__/events-schema-test-helpers.ts, packages/client/src/__tests__/schema-utils.test.ts, packages/client/src/events/constants.ts, packages/client/src/events/decisions.ts, packages/client/src/events/envelope.ts, packages/client/src/events/parse.ts, packages/client/src/events/queue-events.ts, packages/client/src/events/root.ts, packages/client/src/events/shared/agent-fields.ts, packages/client/src/events/shared/compile-resilience.ts, packages/client/src/events/shared/extension-actions.ts, packages/client/src/events/shared/planning-decomposition.ts, packages/client/src/events/shared/schemas.ts, packages/client/src/events/shared/stack-wire.ts, packages/client/src/schema-utils.ts, packages/engine/src/compile-resilience/planning-decomposition-limits.ts, packages/engine/src/planner-compiler/atom-graph.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/src/planner-compiler/compiler-diagnostics.ts, packages/engine/src/planner-compiler/compiler-runner.ts, packages/engine/src/planner-compiler/exploration-agent.ts, packages/engine/src/planner-compiler/exploration-contracts.ts, packages/engine/src/planner-compiler/satisfaction-gate-agent.ts, packages/engine/src/planner-compiler/source-localization-contracts.ts, packages/engine/src/planner-compiler/source-localization-repair.ts, packages/engine/src/planner-compiler/source-localization.ts, packages/engine/src/validation/acceptance-criteria-inventory.ts, packages/engine/src/validation/acceptance-criteria.ts, packages/extension-sdk/src/schema.ts, packages/input/src/acceptance-criteria-quality.ts, packages/input/src/session-plan-set/schema.ts, test/acceptance-criteria-inventory.test.ts, test/acceptance-criteria-quality.test.ts, test/config-schema.test.ts, test/config.agent-runtimes.schema.test.ts, test/planning-exploration-agent.test.ts, test/planning-source-localization.test.ts, test/recovery-verdict-schema.test.ts
Validation: `pnpm test` covers the new cases and existing planner-compiler tests remain green; new tests would fail without the resilience, deterministic splitting, and preservation behavior.

## Integration contracts

- adaptive-rerun-preservation -> deterministic-rescope-splitting (plan dependency): adaptive-rerun-preservation builds on Deterministic degraded-scope atom splitting
- adaptive-rerun-preservation -> exploration-outcome-resilience (plan dependency): adaptive-rerun-preservation builds on Structured exploration budget-exhaustion outcomes
- deterministic-rescope-splitting -> exploration-outcome-resilience (plan dependency): deterministic-rescope-splitting builds on Structured exploration budget-exhaustion outcomes
- planner-compiler-rescope-tests -> adaptive-rerun-preservation (plan dependency): planner-compiler-rescope-tests builds on Affected-scope localization reruns and preservation
- planner-compiler-rescope-tests -> deterministic-rescope-splitting (plan dependency): planner-compiler-rescope-tests builds on Deterministic degraded-scope atom splitting
- planner-compiler-rescope-tests -> exploration-outcome-resilience (plan dependency): planner-compiler-rescope-tests builds on Structured exploration budget-exhaustion outcomes

## Shared file ownership

- .claude/skills/eforge-release/SKILL.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- .claude/skills/eval-analysis/SKILL.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- .github/workflows/ci.yml: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- .github/workflows/publish.yml: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- .pi/extensions/eforge-dev/README.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- CHANGELOG.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- CONTRIBUTING.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- criteria/aspects: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/architecture.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/config-migration.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/config.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/extensions-api.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/extensions.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/hooks.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/releasing.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/roadmap.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- docs/webux-workspaces.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge-plugin/skills/recover/recover.md: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/config.yaml: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-guardrails/index.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-capture-guardrails.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/schema.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- eforge/extensions/eforge-plan/sqlite/schema.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- localization/exploration: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- localization/rescope: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/__tests__/events-schema-shape.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/__tests__/events-schema-test-helpers.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/__tests__/schema-utils.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/constants.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/decisions.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/envelope.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/parse.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/queue-events.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/root.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/shared/agent-fields.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/shared/compile-resilience.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/shared/extension-actions.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/shared/planning-decomposition.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/shared/schemas.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/events/shared/stack-wire.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/client/src/schema-utils.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/compile-resilience/planning-decomposition-limits.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/atom-graph.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/compile-stage-integration.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/compiler-diagnostics.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/compiler-runner.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/exploration-agent.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/exploration-contracts.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/satisfaction-gate-agent.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/source-localization-contracts.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/source-localization-repair.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/planner-compiler/source-localization.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/validation/acceptance-criteria-inventory.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/engine/src/validation/acceptance-criteria.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/extension-sdk/src/schema.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/input/src/acceptance-criteria-quality.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- packages/input/src/session-plan-set/schema.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/acceptance-criteria-inventory.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/acceptance-criteria-quality.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/config-schema.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/config.agent-runtimes.schema.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/planning-exploration-agent.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/planning-source-localization.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)
- test/recovery-verdict-schema.test.ts: owner adaptive-rerun-preservation, deterministic-rescope-splitting, exploration-outcome-resilience, planner-compiler-rescope-tests (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "exploration-outcome-resilience",
      "title": "Structured exploration budget-exhaustion outcomes",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-003"
      ],
      "aspectIds": [
        "ac-001:interface:schema",
        "ac-001:interface:schema-contract",
        "ac-001:subsystem:schema",
        "ac-002:general:general",
        "ac-003:general:general"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "deterministic-rescope-splitting",
      "title": "Deterministic degraded-scope atom splitting",
      "residue": false,
      "criterionIds": [
        "ac-004",
        "ac-006",
        "ac-009"
      ],
      "aspectIds": [
        "ac-004:evidence:criteria-aspects",
        "ac-004:interface:schema-contract",
        "ac-006:general:general",
        "ac-009:general:general"
      ],
      "dependsOnPlanIds": [
        "exploration-outcome-resilience"
      ]
    },
    {
      "planId": "adaptive-rerun-preservation",
      "title": "Affected-scope localization reruns and preservation",
      "residue": false,
      "criterionIds": [
        "ac-005",
        "ac-007",
        "ac-008"
      ],
      "aspectIds": [
        "ac-005:evidence:localization-exploration",
        "ac-007:general:general",
        "ac-008:evidence:localization-rescope"
      ],
      "dependsOnPlanIds": [
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience"
      ]
    },
    {
      "planId": "planner-compiler-rescope-tests",
      "title": "Planner compiler rescoping regression tests",
      "residue": false,
      "criterionIds": [
        "ac-010"
      ],
      "aspectIds": [
        "ac-010:interface:test",
        "ac-010:subsystem:test"
      ],
      "dependsOnPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "criteria/aspects",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-capture-guardrails.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/schema.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/schema.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "localization/exploration",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "localization/rescope",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-shape.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schema-test-helpers.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/schema-utils.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/constants.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/decisions.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/envelope.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/parse.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/queue-events.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/root.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/agent-fields.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/compile-resilience.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/extension-actions.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/planning-decomposition.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/schemas.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/stack-wire.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/schema-utils.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/compile-resilience/planning-decomposition-limits.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/atom-graph.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/compiler-diagnostics.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/compiler-runner.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/exploration-agent.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/exploration-contracts.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/satisfaction-gate-agent.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/source-localization-contracts.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/source-localization-repair.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/source-localization.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-criteria-inventory.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-criteria.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/extension-sdk/src/schema.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/input/src/acceptance-criteria-quality.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/input/src/session-plan-set/schema.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/acceptance-criteria-inventory.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/acceptance-criteria-quality.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/config-schema.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/config.agent-runtimes.schema.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-exploration-agent.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-source-localization.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/recovery-verdict-schema.test.ts",
      "ownerPlanIds": [
        "adaptive-rerun-preservation",
        "deterministic-rescope-splitting",
        "exploration-outcome-resilience",
        "planner-compiler-rescope-tests"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    }
  ],
  "contracts": [
    {
      "contractId": "plan-dependency:adaptive-rerun-preservation->deterministic-rescope-splitting:",
      "kind": "plan-dependency",
      "fromPlanId": "adaptive-rerun-preservation",
      "toPlanId": "deterministic-rescope-splitting",
      "summary": "adaptive-rerun-preservation builds on Deterministic degraded-scope atom splitting"
    },
    {
      "contractId": "plan-dependency:adaptive-rerun-preservation->exploration-outcome-resilience:",
      "kind": "plan-dependency",
      "fromPlanId": "adaptive-rerun-preservation",
      "toPlanId": "exploration-outcome-resilience",
      "summary": "adaptive-rerun-preservation builds on Structured exploration budget-exhaustion outcomes"
    },
    {
      "contractId": "plan-dependency:deterministic-rescope-splitting->exploration-outcome-resilience:",
      "kind": "plan-dependency",
      "fromPlanId": "deterministic-rescope-splitting",
      "toPlanId": "exploration-outcome-resilience",
      "summary": "deterministic-rescope-splitting builds on Structured exploration budget-exhaustion outcomes"
    },
    {
      "contractId": "plan-dependency:planner-compiler-rescope-tests->adaptive-rerun-preservation:",
      "kind": "plan-dependency",
      "fromPlanId": "planner-compiler-rescope-tests",
      "toPlanId": "adaptive-rerun-preservation",
      "summary": "planner-compiler-rescope-tests builds on Affected-scope localization reruns and preservation"
    },
    {
      "contractId": "plan-dependency:planner-compiler-rescope-tests->deterministic-rescope-splitting:",
      "kind": "plan-dependency",
      "fromPlanId": "planner-compiler-rescope-tests",
      "toPlanId": "deterministic-rescope-splitting",
      "summary": "planner-compiler-rescope-tests builds on Deterministic degraded-scope atom splitting"
    },
    {
      "contractId": "plan-dependency:planner-compiler-rescope-tests->exploration-outcome-resilience:",
      "kind": "plan-dependency",
      "fromPlanId": "planner-compiler-rescope-tests",
      "toPlanId": "exploration-outcome-resilience",
      "summary": "planner-compiler-rescope-tests builds on Structured exploration budget-exhaustion outcomes"
    }
  ],
  "conflicts": []
}
```