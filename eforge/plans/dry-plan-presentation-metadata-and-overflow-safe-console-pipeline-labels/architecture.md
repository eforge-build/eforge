# Planner Compiler Architecture

## Summary

Implement additive Console plan presentation metadata and overflow-safe labels while preserving canonical ID-based API and interaction behavior. Follow with independently owned acceptance tests for reconciliation, numbering, tooltips, overflow, and synthetic lanes. The existing Console test surface remains unlocalized in supplied evidence and must be found before extending it; no schema change applies to the layout criterion.

## Compiler status

Compiler status: complete
Source hash: 8a6aaac16cd87391dde15de87f72498710bfc4de28514cb2c6e79db96b4c2724

## Plan boundaries

### console-plan-presentation-and-id-compatibility — Console plan presentation and ID compatibility

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012, ac-020, ac-021
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:general:general, ac-007:general:general, ac-008:general:general, ac-009:general:general, ac-010:general:general, ac-011:general:general, ac-012:interface:api, ac-012:subsystem:api, ac-020:general:general, ac-021:general:general
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-plugin-update-docs/SKILL.md, AGENTS.md, docs/architecture.md, docs/extensions-api.md, docs/llm-friendly-code.md, eforge-plugin/skills/extend/extend.md, packages/client/src/api/accept-recovery-success.ts, packages/client/src/api/apply-recovery.ts, packages/client/src/api/config.ts, packages/client/src/api/continue-repair-eligibility.ts, packages/client/src/api/continue-repair.ts, packages/client/src/api/daemon.ts, packages/client/src/api/efficiency-analytics.ts, packages/client/src/api/extension-agent-tasks.ts, packages/client/src/api/extension-contribution-dispatch.ts, packages/client/src/api/extension-contribution-failure-envelope.ts, packages/client/src/api/extension-contribution-projection-types.ts, packages/client/src/api/extension-contributions.ts, packages/console-ui/src/components/pipeline/plan-row.tsx, packages/console-ui/src/components/pipeline/thread-pipeline.tsx, packages/console-ui/src/hooks/use-run-detail.ts, packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts, packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json, packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts, packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts, packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx, packages/console-ui/src/lib/run-state/handlers/index.ts, packages/console-ui/src/lib/run-state/index.ts, packages/console-ui/src/views/run-detail/pipeline-section.tsx, test/api-route-helpers.ts
Validation: Test late metadata, fallback text, numbering, tooltip, short and pathological overflow inputs, lanes/order, and ID-keyed API/interactions; run Console tests, type-check, and maintainability checks.

### console-plan-presentation-acceptance-tests — Console plan presentation acceptance coverage

Criteria: ac-013, ac-014, ac-015, ac-016, ac-017, ac-018, ac-019
Aspects: ac-013:interface:test, ac-013:subsystem:test, ac-014:interface:test, ac-014:subsystem:test, ac-015:interface:test, ac-015:subsystem:test, ac-016:interface:test, ac-016:subsystem:test, ac-017:interface:contract, ac-017:interface:schema-contract, ac-017:interface:test, ac-017:subsystem:contract, ac-017:subsystem:test, ac-018:interface:test, ac-018:subsystem:test, ac-019:interface:test, ac-019:subsystem:test
Depends on: console-plan-presentation-and-id-compatibility
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/git-workflow.json, CHANGELOG.md, CONTRIBUTING.md, docs/releasing.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts, eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts, eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts, packages/client/src/__tests__/client-contract-public-exports.test.ts, packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts, packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts, test/eforge-plan-packaging-docs-contract.test.ts, test/eforge-playbook-planning-contract.test.ts, test/extension-build-queue-enqueue-contract.test.ts, test/extension-framebundle-docs-contract.test.ts, test/profile-list-client-contract.test.ts
Validation: Focused tests cover short, spaced-long, and unbroken labels, row shrink and sibling invariants, metadata precedence, numbering, tooltip text, and synthetic lanes; package tests and type-check pass.

## Integration contracts

- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (interface api): Shared interface api is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004.
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (interface contract): Shared interface contract is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004.
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (interface schema-contract): Shared interface schema-contract is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004.
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (interface test): Shared interface test is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004.
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (plan dependency): console-plan-presentation-acceptance-tests builds on Console plan presentation and ID compatibility
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (shared file AGENTS.md): shared-evidence-primary-owner
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (shared file docs/architecture.md): shared-evidence-primary-owner
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (shared file docs/extensions-api.md): shared-evidence-primary-owner
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (shared file docs/llm-friendly-code.md): shared-evidence-primary-owner
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (shared file eforge-plugin/skills/extend/extend.md): shared-evidence-primary-owner
- console-plan-presentation-acceptance-tests -> console-plan-presentation-and-id-compatibility (shared file test/api-route-helpers.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file CHANGELOG.md): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge-plugin/bin/eforge-mcp-proxy.mjs): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts): shared-evidence-primary-owner
- console-plan-presentation-and-id-compatibility -> console-plan-presentation-acceptance-tests (shared file packages/client/src/__tests__/client-contract-public-exports.test.ts): shared-evidence-primary-owner

## Shared file ownership

- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- .claude/skills/eforge-release/SKILL.md: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- .github/workflows/ci.yml: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- .github/workflows/publish.yml: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- .pi/git-workflow.json: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- AGENTS.md: owner console-plan-presentation-and-id-compatibility; consumers console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- CHANGELOG.md: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- CONTRIBUTING.md: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- docs/architecture.md: owner console-plan-presentation-and-id-compatibility; consumers console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- docs/extensions-api.md: owner console-plan-presentation-and-id-compatibility; consumers console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- docs/llm-friendly-code.md: owner console-plan-presentation-and-id-compatibility; consumers console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- docs/releasing.md: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge-plugin/skills/extend/extend.md: owner console-plan-presentation-and-id-compatibility; consumers console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/config.yaml: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-guardrails/index.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- packages/client/src/__tests__/client-contract-public-exports.test.ts: owner console-plan-presentation-acceptance-tests; consumers console-plan-presentation-and-id-compatibility (shared-evidence-primary-owner)
- packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- packages/client/src/api/accept-recovery-success.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/apply-recovery.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/config.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/continue-repair-eligibility.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/continue-repair.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/daemon.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/efficiency-analytics.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/extension-agent-tasks.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/extension-contribution-dispatch.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/extension-contribution-failure-envelope.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/extension-contribution-projection-types.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/client/src/api/extension-contributions.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/components/pipeline/plan-row.tsx: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/components/pipeline/thread-pipeline.tsx: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/hooks/use-run-detail.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/handlers/index.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/lib/run-state/index.ts: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/console-ui/src/views/run-detail/pipeline-section.tsx: owner console-plan-presentation-and-id-compatibility (single-atom-evidence)
- packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- test/api-route-helpers.ts: owner console-plan-presentation-and-id-compatibility; consumers console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- test/eforge-plan-packaging-docs-contract.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- test/eforge-playbook-planning-contract.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- test/extension-build-queue-enqueue-contract.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- test/extension-framebundle-docs-contract.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)
- test/profile-list-client-contract.test.ts: owner console-plan-presentation-acceptance-tests (shared-evidence-primary-owner)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "console-plan-presentation-and-id-compatibility",
      "title": "Console plan presentation and ID compatibility",
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
        "ac-012",
        "ac-020",
        "ac-021"
      ],
      "aspectIds": [
        "ac-001:general:general",
        "ac-002:general:general",
        "ac-003:general:general",
        "ac-004:general:general",
        "ac-005:general:general",
        "ac-006:general:general",
        "ac-007:general:general",
        "ac-008:general:general",
        "ac-009:general:general",
        "ac-010:general:general",
        "ac-011:general:general",
        "ac-012:interface:api",
        "ac-012:subsystem:api",
        "ac-020:general:general",
        "ac-021:general:general"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "console-plan-presentation-acceptance-tests",
      "title": "Console plan presentation acceptance coverage",
      "residue": false,
      "criterionIds": [
        "ac-013",
        "ac-014",
        "ac-015",
        "ac-016",
        "ac-017",
        "ac-018",
        "ac-019"
      ],
      "aspectIds": [
        "ac-013:interface:test",
        "ac-013:subsystem:test",
        "ac-014:interface:test",
        "ac-014:subsystem:test",
        "ac-015:interface:test",
        "ac-015:subsystem:test",
        "ac-016:interface:test",
        "ac-016:subsystem:test",
        "ac-017:interface:contract",
        "ac-017:interface:schema-contract",
        "ac-017:interface:test",
        "ac-017:subsystem:contract",
        "ac-017:subsystem:test",
        "ac-018:interface:test",
        "ac-018:subsystem:test",
        "ac-019:interface:test",
        "ac-019:subsystem:test"
      ],
      "dependsOnPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".pi/git-workflow.json",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-index.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/client-contract-public-exports.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "packages/client/src/api/accept-recovery-success.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/apply-recovery.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/config.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/continue-repair-eligibility.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/continue-repair.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/daemon.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/efficiency-analytics.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-agent-tasks.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-dispatch.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-failure-envelope.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-projection-types.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contributions.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/plan-row.tsx",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/pipeline/thread-pipeline.tsx",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-run-detail.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/base-sync-selectors.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/sample-build.json",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/handlers/index.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/index.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/run-detail/pipeline-section.tsx",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/api-route-helpers.ts",
      "ownerPlanIds": [
        "console-plan-presentation-and-id-compatibility"
      ],
      "consumerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/eforge-plan-packaging-docs-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/eforge-playbook-planning-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-build-queue-enqueue-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/extension-framebundle-docs-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "test/profile-list-client-contract.test.ts",
      "ownerPlanIds": [
        "console-plan-presentation-acceptance-tests"
      ],
      "consumerPlanIds": [],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:api",
      "kind": "interface",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "interfaceKey": "api",
      "summary": "Shared interface api is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004."
    },
    {
      "contractId": "interface:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:contract",
      "kind": "interface",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "interfaceKey": "contract",
      "summary": "Shared interface contract is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004."
    },
    {
      "contractId": "interface:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:schema-contract",
      "kind": "interface",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "interfaceKey": "schema-contract",
      "summary": "Shared interface schema-contract is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004."
    },
    {
      "contractId": "interface:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:test",
      "kind": "interface",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-foundation-contracts, atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004. Primary atom atom-foundation-contracts owns reusable interface findings for consumers atom-foundation-contracts-002, atom-foundation-contracts-003, atom-general-004."
    },
    {
      "contractId": "plan-dependency:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:",
      "kind": "plan-dependency",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "summary": "console-plan-presentation-acceptance-tests builds on Console plan presentation and ID compatibility"
    },
    {
      "contractId": "shared-file:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:AGENTS.md",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "path": "AGENTS.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:docs/architecture.md",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "path": "docs/architecture.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:docs/extensions-api.md",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "path": "docs/extensions-api.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:docs/llm-friendly-code.md",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "path": "docs/llm-friendly-code.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:eforge-plugin/skills/extend/extend.md",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "path": "eforge-plugin/skills/extend/extend.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-acceptance-tests->console-plan-presentation-and-id-compatibility:test/api-route-helpers.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-acceptance-tests",
      "toPlanId": "console-plan-presentation-and-id-compatibility",
      "path": "test/api-route-helpers.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:CHANGELOG.md",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "CHANGELOG.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:console-plan-presentation-and-id-compatibility->console-plan-presentation-acceptance-tests:packages/client/src/__tests__/client-contract-public-exports.test.ts",
      "kind": "shared-file",
      "fromPlanId": "console-plan-presentation-and-id-compatibility",
      "toPlanId": "console-plan-presentation-acceptance-tests",
      "path": "packages/client/src/__tests__/client-contract-public-exports.test.ts",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```