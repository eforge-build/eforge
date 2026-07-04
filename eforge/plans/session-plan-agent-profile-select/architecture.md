# Planner Compiler Architecture

## Summary

Implement the feature as three dependent modules: shared profile list route/type contract, a thin read-only eforge-plan profile-options action over the kernel profile-list interface, and the session-plan metadata select UI. Profile discovery/list semantics stay in the eforge kernel/daemon/shared client surface. eforge-plan consumes a read-only projection and must not scan profile directories, import private engine config internals, duplicate profile-list wire shapes, or hard-code `/api/...` profile routes.

## Compiler status

Compiler status: complete
Source hash: 76e8e3f94d11a5d8ac660bdcca521e377636186bcd56d8259da7daecbcbc40ab

## Plan boundaries

### client-profile-contract — Profile route/type source-of-truth contract

Criteria: ac-003, ac-005, ac-012
Aspects: ac-003:evidence:api, ac-003:interface:api, ac-003:interface:config, ac-003:interface:configuration, ac-003:interface:route, ac-003:interface:route-api, ac-005:evidence:types-route, ac-005:interface:route, ac-005:interface:route-api, ac-005:interface:schema-contract
Depends on: (none)
Residue: no
Owned files:

- `packages/client/src/api/profile.ts`
- `packages/client/src/types.ts`
- `packages/client/src/routes/route-map.ts`
- `packages/monitor/src/routes/profiles.ts` if route projection refactoring is required
- Profile route/client contract and boundary tests under `test/` and/or `packages/monitor/src/__tests__/`

Validation: `pnpm type-check`; targeted profile route/client contract tests; affected monitor route tests if `packages/monitor/src/routes/profiles.ts` changes; `pnpm maintainability:check`.

### eforge-plan-profile-options-action — Read-only eforge-plan profile options action

Criteria: ac-002, ac-003, ac-004, ac-005, ac-012
Aspects: ac-002:evidence:scope-harness-description-active, ac-004:interface:configuration, ac-004:interface:extension, ac-004:interface:extension-surface, ac-004:interface:schema-contract, ac-004:subsystem:extension, ac-012:evidence:kernel-extension, ac-012:evidence:registration-allowed-action, ac-012:interface:extension, ac-012:interface:extension-surface
Depends on: client-profile-contract
Residue: no
Owned files:

- `packages/extension-sdk/src/contributions.ts` if a profile-list service must be added to action context
- `packages/engine/src/extensions/types.ts` if a profile-list service must be added to action context
- `packages/engine/src/extensions/` action invocation/runtime files needed to provide the read-only profile-list context service
- `eforge/extensions/eforge-plan/session-plan-schemas.ts`
- `eforge/extensions/eforge-plan/session-plan-actions.ts`
- `eforge/extensions/eforge-plan/index.ts`
- eforge-plan registration/action tests such as `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` and `eforge/extensions/eforge-plan/__tests__/registration.test.ts`
- Extension context/runtime tests under `test/` if the kernel service is added

Validation: `pnpm type-check`; eforge-plan action/registration tests; extension context/runtime tests for read-only profile-list service; `pnpm maintainability:check`.

### session-plan-agent-profile-select — Session plan agent profile select UI and persistence

Criteria: ac-001, ac-002, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012
Aspects: ac-001:evidence:select-dropdown, ac-006:evidence:no-selection-default, ac-006:evidence:omitted-cleared, ac-007:general:general, ac-008:interface:ui, ac-008:interface:ui-surface, ac-008:subsystem:ui, ac-009:general:general, ac-010:evidence:missing-deleted, ac-011:general:general, ac-012:evidence:copy-label, ac-012:interface:test
Depends on: eforge-plan-profile-options-action
Residue: no
Owned files:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/metadata-editor.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` or adjacent Plans data hook
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts`
- Workstation fixtures/mocks and component/view-model tests near the Plans workstation source

Validation: `pnpm type-check`; targeted workstation/component tests for metadata editor behavior; affected eforge-plan action tests if persistence/schema behavior is touched; `pnpm build` or workstation build if assets/types changed; `pnpm maintainability:check`.

## Integration contracts

- `eforge-plan-profile-options-action` consumes the shared profile-list route/types/projection from `client-profile-contract` and exposes them through a read-only extension context service or a thin eforge-plan action adapter.
- `session-plan-agent-profile-select` consumes the profile-options action/bridge from `eforge-plan-profile-options-action`; it does not fetch daemon routes directly and does not own profile discovery or wire shapes.
- `update-session-plan-metadata` remains the persistence path for `agentProfile`; the UI passes `null`/unset for the default option and profile names for listed or kept missing-current options.

## Shared file ownership

- No file is intentionally co-owned by independent plans. Downstream plans may consume types/actions produced by upstream plans through the declared dependency chain.
- If implementation discovers an unavoidable overlap, keep the edit in the earliest owning plan and have downstream plans consume the result rather than re-editing the same file.

## Reduce conflicts

- Keep profile contract edits in client/daemon files owned by `client-profile-contract`.
- Keep extension context/action registration edits in `eforge-plan-profile-options-action`.
- Keep workstation UI/loading/mock edits in `session-plan-agent-profile-select`.
- Do not add eforge-plan directory scanning, private engine config imports, direct profile API fetches, or local profile-list DTO declarations in any plan.

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "client-profile-contract",
      "title": "Profile route/type source-of-truth contract",
      "residue": false,
      "criterionIds": [
        "ac-003",
        "ac-005",
        "ac-012"
      ],
      "aspectIds": [
        "ac-003:evidence:api",
        "ac-003:interface:api",
        "ac-003:interface:config",
        "ac-003:interface:configuration",
        "ac-003:interface:route",
        "ac-003:interface:route-api",
        "ac-005:evidence:types-route",
        "ac-005:interface:route",
        "ac-005:interface:route-api",
        "ac-005:interface:schema-contract"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "eforge-plan-profile-options-action",
      "title": "Read-only eforge-plan profile options action",
      "residue": false,
      "criterionIds": [
        "ac-002",
        "ac-003",
        "ac-004",
        "ac-005",
        "ac-012"
      ],
      "aspectIds": [
        "ac-002:evidence:scope-harness-description-active",
        "ac-004:interface:configuration",
        "ac-004:interface:extension",
        "ac-004:interface:extension-surface",
        "ac-004:interface:schema-contract",
        "ac-004:subsystem:extension",
        "ac-012:evidence:kernel-extension",
        "ac-012:evidence:registration-allowed-action",
        "ac-012:interface:extension",
        "ac-012:interface:extension-surface"
      ],
      "dependsOnPlanIds": [
        "client-profile-contract"
      ]
    },
    {
      "planId": "session-plan-agent-profile-select",
      "title": "Session plan agent profile select UI and persistence",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-002",
        "ac-006",
        "ac-007",
        "ac-008",
        "ac-009",
        "ac-010",
        "ac-011",
        "ac-012"
      ],
      "aspectIds": [
        "ac-001:evidence:select-dropdown",
        "ac-006:evidence:no-selection-default",
        "ac-006:evidence:omitted-cleared",
        "ac-007:general:general",
        "ac-008:interface:ui",
        "ac-008:interface:ui-surface",
        "ac-008:subsystem:ui",
        "ac-009:general:general",
        "ac-010:evidence:missing-deleted",
        "ac-011:general:general",
        "ac-012:evidence:copy-label",
        "ac-012:interface:test"
      ],
      "dependsOnPlanIds": [
        "eforge-plan-profile-options-action"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude-plugin/marketplace.json",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-daemon-restart/SKILL.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".claude/skills/eval-analysis/SKILL.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/event-tail.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "AGENTS.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "api/",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "copy/label",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config-migration.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/config.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/hooks.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/llm-friendly-code.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/stacking.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/config/config.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/extend/extend.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/init/init.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/profile-new/profile-new.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-agent-task-creation-drafts.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/prompt-assets.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/registration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-search-vacuum.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/action-errors.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/agent-task-actions.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-item-audit-cache.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-packets.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-schemas.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-query-actions.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/maintenance/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/projections/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/promotion-selection.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/README.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/search/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/session-plan-metadata.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/session-plan-schemas.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/shipped-evidence-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/sqlite/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/tsup.config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/postcss.config.js",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/backlog-curation-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/components/ui/select.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/draft-unit-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/views/selection-rail.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/src/workstation-view-model-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vite.config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/action-contracts.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/registration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/action-errors.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/run-playbook-action.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-playbooks/tsup.config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/extract-standalone-eforge-playbooks-extension.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/move-eforge-plan-prompts-to-extension-owned-tasks.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "examples/extensions/action-contribution.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "kernel/extension",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "missing/deleted",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "no-selection/default",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "omitted/cleared",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-actions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/events-schemas-extension-inputs.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-contributions.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-curation-map-reduce.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-agent-tasks.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/__tests__/extension-contribution-output-formatting.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/accept-recovery-success.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/apply-recovery.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/continue-repair-eligibility.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/continue-repair.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/daemon.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/efficiency-analytics.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-agent-tasks.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-dispatch.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-failure-envelope.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contribution-projection-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/extension-contributions.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/api/profile.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/efficiency-analytics-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/queue-wire-types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/routes/route-map.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/src/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/client/tsup.config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/.storybook/preview.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/postcss.config.js",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-builds.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/active-session-streams.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/app.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/console-shell.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/header.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/now-dashboard.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/project-label.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/system-view.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-efficiency-analytics.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/__tests__/use-run-detail.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/app.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/__tests__/activity-drawer.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/activity/activity-drawer.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/header/control-surface-links.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/active-efficiency-summary.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/queue-cascade-action.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/__tests__/queue-hold-action.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/active-build-card.stories.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/active-build-card.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/active-builds-grid.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/active-efficiency-summary.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/queue-action-disabled-reason.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/queue-cascade-action.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/now/queue-hold-action.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/accept-success-action.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/recovery/compile-scope-context-options.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/shell/route-placeholder.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/ui/dropdown-menu.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/components/ui/select.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/hooks/use-active-session-streams.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/selectors/active-builds.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/selectors/active-efficiency.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/lib/selectors/project-label.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/console-ui/src/views/system/extension-action-form.tsx",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/action-runtime.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/agent-context-runtime.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/contribution-validation.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/dependency-resolution.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/discovery.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/event-runtime.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/hash.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/ids.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/index.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/install-metadata.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/loader.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/manifest.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/extensions/types.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/harness.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/pipeline/stages/shard-scope.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/extension-sdk/src/contributions.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/extension-sdk/src/schema.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/auto-build-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/efficiency-analytics-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/resume-plans-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/route-test-harness.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-control-harness.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-control-registration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-extension-content-registration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/__tests__/stack-layers-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/http/route-errors.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/routes/profiles.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/scopes/src/scope.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "README.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "registration/allowed-action",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "scope/harness/description/active",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "select/dropdown",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/agent-config.mixed-harness.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/api-route-helpers.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/apply-recovery-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/build-profile-selection-skill.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/client-no-start-api-helpers.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-eligibility-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/continue-repair-route.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/docs-kernel-boundary.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/extension-action-agent-tasks.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/extension-agent-task-contribution-registration.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/extension-build-queue-enqueue-contract.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/extension-framebundle-docs-contract.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/fixtures/orchestration/no-name.yaml",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/fixtures/plans/missing-id.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/fixtures/plans/no-frontmatter.md",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/fixtures/todo-api-repo/eforge/config.yaml",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/fixtures/todo-api-repo/vitest.config.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/harness-read-only-tools.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/harness-rename.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/pi-ambient-status-no-start.test.ts",
      "ownerPlanIds": [
        "client-profile-contract",
        "eforge-plan-profile-options-action",
        "session-plan-agent-profile-select"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    }
  ],
  "contracts": [
    {
      "contractId": "plan-dependency:eforge-plan-profile-options-action->client-profile-contract:",
      "kind": "plan-dependency",
      "fromPlanId": "eforge-plan-profile-options-action",
      "toPlanId": "client-profile-contract",
      "summary": "eforge-plan-profile-options-action builds on Profile route/type source-of-truth contract"
    },
    {
      "contractId": "plan-dependency:session-plan-agent-profile-select->eforge-plan-profile-options-action:",
      "kind": "plan-dependency",
      "fromPlanId": "session-plan-agent-profile-select",
      "toPlanId": "eforge-plan-profile-options-action",
      "summary": "session-plan-agent-profile-select builds on Read-only eforge-plan profile options action"
    }
  ],
  "conflicts": []
}
```
