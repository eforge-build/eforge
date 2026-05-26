---
id: plan-01-recover-completed-console-branch
name: Recover Completed Console Branch on Current Main
branch: complete-eforge-console-recovery-after-partial-expedition-build/plan-01-recover-completed-console-branch
agents:
  builder:
    effort: high
    rationale: This plan is primarily a branch reconciliation step that must
      preserve existing completed work while resolving any drift from current
      main without broad rewrites.
  reviewer:
    effort: high
    rationale: Review must confirm that completed feature-branch work was preserved,
      not reimplemented or dropped.
---

# Recover Completed Console Branch on Current Main

## Architecture Context

The current recovery work must continue from the existing feature branch `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`, which already contains completed Console shell, Now dashboard, Activity/audit, Runs/build entrypoints, and System configuration work. The current recovery base is current `main`, so the first implementation step is to reconcile the completed feature branch with current main before filling the two failed scopes.

Evidence to retain in implementation notes or commit context:

- Failed run: `.eforge/monitor.db` run `03ea77d4-8b69-4774-ba3e-0ac30635468b`.
- Completed plans: `plan-01-console-shell`, `plan-02-activity-audit-view`, `plan-03-now-dashboard`, `plan-05-runs-build-entrypoints`, `plan-07-system-configuration-view`.
- Failed plans: `plan-04-queue-view`, `plan-06-static-serving-package-integration`.
- Failed-plan agents hit transient Claude API 529 before tool-use events.
- The sidecar `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.recovery.md` is partial and omits `plan-04-queue-view`.

## Implementation

### Overview

Bring the completed feature-branch tree into the recovery branch before any new feature work. Prefer a real git merge or no-commit merge from `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui` so the completed branch remains the source of truth. Do not recreate the five completed plans from scratch.

Suggested flow for the builder:

1. Confirm the working tree is clean.
2. Confirm the source branch exists: `git branch --list eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`.
3. Inspect merge feasibility with `git merge-tree --write-tree HEAD eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`.
4. Merge the source branch into the recovery worktree without manually committing. If the harness supports preserving merge state, use `git merge --no-ff --no-commit eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui` and leave the merge for the eforge commit step.
5. Resolve any conflicts by preserving current-main changes and applying the feature-branch additions. Known possible areas are `AGENTS.md`, `packages/client/src/browser.ts`, package manifests, and `pnpm-lock.yaml`.
6. Record the recovery evidence listed above in implementation notes or commit context.

If the harness cannot preserve a merge state, copy the completed feature-branch file tree into the plan branch and record the five completed commit SHAs in implementation notes: `53c2b148`, `d2628bb8`, `bac3a059`, `baf35e7f`, `4a56902b`.

### Key Decisions

1. **Recover before implementing missing scopes.** The missing Queue and static-serving plans depend on the Console package and shell created by completed work.
2. **Keep completed code intact.** Modify completed plan files only for current-main compatibility, build failures, or type errors.
3. **Use monitor DB evidence as the recovery inventory.** Do not treat the partial sidecar as the list of remaining work.
4. **Keep the recovery project-local.** Do not add multi-project or Overseer language while reconciling docs or UI copy.

## Scope

### In Scope

- Bring `packages/console-ui` from the existing feature branch onto current main.
- Preserve original planning artifacts under `eforge/plans/add-eforge-console-side-by-side-with-legacy-monitor-ui/`.
- Preserve the original PRD provenance artifact if present on the feature branch.
- Preserve feature-branch additions to `packages/client/src/browser.ts` that completed plans require.
- Preserve lockfile entries for the existing Console package dependencies.
- Reconcile conflicts from current main with minimal compatibility edits.
- Leave the Queue route placeholder in place for plan 02.
- Leave monitor static serving at legacy `/` only for plan 03.

### Out of Scope

- Re-running the original Expedition.
- Reimplementing completed plans 01, 02, 03, 05, or 07.
- Implementing Queue view files.
- Implementing `/console/` static serving, package-copy changes, root scripts, or legacy monitor links.
- Adding queue mutation, priority editing, stack-sync controls, multi-project UI, or new daemon wire shapes.

## Files

### Create or Restore from Existing Feature Branch

- `packages/console-ui/**` — completed Console package, shell, Now dashboard, Activity/audit view, Runs view, System view, tests, Vite config, TypeScript config, and styling.
- `eforge/plans/add-eforge-console-side-by-side-with-legacy-monitor-ui/**` — original Expedition architecture, modules, compiled plan files, and orchestration artifacts.
- `eforge/prds/add-eforge-console-side-by-side-with-legacy-monitor-ui.md` — original PRD provenance artifact if present on the feature branch.

### Modify

- `AGENTS.md` — preserve completed-branch guidance mentioning `packages/console-ui` and browser-safe client route constants if not already present on current main.
- `packages/client/src/browser.ts` — preserve completed-branch browser-safe exports required by Console System view.
- `pnpm-lock.yaml` — preserve Console package importer and dependency entries from the completed branch; regenerate only if merge drift requires it.

## Verification

- [ ] `git log --oneline --decorate --all --grep='plan-01-console-shell'` shows the completed Console shell commit is still reachable from a local ref.
- [ ] `packages/console-ui/package.json` exists and has `"name": "@eforge-build/console-ui"`.
- [ ] `packages/console-ui/vite.config.ts` contains `base: '/console/'`.
- [ ] `packages/console-ui/src/components/shell/sidebar.tsx` contains a link with `href="/"` and accessible text or label containing `Monitor`.
- [ ] `packages/console-ui/src/app.tsx` still renders the Queue route placeholder before plan 02.
- [ ] `packages/monitor/src/server.ts` still serves only the legacy `UI_DIR` before plan 03.
- [ ] Implementation notes or commit context name run `03ea77d4-8b69-4774-ba3e-0ac30635468b` and identify failed plans `plan-04-queue-view` and `plan-06-static-serving-package-integration`.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0 after reconciliation or any compatibility fixes.
