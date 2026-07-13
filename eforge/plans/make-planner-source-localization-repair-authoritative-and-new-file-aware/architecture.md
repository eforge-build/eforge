# Planner Compiler Architecture

## Summary

One cohesive planner-compiler change makes reducer identifiers type-distinct and bounded, makes localization fallback and unresolved-owner repair authoritative, permits narrowly proven new-file ownership beneath an existing active repository/worktree directory, and adds focused plus integration regression coverage.

## Compiler status

Compiler status: complete
Source hash: 94fc12a37261af86a581d41c831a243c238cc09a9d6c3f1c50d092936ed75c39

## Plan boundaries

### planner-localization-authority — Make planner source localization repair authoritative and new-file aware

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012, ac-013
Aspects: ac-001:general:general, ac-002:subsystem:aspect-based, ac-002:subsystem:criterion, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:general:general, ac-007:general:general, ac-008:subsystem:lexical, ac-008:subsystem:shared, ac-009:general:general, ac-010:interface:test, ac-010:subsystem:test, ac-011:general:general, ac-012:interface:test, ac-012:subsystem:test, ac-013:interface:test, ac-013:subsystem:test
Depends on: (none)
Residue: no

The implementation boundary is the planner compiler. Its authoritative source paths are:

- `packages/engine/src/planner-compiler/reduce-contracts.ts` and direct reducer task/prompt construction callers
- `packages/engine/src/planner-compiler/source-localization.ts`
- `packages/engine/src/planner-compiler/source-localization-repair.ts`
- `packages/engine/src/planner-compiler/exploration-contracts.ts`
- `packages/engine/src/planner-compiler/adaptive-rescope.ts` and direct compile orchestration callers
- `packages/engine/src/planner-compiler/shared-brief.ts`
- `packages/engine/src/planner-compiler/source-evidence-materialization.ts`
- focused logical-unit tests and the `add-upstream-plan-root-cause-reporting`-shaped integration fixture required by ac-010 through ac-012

Release skills, workflows, changelog, unrelated recovery runtime files, eforge-plan tests, Console UI files, and generic client event modules are not implementation owners. A client planning-decomposition schema may be changed only if implementation establishes that a cross-process event or diagnostic contract must change.

Validation: Focused Vitest coverage must reject cross-domain/unknown/out-of-node reducer ids without suppressing fallback; prove bounded in-root new-file ownership and traversal/ambiguity rejection; force exploration for unresolved critical/representation owners; prove targeted repair bounds, selective reruns, priority under evidence contention, and subsystem isolation; and compile the modeled integration fixture into buildable artifacts without the two owner-localization failures. Then run existing bounded planner/adaptive-rescope/source-evidence/compile-stage suites plus `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`.

## Integration contracts

- Reducer structured submissions consume node-bounded source-need and affected-atom catalogs; `sourceIds` remain provenance and are never accepted as source-need ids.
- Exploration and adaptive rescope consume unresolved critical/representation-required ownership state and may not skip solely because aggregate literal-path confidence is high.
- Source-localization repair sends bounded targeted exploration requests, materializes new evidence within existing ceilings, and returns only affected planning atoms for rerun.
- Source evidence routing and materialization use deterministic precedence: explicit PRD paths, affected-criterion candidates, repair-priority paths, then broad lexical/shared evidence.

## Shared file ownership

- None. This is a single-plan set. Conditional client schema work is part of this plan only if a cross-process contract change is required.

## Reduce conflicts

- None.

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "planner-localization-authority",
      "title": "Make planner source localization repair authoritative and new-file aware",
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
        "ac-013"
      ],
      "aspectIds": [
        "ac-001:general:general",
        "ac-002:subsystem:aspect-based",
        "ac-002:subsystem:criterion",
        "ac-003:general:general",
        "ac-004:general:general",
        "ac-005:general:general",
        "ac-006:general:general",
        "ac-007:general:general",
        "ac-008:subsystem:lexical",
        "ac-008:subsystem:shared",
        "ac-009:general:general",
        "ac-010:interface:test",
        "ac-010:subsystem:test",
        "ac-011:general:general",
        "ac-012:interface:test",
        "ac-012:subsystem:test",
        "ac-013:interface:test",
        "ac-013:subsystem:test"
      ],
      "dependsOnPlanIds": []
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/git-workflow.json",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-status-surfaces.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/agent-fields.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/compile-resilience.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/extension-actions.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/planning-decomposition.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/recovery-auto-resume.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/schemas.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/events/shared/stack-wire.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/build-history/shared.tsx",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/exploration-contracts.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/reduce-contracts.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/shared-brief-budget.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/shared-brief-contracts.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/shared-brief.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/planner-compiler/source-localization.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/accept-success-landing.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/accept-success.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/analyst-context.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/applied-sidecar.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/apply.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/decomposition-evidence-render.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/event-history.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/failed-resume-sidecar-finalization.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/failure-summary.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/guidance-artifacts.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/guidance-render.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/recovery/guidance.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "README.md",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-aspect-coverage.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/planning-shared-brief-scale.test.ts",
      "ownerPlanIds": [
        "planner-localization-authority"
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
