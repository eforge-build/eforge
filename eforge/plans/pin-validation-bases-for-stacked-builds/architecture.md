# Planner Compiler Architecture

## Summary

Deterministic single-atom passthrough of atom-root. Implement immutable stacked-child validation-base pinning through dispatch, persistence/resume, worktree/divergence, and every validation phase. Resolve deleted logical parents only through a provable pinned ancestor of configured trunk; model Git failures as typed unavailable results and prevent validation/gap agents from receiving fabricated empty diffs. Add a real-Git lifecycle regression while preserving existing trunk-sync and repair behavior.

## Compiler status

Compiler status: complete
Source hash: 89cc934857f71e1beae275deed65ac76e80089203071f8d9d5e87086c7a69c11

## Plan boundaries

### stacked-validation-base-pinning — Pin stacked validation bases and preserve child diffs after parent deletion

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009
Aspects: ac-001:general:general, ac-002:subsystem:divergence, ac-002:subsystem:worktree, ac-003:subsystem:final, ac-003:subsystem:post-gap, ac-004:general:general, ac-005:general:general, ac-006:general:general, ac-007:subsystem:deletion, ac-007:subsystem:final, ac-007:subsystem:integration, ac-007:subsystem:post-gap, ac-008:general:general, ac-009:interface:test, ac-009:subsystem:test
Depends on: (none)
Residue: no
Owned files: .claude/skills/eforge-release/SKILL.md, .claude/skills/eval-analysis/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/index.ts, .pi/extensions/eforge-dev/README.md, .pi/git-workflow.json, AGENTS.md, CHANGELOG.md, CONTRIBUTING.md, docs/hooks.md, docs/releasing.md, docs/roadmap.md, docs/webux-workspaces.md, eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/config/config.md, eforge-plugin/skills/extend/extend.md, eforge-plugin/skills/init/init.md, eforge/config.yaml, eforge/dependency-update-evidence.md, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/item-body-sections.test.ts, eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts, eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts, eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts, eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts, eforge/playbooks/public-docs-generate-and-gap-audit.md, packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json, packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx, packages/engine/src/agents/gap-closer.ts, packages/engine/src/eforge.ts, packages/engine/src/orchestrator/validation-dirty-worktree.ts, packages/engine/src/planner-compiler/compile-stage-integration.ts, packages/engine/src/prd-validator-diff.ts, packages/engine/src/prompts/gap-closer.md, packages/engine/src/queue/build-single-prd.ts, packages/engine/src/stacking/base-repair.ts, packages/engine/src/validation/acceptance-criteria-inventory.ts, packages/engine/src/validation/acceptance-criteria.ts, packages/engine/src/validation/acceptance-summary.ts, packages/engine/src/validation/acceptance-unknown-resolution-runner.ts, packages/engine/src/validation/acceptance-unknown-resolution.ts, packages/engine/src/validation/json-object-extractor.ts, packages/engine/src/validation/prd-validation-wiring.ts, packages/engine/src/validation/read-only-command-validation.ts, packages/engine/src/worktree-manager.ts, packages/engine/src/worktree-ops.ts, test/engine-enqueue-post-merge.test.ts, test/gap-closer.test.ts, test/planning-compiler-stage-integration.test.ts, test/planning-deletion-discipline.test.ts, test/playbook-extension-final-boundary.test.ts, test/retry-stub-harness-integration.test.ts, test/worktree-integration.test.ts, test/worktree-manager.test.ts, test/worktree-reconciliation.test.ts
Validation: Tests prove dispatch-time immutability, resume preservation, pin-anchored worktree/divergence, successful child diffs across parent integration/deletion and all validation phases, continued landing repair, fail-closed unavailable evidence for every unprovable/error case, no agent invocation on unavailable evidence, and distinct available-empty behavior. Focused tests plus pnpm type-check, pnpm test, and pnpm maintainability:check pass.

## Integration contracts

- (none)

## Shared file ownership

- .claude/skills/eforge-release/SKILL.md: owner stacked-validation-base-pinning (single-atom-evidence)
- .claude/skills/eval-analysis/SKILL.md: owner stacked-validation-base-pinning (single-atom-evidence)
- .github/workflows/ci.yml: owner stacked-validation-base-pinning (single-atom-evidence)
- .github/workflows/publish.yml: owner stacked-validation-base-pinning (single-atom-evidence)
- .pi/extensions/eforge-dev/index.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- .pi/extensions/eforge-dev/README.md: owner stacked-validation-base-pinning (single-atom-evidence)
- .pi/git-workflow.json: owner stacked-validation-base-pinning (single-atom-evidence)
- AGENTS.md: owner stacked-validation-base-pinning (single-atom-evidence)
- CHANGELOG.md: owner stacked-validation-base-pinning (single-atom-evidence)
- CONTRIBUTING.md: owner stacked-validation-base-pinning (single-atom-evidence)
- docs/hooks.md: owner stacked-validation-base-pinning (single-atom-evidence)
- docs/releasing.md: owner stacked-validation-base-pinning (single-atom-evidence)
- docs/roadmap.md: owner stacked-validation-base-pinning (single-atom-evidence)
- docs/webux-workspaces.md: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge-plugin/.claude-plugin/plugin.json: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge-plugin/skills/config/config.md: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge-plugin/skills/extend/extend.md: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge-plugin/skills/init/init.md: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/config.yaml: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/dependency-update-evidence.md: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-guardrails/index.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/item-body-sections.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- eforge/playbooks/public-docs-generate-and-gap-audit.md: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/agents/gap-closer.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/eforge.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/orchestrator/validation-dirty-worktree.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/planner-compiler/compile-stage-integration.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/prd-validator-diff.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/prompts/gap-closer.md: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/queue/build-single-prd.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/stacking/base-repair.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/acceptance-criteria-inventory.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/acceptance-criteria.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/acceptance-summary.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/acceptance-unknown-resolution-runner.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/acceptance-unknown-resolution.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/json-object-extractor.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/prd-validation-wiring.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/validation/read-only-command-validation.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/worktree-manager.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- packages/engine/src/worktree-ops.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/engine-enqueue-post-merge.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/gap-closer.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/planning-compiler-stage-integration.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/planning-deletion-discipline.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/playbook-extension-final-boundary.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/retry-stub-harness-integration.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/worktree-integration.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/worktree-manager.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)
- test/worktree-reconciliation.test.ts: owner stacked-validation-base-pinning (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "stacked-validation-base-pinning",
      "title": "Pin stacked validation bases and preserve child diffs after parent deletion",
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
        "ac-002:subsystem:divergence",
        "ac-002:subsystem:worktree",
        "ac-003:subsystem:final",
        "ac-003:subsystem:post-gap",
        "ac-004:general:general",
        "ac-005:general:general",
        "ac-006:general:general",
        "ac-007:subsystem:deletion",
        "ac-007:subsystem:final",
        "ac-007:subsystem:integration",
        "ac-007:subsystem:post-gap",
        "ac-008:general:general",
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
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/git-workflow.json",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/dependency-update-evidence.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/item-body-sections.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/playbooks/public-docs-generate-and-gap-audit.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/fixtures/multi-plan-gap-close.json",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/run-state/__tests__/multi-plan-gap-close.e2e.test.tsx",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/agents/gap-closer.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/eforge.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/orchestrator/validation-dirty-worktree.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/compile-stage-integration.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/prd-validator-diff.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/prompts/gap-closer.md",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/build-single-prd.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/stacking/base-repair.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-criteria-inventory.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-criteria.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-summary.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-unknown-resolution-runner.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/acceptance-unknown-resolution.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/json-object-extractor.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/prd-validation-wiring.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/validation/read-only-command-validation.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/worktree-manager.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/worktree-ops.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/engine-enqueue-post-merge.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/gap-closer.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-compiler-stage-integration.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-deletion-discipline.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/playbook-extension-final-boundary.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/retry-stub-harness-integration.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-integration.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-manager.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-reconciliation.test.ts",
      "ownerPlanIds": [
        "stacked-validation-base-pinning"
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