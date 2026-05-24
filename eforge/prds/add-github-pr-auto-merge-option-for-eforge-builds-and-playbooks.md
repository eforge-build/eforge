---
title: Add GitHub PR Auto-Merge Option for eforge Builds and Playbooks
created: 2026-05-24
profile: gpt-claude-combo
landing: pr
---

# Add GitHub PR Auto-Merge Option for eforge Builds and Playbooks

## Problem / Motivation

Users can currently choose whether a completed build opens a PR, locally merges, or leaves a branch, but PR landing stops after PR creation. Teams with required checks often want eforge to create the PR and then enable GitHub auto-merge so the branch lands automatically once branch protection and CI pass.

Today the only “automatic merge” option is `landing.action: merge`, which performs a local/direct merge and is intentionally guarded on trunk by `build.allowLocalMergeToTrunk`. Using that for GitHub PR auto-merge would be ambiguous and could train users toward the wrong safety model.

The gap affects both primary interactive enqueue paths:

- Native/skill-driven `/eforge:build`
- Autonomous `/eforge:playbook run`

Evidence:

- `docs/roadmap.md` has no explicit auto-merge item. The change fits the Integration & Maturity direction by improving lifecycle coverage, but it is not currently tracked there.
- Existing landing vocabulary is `pr | merge | leave` across engine, daemon API, CLI/MCP, Pi extension, and skills:
  - `packages/engine/src/config.ts`
  - `packages/client/src/routes.ts`
  - `packages/eforge/src/cli/landing-options.ts`
  - `packages/pi-eforge/extensions/eforge/landing-policy.ts`
  - `packages/pi-eforge/skills/eforge-build/SKILL.md`
  - `packages/pi-eforge/skills/eforge-playbook/SKILL.md`
- Current `merge` means local/direct merge of the artifact branch into the base branch, not GitHub PR auto-merge.
- Direct trunk merge is separately guarded by `build.allowLocalMergeToTrunk`.
- Current `pr` landing creates or finds a PR only.
  - Non-stacked path: `executeLandingAction()` calls `worktreeManager.issuePr({ baseBranch })`, which pushes and runs `gh pr create --base ... --head ... --fill` via `createPullRequest()` in `packages/engine/src/worktree-ops.ts`.
  - Stacked path: `packages/engine/src/stacking/landing.ts` submits via git-spice and discovers the PR URL.
- Pi native `/eforge:build` and autonomous `/eforge:playbook run` already share a unified selector through:
  - `packages/pi-eforge/extensions/eforge/landing-gate.ts`
  - `packages/pi-eforge/extensions/eforge/landing-policy.ts`
- Tests already exist in:
  - `test/pi-landing-policy.test.ts`
  - `test/pi-build-command.test.ts`
  - `test/pi-playbook-commands.test.ts`
- User-facing skill docs duplicate the landing selector behavior for both Pi and Claude Code plugin surfaces:
  - `packages/pi-eforge/skills/eforge-build/SKILL.md`
  - `packages/pi-eforge/skills/eforge-playbook/SKILL.md`
  - `eforge-plugin/skills/playbook/playbook.md`
  - related config/init docs
- Config docs are generated from `packages/docs-gen/src/generators/config.ts`.
- Config parsing/resolution tests exist in:
  - `test/onsuccess-config.test.ts`
  - `test/stack-config.test.ts`

Interpretation:

- “Auto-merge” should mean **GitHub PR auto-merge after PR creation**, distinct from the existing `landing.action: merge` direct local merge behavior.
- Reusing `merge` would be ambiguous and unsafe because it already has a concrete meaning.
- A cleaner config shape than overloading `landing.action` is a nested PR policy, for example:

```yaml
landing:
  pr:
    autoMerge: ask # ask | always | never
```

Where:

- `ask` means show the option in interactive landing selectors.
- `always` means PR landing enables auto-merge by default/non-interactively.
- `never` hides/disallows it.

Confirmed assumptions:

- Auto-merge means GitHub PR auto-merge after PR creation, not eforge’s existing local `merge` landing action.
- Failure to enable auto-merge should warn and leave the PR open rather than fail landing.

## Goal

Add a distinct GitHub PR auto-merge option for eforge PR landings, available from `/eforge:build` and `/eforge:playbook run`, with configurable availability/default behavior.

The feature should preserve existing landing semantics: `landing.action: merge` continues to mean local/direct merge, while GitHub auto-merge is modeled as a PR post-creation option.

## Approach

### High-Level Design

1. Keep `landing.action` as the publication action only.

   - Values remain `pr | merge | leave`.
   - Do not add `auto-merge` as a fourth action because it would be a subtype of `pr`, not a peer to `pr`.
   - Rationale: existing `merge` means local/direct merge and is guarded by trunk policy; changing or overloading that meaning would be unsafe.

2. Add a nested PR policy:

```yaml
landing:
  action: pr
  pr:
    autoMerge: ask   # ask | always | never
    # optional future-proofing, if desired in this slice:
    # autoMergeMethod: merge   # merge | squash | rebase
```

Policy behavior:

- `ask`: interactive selectors offer auto-merge as a PR variant.
- `always`: effective PR landings enable auto-merge without prompting, useful for projects that always want branch-protection-gated landing.
- `never`: selectors hide auto-merge and explicit requests are rejected or downgraded with a clear warning/event.

Default recommendation:

- `ask` is the recommended product default because the user explicitly asked to include the option when selecting PR landing.
- `never` would be more conservative if avoiding a new visible choice by default matters more.

3. Represent per-run intent separately from `landingAction`.

Recommended request/frontmatter fields:

- API/tool request: `landingAutoMerge?: boolean`
- PRD frontmatter: `landing_auto_merge: true|false`
  - Only meaningful when `landing: pr`
- Build/options/context: `landingAutoMerge?: boolean`

Effective behavior:

```ts
const effectiveLandingAction = explicitLandingAction ?? prd.frontmatter.landing ?? config.landing.action;
const policy = config.landing.pr.autoMerge;
const requestedAutoMerge = explicitLandingAutoMerge ?? prd.frontmatter.landing_auto_merge;
const effectiveAutoMerge = effectiveLandingAction === 'pr' && (
  policy === 'always' ? requestedAutoMerge !== false :
  policy === 'ask' ? requestedAutoMerge === true :
  false
);
```

If `policy === 'never'` and an explicit request is true:

- Prefer rejecting during enqueue/config validation when possible.
- Engine should still defensively skip and emit a reason if such a PRD exists.

4. Selector UX should avoid a second prompt when possible.

Recommended menu shape when auto-merge is available:

- Use project default — description includes current `landing.action` and PR auto-merge policy/effective behavior.
- Open PR
- Open PR and enable auto-merge
- Merge to base branch
- Leave branch
- Cancel

When protected trunk excludes direct merge, the remediation menu should still include safe PR variants:

- Open PR
- Open PR and enable auto-merge, when policy permits
- Leave branch
- Update config to allow local trunk merges, if config path known
- Cancel

5. Engine should enable GitHub auto-merge after PR creation or existing-PR discovery.

- Non-stacked PR path:
  - After `worktreeManager.issuePr({ baseBranch })` returns `{ url }`, call a new helper around `gh pr merge <url-or-branch> --auto --merge`.
- Existing PR path:
  - If `issuePr()` returns an existing PR URL, still attempt auto-merge when requested.
- Stacked path:
  - After git-spice submit and PR URL discovery, attempt the same helper if a PR URL is available.
  - If no PR URL can be discovered, emit skipped with reason.
- Failures should be visible but non-fatal:
  - If PR creation/discovery succeeds but enabling GitHub auto-merge fails, eforge should warn/emit a skipped event and leave the PR open.
  - The PR landing itself remains successful.

6. Eventing should be additive and typed in `@eforge-build/client`.

Suggested new events:

- `landing:auto-merge:start`
  - `featureBranch`
  - `baseBranch`
  - `prUrl?`
- `landing:auto-merge:complete`
  - `featureBranch`
  - `baseBranch`
  - `prUrl?`
- `landing:auto-merge:skipped`
  - `featureBranch`
  - `baseBranch`
  - `reason`
  - `prUrl?`

This avoids overloading `landing:complete` and gives monitor/timeline consumers clear status.

7. Keep Pi and Claude Code plugin parity.

`AGENTS.md` requires `eforge-plugin/` and `packages/pi-eforge/` to stay in sync for consumer-facing behavior.

- The Pi native extension can provide the richer selector.
- The skills/plugin docs must expose equivalent choices and request fields.

### Likely Code Impact

Engine/config:

- `packages/engine/src/config.ts`
  - Extend `landingConfigSchema` with nested `pr.autoMerge` policy.
  - Extend resolved `LandingConfig` and `DEFAULT_CONFIG`.
  - Resolve default policy in `resolveConfig()`.
- `test/onsuccess-config.test.ts`
- `test/stack-config.test.ts`
  - Add schema/default/valid-value coverage.

Engine PR landing:

- `packages/engine/src/worktree-ops.ts`
  - Add helper for `gh pr merge <selector> --auto --<method>` or equivalent.
  - Keep `ensureGhAvailable()` reuse.
- `packages/engine/src/worktree-manager.ts`
  - Add method to enable auto-merge for the created/existing PR, likely using PR URL or branch.
- `packages/engine/src/landing.ts`
  - Carry effective PR auto-merge intent in `LandingActionOptions`.
  - Enable auto-merge after `issuePr()` succeeds when `action === 'pr'`.
  - Emit additive lifecycle events or fields for auto-merge start/complete/skipped.
- `packages/engine/src/eforge.ts`
- `packages/engine/src/orchestrator.ts`
- `packages/engine/src/orchestrator/phases.ts`
- `packages/engine/src/prd-queue.ts`
- `packages/engine/src/events.ts`
  - Carry explicit auto-merge override through build/enqueue options, queued PRD frontmatter, and orchestration context.

Client/daemon/API:

- `packages/client/src/routes.ts`
  - Add request fields for enqueue and playbook run, e.g. `landingAutoMerge?: boolean`.
- `packages/client/src/events.schemas.ts`
  - Add wire event schema for auto-merge lifecycle.
  - This is the source of truth per `AGENTS.md`.
- `packages/client/src/event-registry.ts`
  - Update only if new events need display/summary state.
- Monitor reducers/UI:
  - Update only if new events need display/summary state.
- `packages/monitor/src/server.ts`
  - Validate and forward `landingAutoMerge` for `/api/enqueue` and `/api/playbook/run`.

Pi integration and docs:

- `packages/pi-eforge/extensions/eforge/landing-policy.ts`
  - Extend pure policy model with auto-merge choices depending on config policy.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts`
  - Load resolved config.
  - Pass auto-merge policy into the model.
  - Return both `landingAction` and `landingAutoMerge`.
- `packages/pi-eforge/extensions/eforge/build-command.ts`
  - Append a new skill arg for explicit auto-merge selection or call the tool directly if command args cannot represent it cleanly.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
  - Include `landingAutoMerge` in playbook run request bodies.
- `packages/pi-eforge/extensions/eforge/index.ts`
  - Extend `eforge_build` and `eforge_playbook` tool schemas/descriptions if the custom tools expose the override.
- `packages/pi-eforge/skills/eforge-build/SKILL.md`
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md`
- `packages/pi-eforge/skills/eforge-config/SKILL.md`
- `packages/pi-eforge/skills/eforge-init/SKILL.md`
  - Document selector/config behavior.
- Mirror equivalent user-facing docs in `eforge-plugin/skills/...` per `AGENTS.md` sync requirement.

CLI/MCP/docs:

- `packages/eforge/src/cli/index.ts`
- `packages/eforge/src/cli/run-or-delegate.ts`
- `packages/eforge/src/cli/mcp-proxy.ts`
- `packages/eforge/src/cli/landing-options.ts`
  - Add `--landing-auto-merge`/`--no-landing-auto-merge` or equivalent.
  - Add MCP schema support.
- `packages/docs-gen/src/generators/config.ts`
  - Update generated docs after `pnpm docs:generate`.

Tests already discovered:

- `test/pi-landing-policy.test.ts`
  - Selector menu shape.
- `test/pi-build-command.test.ts`
  - `/eforge:build` argument propagation.
- `test/pi-playbook-commands.test.ts`
  - Playbook run body propagation.

Evidence confidence:

- High for these impact areas because searches found the current landing action type/request/selector definitions there.
- Medium for monitor UI impact; additive events may require reducer updates only if displayed beyond timeline/event registry.

### Assumptions and Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| “Auto-merge” means GitHub PR auto-merge after PR creation, not eforge’s existing local `merge` landing action. | Existing code/docs use `merge` for direct local merge and `pr` for PR creation. User confirmed: “yes, github auto-merge after pr.” | High | None | Confirmed by user. | High: implementing the wrong semantics could produce unsafe direct merges or a confusing UX. |
| Config should be nested under `landing.pr` rather than as a new `landing.action` value. | Current `landing.action` is consistently modeled as `pr | merge | leave` across config, API, CLI, engine, and docs. Auto-merge is a property of PR publication. | High | Low | Review with user/product owner; compare docs wording. | Medium: a fourth action would cause wider churn and semantic ambiguity. |
| `landing.pr.autoMerge: ask | always | never` is clearer than `allow | defaultYes | disallow`. | It names behavior directly: ask interactively, always enable for PR, never permit. Similar three-state policy covers availability and default. | Medium | Low | Confirm naming preference; optionally choose `prompt | always | never` if codebase favors “prompt.” | Low-medium: poor enum names are annoying but easy to migrate before release. |
| GitHub CLI supports enabling auto-merge with `gh pr merge --auto` after PR creation/discovery. | General knowledge; not validated against installed `gh` docs in this session. Existing code already depends on `gh pr create/view`. | Medium | Low | Run `gh pr merge --help` locally or check GitHub CLI docs during implementation. | Medium: command flags may need adjustment (`--merge`/`--squash`/`--rebase`, PR URL vs branch selector). |
| Stacked PR auto-merge can be attempted after git-spice submit if a PR URL is discovered. | `packages/engine/src/stacking/landing.ts` already parses/discovers a PR URL after submit. | Medium | Medium | Test against a git-spice/GitHub repo or isolate command construction around discovered URL. | Medium: if unsupported, stacked builds need a documented skipped reason rather than silent failure. |
| Auto-merge failure should warn and leave the PR open rather than fail landing. | User confirmed: “warn and leave pr open.” | High | None | Confirmed by user. | Medium: implementation should avoid marking the whole PR landing failed when only auto-merge enablement failed. |
| Pi and Claude Code plugin docs must both change. | `AGENTS.md` explicitly requires `eforge-plugin/` and `packages/pi-eforge/` to stay in sync for consumer-facing behavior. | High | None | N/A | High: shipping one surface only creates drift. |

The two previously material assumptions are now confirmed:

- Auto-merge means GitHub PR auto-merge after PR creation.
- Failure to enable auto-merge should warn while leaving the PR open rather than failing landing.

### Profile Signal

Recommended profile: **Excursion**.

Rationale:

- This is a cohesive feature across config, API/request plumbing, engine landing behavior, Pi/plugin UX docs, and tests.
- It is multi-file and cross-package, but one planner can enumerate the dependency chain and interfaces without delegated module planning.
- It does not require Expedition unless the implementation expands into broader provider-agnostic PR lifecycle management.

## Scope

### In Scope

1. Add a distinct PR auto-merge policy/configuration separate from `landing.action`.

   Recommended config shape:

   ```yaml
   landing:
     pr:
       autoMerge: ask # ask | always | never
   ```

   Behavior:

   - `ask`: interactive selectors may offer both “Open PR” and “Open PR + enable auto-merge”; no auto-merge in non-interactive PR landings unless explicitly requested.
   - `always`: PR landings request auto-merge by default, including non-interactive builds, unless an explicit per-run override disables it if that override is supported.
   - `never`: hide/disallow auto-merge options and ignore or reject explicit auto-merge requests with a clear error.

2. Add a per-build/per-playbook-run way to request PR auto-merge, carried from interactive selectors through daemon enqueue/playbook-run request bodies into queued PRD/frontmatter/build options.

3. Update native Pi `/eforge:build` and autonomous `/eforge:playbook run` selectors to expose the auto-merge variant when policy permits it.

4. Update the corresponding skill docs in both consumer-facing integration packages so non-native flows and Claude Code plugin flows stay in sync:

   - `packages/pi-eforge/`
   - `eforge-plugin/`

5. Implement engine support for enabling auto-merge after PR creation/discovery on PR landings, including existing-PR handling.

6. Add tests for:

   - Config parsing/defaults
   - Selector policy
   - Request propagation
   - PR auto-merge command invocation

7. Update generated/reference config docs and examples.

### Out of Scope

- Changing the meaning of existing `landing.action: merge`.
- Automatically enabling local direct merges to trunk; `build.allowLocalMergeToTrunk` remains separate.
- Building a full GitHub merge-queue manager or polling for PR completion.
- Provider-agnostic auto-merge support beyond the existing GitHub CLI PR path.
  - If stacked git-spice PRs can use `gh pr merge --auto` after PR URL discovery, include them.
  - Otherwise document the limitation and emit a skipped event/reason.
- Adding a new top-level landing action such as `auto-merge`, because that would mix publication mode (`PR` vs local merge vs leave) with a PR post-creation option.

## Acceptance Criteria

### Functional Criteria

1. Users selecting landing behavior for native `/eforge:build` can choose “Open PR and enable auto-merge” when config policy permits it.
2. Users running an autonomous playbook through `/eforge:playbook run` can choose the same auto-merge PR option, and the choice is carried into every enqueue path including:
   - Immediate run
   - Delayed run with `afterQueueId`
   - Fallback re-enqueue if the selected upstream build already finished
3. The existing options continue to work as before:
   - Project default
   - PR without auto-merge
   - Direct merge
   - Leave
   - Cancel
4. `landing.action: merge` still means local/direct merge and remains governed by `build.allowLocalMergeToTrunk`; GitHub PR auto-merge is not represented by `landing.action: merge`.
5. A project config can control PR auto-merge availability/default behavior with a clear enum such as `landing.pr.autoMerge: ask | always | never`.
6. When policy is `never`, interactive selectors do not offer the auto-merge option and explicit auto-merge requests are rejected or skipped with a clear diagnostic.
7. When policy is `always` and effective landing is `pr`, PR auto-merge is enabled without requiring interactive selection.
8. When policy is `ask`, PR auto-merge is enabled only when explicitly selected/requested; selecting plain PR creates/uses a PR without enabling auto-merge.
9. Non-stacked PR landing enables auto-merge after creating or finding the PR.
10. Stacked PR landing either:
    - Enables auto-merge after git-spice submission and PR URL discovery, or
    - Emits a clear skipped reason if this cannot be supported safely.
11. Auto-merge command failures are surfaced in typed events/warnings, but do not fail landing when the PR was created or found successfully; eforge leaves the PR open.
12. CLI/MCP/API surfaces can express the auto-merge override for both build enqueue and autonomous playbook run.
13. Pi and Claude Code plugin skill docs describe the same behavior and options.

### Validation Criteria

- Unit tests cover config schema/defaults for the new policy.
- Unit tests cover landing selector choices for `ask`, `always`, and `never`, including protected-trunk remediation menus.
- Unit tests cover `/eforge:build` command propagation of the auto-merge override.
- Unit tests cover `/eforge:playbook run` propagation in immediate, delayed, and fallback enqueue paths.
- Engine tests cover PR auto-merge command construction and existing-PR handling without calling live GitHub.
- Wire schema tests cover any new event variants/request fields.
- `pnpm type-check` and targeted tests pass.
- Run full `pnpm test` if time permits.
- Generated docs are updated if config reference output changes:
  - `pnpm docs:generate`
  - `pnpm docs:check`
