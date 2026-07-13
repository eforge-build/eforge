# Planner Compiler Architecture

## Summary

Single implementation plan localized to eforge-plan canonical session-plan synchronization and focused eforge-plan tests. The change must make search dirty marking idempotent for unchanged read-only workstation refreshes while preserving canonical SQLite session-plan status/lifecycle/synchronization metadata behavior. Dirty flags should be driven by search-relevant canonical session-plan content and linked backlog-item/epic relationship changes, while genuine canonical writes continue to mark exactly affected documents dirty.

## Compiler status

Compiler status: complete
Source hash: 543631fead843fa1204ffdecc9a79b282fa64a493a10a4d089e3efc5b3b29922

## Plan boundaries

### eforge-plan-search-dirty-refresh — Keep eforge-plan search dirty tracking stable across no-op refreshes

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:interface:test, ac-005:subsystem:test
Depends on: (none)
Residue: no
Owned files:
- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`
- `eforge/extensions/eforge-plan/__tests__/session-plan-search-index-dirty.test.ts` (new focused regression file if no existing focused session-plan/search-index test file is more appropriate)

Validation: Run targeted eforge-plan Vitest tests covering unchanged session-plan synchronization, meaningful canonical content or relationship changes, and a rebuilt ready search index remaining ready after a read-only workstation refresh that loads `list-planning-artifacts`. Also keep workspace checks green with `pnpm test` when practical.

## Integration contracts

- Canonical sync continues to update session-plan status, lifecycle, and synchronization metadata as before; the idempotency change only gates search dirty marking.
- Search dirty marking remains explicit through the canonical dirty-marking helper and is emitted only when search-relevant canonical content or linked backlog-item/epic relationships change.
- Unrelated release, CI, plugin, guardrails, and generic backlog-curation files are outside this plan boundary unless implementation discovers a direct focused test dependency.

## Shared file ownership

- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`: owner `eforge-plan-search-dirty-refresh` (canonical session-plan sync implementation)
- `eforge/extensions/eforge-plan/__tests__/session-plan-search-index-dirty.test.ts`: owner `eforge-plan-search-dirty-refresh` (focused regression coverage; may map to an existing focused session-plan/search-index test file if present)

## Reduce conflicts

- Keep changes localized to the eforge-plan canonical sync path and focused tests; do not edit unrelated evidence files listed by broad inventory scans.

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "eforge-plan-search-dirty-refresh",
      "title": "Keep eforge-plan search dirty tracking stable across no-op refreshes",
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
        "ac-002:general:general",
        "ac-003:general:general",
        "ac-004:general:general",
        "ac-005:interface:test",
        "ac-005:subsystem:test"
      ],
      "dependsOnPlanIds": []
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/git-workflow.json",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CHANGELOG.md",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/canonical/session-plan-records.ts",
      "ownerPlanIds": [
        "eforge-plan-search-dirty-refresh"
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