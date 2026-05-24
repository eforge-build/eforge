---
id: plan-01-core-engine-auto-merge
name: Core Config, Wire Events, and Engine PR Auto-Merge
branch: add-github-pr-auto-merge-option-for-eforge-builds-and-playbooks/plan-01-core-engine-auto-merge
agents:
  builder:
    effort: high
    rationale: This plan changes cross-package TypeScript contracts, engine landing
      behavior, GitHub CLI command invocation, and stacked PR integration.
  reviewer:
    effort: high
    rationale: Review needs extra attention to API compatibility, subprocess command
      construction, non-fatal error handling, and event schema exhaustiveness.
---

# Core Config, Wire Events, and Engine PR Auto-Merge

## Architecture Context

`landing.action` remains the publication action with values `pr | merge | leave`. GitHub PR auto-merge is a PR post-creation option controlled by `landing.pr.autoMerge` and an optional per-run `landingAutoMerge` / `landing_auto_merge` intent. The engine must enable GitHub auto-merge after PR creation or discovery, and failures to enable auto-merge must emit typed warnings/events without failing PR landing.

## Implementation

### Overview

Add the core configuration policy, wire event variants, PRD/frontmatter plumbing, and engine execution path for GitHub PR auto-merge. This plan does not add Pi selector UX or CLI flags; it creates the contracts and engine behavior those surfaces use.

### Key Decisions

1. Keep `landing.action` unchanged as `pr | merge | leave`; add nested `landing.pr.autoMerge: ask | always | never` with default `ask`.
2. Store per-run intent as optional booleans: request/build option `landingAutoMerge?: boolean` and PRD frontmatter `landing_auto_merge?: boolean`.
3. Resolve effective auto-merge inside the engine from action, policy, and requested intent: `always` enables for PR unless explicitly false; `ask` enables only when explicitly true; `never` disables and emits a skipped reason when explicitly requested.
4. Add typed session events `landing:auto-merge:start`, `landing:auto-merge:complete`, and `landing:auto-merge:skipped` with `featureBranch`, `baseBranch`, optional `prUrl`, and skipped `reason`.
5. Use `gh pr merge <pr-url-or-branch> --auto --merge` after PR creation/existing-PR discovery. Treat command failure as non-fatal once PR landing has succeeded.

## Scope

### In Scope

- Config schema, default config, resolved config type, and config tests for `landing.pr.autoMerge`.
- Optional request/frontmatter/build/orchestrator fields for PR auto-merge intent.
- Engine auto-merge execution for non-stacked PR landings, including existing PR URLs returned by `issuePr()`.
- Stacked PR auto-merge after git-spice submit when a PR URL is discovered; emit a skipped event when no PR URL is available.
- Typed client event schemas and event registry entries for the new lifecycle events.
- Unit/integration tests for config parsing, PRD frontmatter, auto-merge command construction, non-fatal failure, existing PR handling, and stacked skipped/attempted behavior.

### Out of Scope

- Pi selector UX and request propagation from CLI/daemon tools.
- User-facing skill docs and generated docs.
- Provider-agnostic auto-merge implementations beyond the GitHub CLI PR path.
- Auto-merge method configuration; use GitHub merge commits via `--merge` for this slice.

## Files

### Create

- `test/pr-auto-merge.test.ts` — focused tests for the new GitHub CLI auto-merge helper and/or WorktreeManager wrapper without live GitHub.

### Modify

- `packages/engine/src/config.ts` — add `landing.pr.autoMerge` schema, exported policy type if useful, default `ask`, resolved `LandingConfig.pr.autoMerge`, and a helper such as `resolvePrAutoMergeIntent(action, requested, policy)` returning enabled/denied state.
- `packages/engine/src/events.ts` — add `landingAutoMerge?: boolean` to `BuildOptions` and `EnqueueOptions`.
- `packages/client/src/routes.ts` — add optional `landingAutoMerge?: boolean` to `EnqueueRequest` and `PlaybookRunRequest` so downstream packages can compile against the field.
- `packages/client/src/events.schemas.ts` — add the three `landing:auto-merge:*` event variants.
- `packages/client/src/event-registry.ts` — register the new event variants as session-scoped, non-persisted events with summaries.
- `packages/client/src/api-version.ts` — bump daemon API version and annotate that new PR auto-merge event variants/request fields were added.
- `packages/client/src/__tests__/events-schemas.test.ts` — add schema coverage for the new event variants and optional request fields if this test file owns route payload examples.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — update parity fixtures for the new event variants.
- `packages/engine/src/prd-queue.ts` — add `landing_auto_merge` to `prdFrontmatterSchema`, `PrdFrontmatter`, `EnqueuePrdOptions`, generated frontmatter object, and YAML serialization.
- `packages/engine/src/eforge.ts` — carry `landingAutoMerge` through enqueue, queue execution, child process args, build options, PRD frontmatter precedence, and effective auto-merge resolution before constructing the orchestrator.
- `packages/engine/src/orchestrator.ts` — add `landingAutoMerge?: boolean` to `OrchestratorOptions` and `PhaseContext`.
- `packages/engine/src/orchestrator/phases.ts` — pass auto-merge intent into `executeLandingAction()` and `executeStackLanding()`; preserve artifact/landing success behavior when auto-merge fails.
- `packages/engine/src/landing.ts` — add `landingAutoMerge?: boolean` to `LandingActionOptions`, emit auto-merge lifecycle events around PR landing, and return PR landing success even when auto-merge enablement fails.
- `packages/engine/src/worktree-ops.ts` — add `enablePullRequestAutoMerge(cwd, selector)` that ensures `gh` is available and runs `gh pr merge <selector> --auto --merge`.
- `packages/engine/src/worktree-manager.ts` — add `enablePrAutoMerge(prUrlOrBranch)` wrapper using the merge worktree path.
- `packages/engine/src/stacking/landing.ts` — add `landingAutoMerge?: boolean` option; after PR URL discovery, call the auto-merge helper or emit skipped when no URL is discovered; keep stack landing complete when auto-merge fails.
- `test/onsuccess-config.test.ts` — assert default `landing.pr.autoMerge` is `ask`, valid enum values parse, invalid values fail, and action semantics stay unchanged.
- `test/stack-config.test.ts` — assert nested landing PR config resolves with stack config and does not alter `landing.action` validation.
- `test/prd-frontmatter-onsuccess.test.ts` and/or `test/prd-queue-enqueue.test.ts` — cover `landing_auto_merge: true|false` parsing and enqueue serialization.
- `test/landing-actions.test.ts` — cover non-stacked PR auto-merge events, existing PR URL handling, and non-fatal `gh pr merge` failure with fake `gh` shims.
- `test/stack-runtime-landing.test.ts` and/or `test/stack-landing-cleanup.test.ts` — cover stacked auto-merge attempt when PR URL is present and skipped event when absent.

## Verification

- [ ] `resolveConfig({ landing: { pr: { autoMerge: 'always' } } }, {}).landing.pr.autoMerge` returns `always`.
- [ ] `eforgeConfigSchema.safeParse({ landing: { pr: { autoMerge: 'sometimes' } } }).success` is `false`.
- [ ] A PRD enqueued with `landingAutoMerge: false` serializes `landing_auto_merge: false` in frontmatter.
- [ ] Non-stacked PR landing with auto-merge enabled runs `gh pr merge <pr-url> --auto --merge` after `gh pr create` or `gh pr view` returns a URL.
- [ ] When fake `gh pr merge` exits non-zero after PR creation, emitted events include `landing:auto-merge:skipped` and `landing:complete`, and the returned `LandingResult.landingSucceeded` is `true`.
- [ ] Stacked PR landing with auto-merge enabled and no discovered PR URL emits `landing:auto-merge:skipped` with a reason mentioning PR URL discovery.
- [ ] New `landing:auto-merge:*` events pass `safeParseEforgeEvent` in client schema tests.
