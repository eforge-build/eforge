# Planner Compiler Architecture

## Summary

Deterministic single-atom passthrough of atom-root. One cohesive queue-control change clears stack_parent only when its matching dependency is overridden, applies identical semantics to pending-root and waiting-directory flows, and adds focused real-code regression coverage while preserving concurrency, notification, audit, route, and validation contracts.

## Compiler status

Compiler status: complete
Source hash: 5e5f72a3c231e4c08ebdbb91c57ee13cb0edcd61450fc3b4a42d421294ee552a

## Plan boundaries

### queue-dependency-override — Clear matching stack parent during queue dependency override

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:subsystem:claiming, ac-006:subsystem:locking, ac-007:interface:test, ac-007:subsystem:test, ac-008:interface:route, ac-008:interface:route-api, ac-008:interface:test, ac-008:subsystem:route, ac-008:subsystem:test, ac-009:interface:test, ac-009:subsystem:test
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/git-workflow.json, CHANGELOG.md, CONTRIBUTING.md, docs/releasing.md, docs/webux-workspaces.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, packages/client/src/routes/route-map.ts, packages/console-ui/src/components/shell/route-placeholder.tsx, packages/engine/src/queue/control.ts, packages/monitor/src/__tests__/auto-build-route.test.ts, packages/monitor/src/__tests__/efficiency-analytics-route.test.ts, packages/monitor/src/__tests__/http-router.test.ts, packages/monitor/src/__tests__/resume-plans-route.test.ts, packages/monitor/src/__tests__/route-test-harness.ts, packages/monitor/src/__tests__/stack-layers-route.test.ts, packages/monitor/src/http/route-errors.ts, test/api-route-helpers.ts, test/apply-recovery-route.test.ts, test/continue-repair-eligibility-route.test.ts, test/continue-repair-route.test.ts, test/queue-recovery-route.test.ts, test/stack-sync-route.test.ts
Validation: Run the focused queue dependency-override regression tests, including persisted-state and dispatch/session-start assertions. Run existing queue-control route, capability, scheduler, and stacking-validation tests, then `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`; all must exit successfully.

## Integration contracts

- (none)

## Shared file ownership

- .claude/skills/eforge-release/SKILL.md: owner queue-dependency-override (single-atom-evidence)
- .github/workflows/ci.yml: owner queue-dependency-override (single-atom-evidence)
- .github/workflows/publish.yml: owner queue-dependency-override (single-atom-evidence)
- .pi/git-workflow.json: owner queue-dependency-override (single-atom-evidence)
- CHANGELOG.md: owner queue-dependency-override (single-atom-evidence)
- CONTRIBUTING.md: owner queue-dependency-override (single-atom-evidence)
- docs/releasing.md: owner queue-dependency-override (single-atom-evidence)
- docs/webux-workspaces.md: owner queue-dependency-override (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner queue-dependency-override (single-atom-evidence)
- eforge/config.yaml: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-guardrails/index.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner queue-dependency-override (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner queue-dependency-override (single-atom-evidence)
- packages/client/src/routes/route-map.ts: owner queue-dependency-override (single-atom-evidence)
- packages/console-ui/src/components/shell/route-placeholder.tsx: owner queue-dependency-override (single-atom-evidence)
- packages/engine/src/queue/control.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/__tests__/auto-build-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/__tests__/efficiency-analytics-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/__tests__/http-router.test.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/__tests__/resume-plans-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/__tests__/route-test-harness.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/__tests__/stack-layers-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- packages/monitor/src/http/route-errors.ts: owner queue-dependency-override (single-atom-evidence)
- test/api-route-helpers.ts: owner queue-dependency-override (single-atom-evidence)
- test/apply-recovery-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- test/continue-repair-eligibility-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- test/continue-repair-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- test/queue-recovery-route.test.ts: owner queue-dependency-override (single-atom-evidence)
- test/stack-sync-route.test.ts: owner queue-dependency-override (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "queue-dependency-override",
      "title": "Clear matching stack parent during queue dependency override",
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
        "ac-009"
      ],
      "aspectIds": [
        "ac-001:general:general",
        "ac-002:general:general",
        "ac-003:general:general",
        "ac-004:general:general",
        "ac-005:general:general",
        "ac-006:subsystem:claiming",
        "ac-006:subsystem:locking",
        "ac-007:interface:test",
        "ac-007:subsystem:test",
        "ac-008:interface:route",
        "ac-008:interface:route-api",
        "ac-008:interface:test",
        "ac-008:subsystem:route",
        "ac-008:subsystem:test",
        "ac-009:interface:test",
        "ac-009:subsystem:test"
      ],
      "dependsOnPlanIds": []
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/git-workflow.json",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/routes/route-map.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/shell/route-placeholder.tsx",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/control.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/http-router.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/http/route-errors.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/api-route-helpers.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-eligibility-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/queue-recovery-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/stack-sync-route.test.ts",
      "ownerPlanIds": [
        "queue-dependency-override"
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