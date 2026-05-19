---
id: plan-01-input-schema-and-helpers
name: Input schema, planning-mode helpers, and existing playbook migration
branch: add-mode-autonomous-planning-to-playbooks-bundle-first-planning-mode-playbook-complexity-hotspot-reduction/plan-01-input-schema-and-helpers
---

# Input schema, planning-mode helpers, and existing playbook migration

## Architecture Context

Playbooks are the eforge input artifact for reusable, hand-off-and-forget workflows. Today every playbook is treated as autonomous: load → format as build source → enqueue. This plan introduces a required `mode: 'autonomous' | 'planning'` field on the playbook frontmatter and a parallel code path (`playbookToPlanSeed`) so a playbook can instead seed an interactive `/eforge:plan` session plan.

Per the project's `no-backward-compat` rule, `mode` is required with no default. That forces three coupled changes to land together:
1. The Zod schema gains the field.
2. The two in-repo playbooks (`docs-implementation-sync.md`, `plugin-pi-parity-audit.md`) gain explicit `mode: autonomous` frontmatter.
3. The `playbookToSessionPlan` backward-compat alias is removed, and its one remaining caller in `packages/monitor/src/server.ts` switches to `playbookToBuildSource` (function rename only — full mode dispatch lands in plan-02 alongside the route rename).

Session plans are extended with an optional `seeded_from_playbook` frontmatter field. The schema already uses `.passthrough()`, but the field is still added explicitly for type-safety. A new helper `createSessionPlanFromPlaybookSeed` composes the existing `createSessionPlan` + `setSessionPlanSection` primitives so the daemon route in plan-02 can call a single function.

This plan is pure input-package work plus the minimum daemon import rename needed to keep the workspace compiling.

## Implementation

### Overview

1. Add `mode` to `playbookFrontmatterSchema`. Export the `PlaybookMode` type.
2. Add `playbookToPlanSeed(playbook): { sessionId; topic; sections; seededFrom }` that throws on `mode === 'autonomous'`.
3. Add a typed-error throw at the top of `playbookToBuildSource` for `mode === 'planning'`.
4. Remove the `playbookToSessionPlan` alias.
5. Add `seeded_from_playbook: z.string().optional()` to `sessionPlanFrontmatterSchema`.
6. Add `createSessionPlanFromPlaybookSeed({ playbook, session?, topic? }): SessionPlan`.
7. Update `packages/input/src/index.ts` re-exports.
8. Update `packages/monitor/src/server.ts` to import `playbookToBuildSource` instead of `playbookToSessionPlan` (rename only — the surrounding handler still calls it the same way; mode dispatch lands in plan-02).
9. Add `mode: autonomous` to both bundled playbooks.
10. Extend the playbook and session-plan test suites.

### Key Decisions

1. **`mode` is required with no default.** Matches the `no-backward-compat` memory. A playbook missing `mode` fails Zod parsing with a clear field-named error.
2. **Throw, don't silently fall through.** `playbookToBuildSource` on a planning playbook (or `playbookToPlanSeed` on an autonomous one) throws `PlaybookModeMismatchError` with the playbook name and the expected/actual mode. The daemon dispatcher in plan-02 must always check mode before calling either helper; the typed throw is a runtime safety net.
3. **`seeded_from_playbook` is the only new session-plan frontmatter field.** Optional string. Future seed sources (if any) would get their own field, not a polymorphic enum.
4. **Preserve heading mapping.** `createSessionPlanFromPlaybookSeed` writes the playbook's body sections into the session plan body under headings: `Goal → ## Goal`, `Out of scope → ## Out of scope`, `Acceptance criteria → ## Acceptance criteria`, `Notes for the planner → ## Notes from playbook`. Per the source's D4 analysis, only `## Acceptance criteria` slug-matches a required session-plan dimension; the other sections live as context. The seeded plan starts with `status: 'planning'`, `planning_type: 'unknown'`, `planning_depth: 'focused'`, empty `required_dimensions`, and `profile: null` so the plan skill's Step 3 reclassifies per-instance.
5. **Keep the daemon import rename minimal.** This plan changes only the symbol name in `server.ts:3346` (`playbookToSessionPlan` → `playbookToBuildSource`). Full mode dispatch (`autonomous` vs `planning` branches with discriminated response) lands in plan-02 together with the route rename, since they share the same handler block.

## Scope

### In Scope
- `playbookFrontmatterSchema`: add required `mode: 'autonomous' | 'planning'`. Export `PlaybookMode` type.
- `playbookToBuildSource`: throw `PlaybookModeMismatchError` when `mode !== 'autonomous'`.
- New `playbookToPlanSeed(playbook)` helper that asserts `mode === 'planning'` and maps body sections to a `Map<string, string>` keyed by lowercase heading slug.
- Remove `export const playbookToSessionPlan = playbookToBuildSource` (the alias on line 604 of `packages/input/src/playbook.ts`) and the corresponding re-export from `packages/input/src/index.ts` line 49.
- `sessionPlanFrontmatterSchema`: add `seeded_from_playbook: z.string().optional()`.
- New `createSessionPlanFromPlaybookSeed({ playbook, session?, topic? }): SessionPlan` exported from session-plan.ts.
- `packages/monitor/src/server.ts:3346`: rename the `playbookToSessionPlan` import to `playbookToBuildSource` and update the local call site on line 3356. Do not change the surrounding handler logic, route literal, or response shape — those move in plan-02.
- Add `mode: autonomous` to the frontmatter of `eforge/playbooks/docs-implementation-sync.md` and `eforge/playbooks/plugin-pi-parity-audit.md`.
- Extend `test/playbook.test.ts` with parser tests for the new field and helper tests for the mode assertions.
- Extend `test/session-plan.test.ts` with `createSessionPlanFromPlaybookSeed` tests (or place them in a new `test/session-plan-from-playbook.test.ts` sibling — author's choice as long as they run under vitest).

### Out of Scope
- Route rename, daemon mode dispatch, MCP tool changes, Pi extension changes, CLI changes (all in plan-02).
- Skill doc updates, the complexity playbook, the measurement tooling, the plugin version bump (all in plan-03).
- The pre-existing `agentRuntime` divergence between the MCP tool schema and the input-package schema (flagged in source assumption #8) — left alone, orthogonal to this work.

## Files

### Create
- `test/session-plan-from-playbook.test.ts` — focused tests for `createSessionPlanFromPlaybookSeed` (seeded sections, frontmatter fields, rejects autonomous playbook). Can be skipped if author places these cases in `test/session-plan.test.ts` instead.

### Modify
- `packages/input/src/playbook.ts` — schema gains `mode`, helper additions and alias removal as described.
  - Line 53-62: add `mode: z.enum(['autonomous', 'planning'])` to `playbookFrontmatterSchema`.
  - Line 14-20: refresh the file-header comment block to drop the alias mention and document `playbookToPlanSeed`.
  - Line 124-148: extend `SessionPlanInput` doc comment to note autonomous-only.
  - Around line 566 (`playbookToBuildSource`): add a typed-error guard for `mode !== 'autonomous'` and export a `PlaybookModeMismatchError` class.
  - Add `playbookToPlanSeed(playbook: Playbook)` after `playbookToBuildSource`.
  - Line 604: delete the `playbookToSessionPlan` alias.
  - Export `PlaybookMode = z.output<typeof playbookFrontmatterSchema>['mode']` alongside `PlaybookFrontmatter`.
- `packages/input/src/session-plan.ts` — add `seeded_from_playbook` to schema (line 64-78) and add `createSessionPlanFromPlaybookSeed` near `createSessionPlan` (line 590).
- `packages/input/src/index.ts` — drop the `playbookToSessionPlan` re-export on line 49; add `playbookToPlanSeed`, `PlaybookMode`, `PlaybookModeMismatchError`, and `createSessionPlanFromPlaybookSeed` to the re-export list.
- `packages/monitor/src/server.ts` — line 3346: `import { loadPlaybook, playbookToBuildSource }`. Line 3356: `const plan = playbookToBuildSource(playbook);`. No other change in this plan.
- `eforge/playbooks/docs-implementation-sync.md` — add `mode: autonomous` to frontmatter.
- `eforge/playbooks/plugin-pi-parity-audit.md` — add `mode: autonomous` to frontmatter.
- `test/playbook.test.ts` — add cases: (a) missing `mode` fails parsing with a field-named error; (b) invalid `mode` value fails parsing; (c) round-trip of both modes via `parsePlaybook` → `serializePlaybook`; (d) `playbookToBuildSource` throws `PlaybookModeMismatchError` for a planning playbook; (e) `playbookToPlanSeed` throws for an autonomous playbook; (f) `playbookToPlanSeed` populates the `sections` Map with lowercase-heading keys matching the section parser (`'goal'`, `'out of scope'`, `'acceptance criteria'`, `'notes from playbook'`). Update any existing fixture playbooks built programmatically without `mode` to add explicit `mode: 'autonomous'`.
- `test/session-plan.test.ts` (or new `test/session-plan-from-playbook.test.ts`) — add cases: (a) `createSessionPlanFromPlaybookSeed` returns a `SessionPlan` with `seeded_from_playbook` populated, `status: 'planning'`, `planning_type: 'unknown'`, `planning_depth: 'focused'`; (b) the body contains exactly the four expected headings (`## Goal`, `## Out of scope`, `## Acceptance criteria`, `## Notes from playbook`) with the playbook content; (c) `sessionPlanFrontmatterSchema` accepts and round-trips `seeded_from_playbook`; (d) absence of `seeded_from_playbook` continues to parse (optional field).

## Verification

- [ ] `pnpm type-check` passes with zero errors across all workspaces (including monitor, which now imports `playbookToBuildSource`).
- [ ] `pnpm test` passes; the new playbook-test and session-plan-test cases are present and green.
- [ ] `grep -rn 'playbookToSessionPlan' packages/ test/` returns zero hits (the alias is gone).
- [ ] `grep -rn '^---$' eforge/playbooks/docs-implementation-sync.md eforge/playbooks/plugin-pi-parity-audit.md` finds the open/close frontmatter delimiters and the frontmatter contains a `mode: autonomous` line in each file.
- [ ] Loading either bundled playbook via `loadPlaybook` from a vitest fixture returns a `Playbook` with `mode === 'autonomous'`.
- [ ] A unit test asserts that `playbookFrontmatterSchema.safeParse` of a raw frontmatter object lacking `mode` returns `{ success: false }` with an issue whose `path` includes `'mode'`.
- [ ] A unit test asserts that `playbookFrontmatterSchema.safeParse` of a frontmatter object with `mode: 'invalid'` returns `{ success: false }`.
- [ ] A unit test asserts that `createSessionPlanFromPlaybookSeed` produces a body where `parseSections` returns a Map containing the lowercase keys `'goal'`, `'out of scope'`, `'acceptance criteria'`, `'notes from playbook'`, and that the `'acceptance criteria'` key maps to the playbook's `acceptanceCriteria` content (verifying the slug-match against the `acceptance-criteria` dimension's section key).
