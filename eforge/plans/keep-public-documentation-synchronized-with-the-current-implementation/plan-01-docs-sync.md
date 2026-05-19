---
id: plan-01-docs-sync
name: Sync public documentation with current implementation
branch: keep-public-documentation-synchronized-with-the-current-implementation/plan-01-docs-sync
---

# Sync public documentation with current implementation

## Architecture Context

Public documentation lives in two places in this repo:

1. **Hand-maintained docs** under `docs/` plus `README.md` and `AGENTS.md` at the repo root. These are written and edited by humans.
2. **Auto-generated reference docs** under `web/content/reference/` (CLI, API, events, config, tools). These are produced by `pnpm docs:generate` from `packages/docs-gen/` and have explicit `Generated file. Do not edit.` headers.

This plan is scoped exclusively to hand-maintained docs. The auto-generated reference under `web/content/reference/` MUST NOT be hand-edited — drift there is fixed by re-running the generator, which is out of scope here.

The source of truth is the current codebase. When in doubt, the code wins; the doc must match the code. The bar is correctness, not exhaustiveness — keep edits minimal and targeted.

## Implementation

### Overview

Inspect each hand-maintained doc file, compare each user-facing claim against the codebase, and correct any drift identified during planner exploration plus any additional drift discovered while implementing. Prefer small surgical edits over rewrites. Do not introduce marketing copy, tutorials, speculative future behavior, or internal implementation details that are not user-facing.

### Confirmed drift (must fix)

The planner identified the following concrete drift items. Each must be addressed:

**1. `AGENTS.md` — workspace package list is missing `extension-sdk`**

In the `## Conventions` section under the bullet starting with `**Workspace layout**:`, the parenthetical packages list reads:

> packages in `packages/` (engine, eforge, monitor, monitor-ui, client, pi-eforge, scopes, input, docs-gen)

Actual `packages/` directory contents (verify with `ls packages/`):

> client, docs-gen, eforge, engine, extension-sdk, input, monitor, monitor-ui, pi-eforge, scopes

Add `extension-sdk` to the parenthetical list. Preserve overall sentence structure.

**2. `README.md` — Pi command native/skill split is incomplete**

The paragraph around line 99 currently reads:

> The Pi package also provides native interactive commands for agent runtime profile management (`/eforge:profile`, `/eforge:profile-new`) and config viewing (`/eforge:config`) with interactive overlay UX.

Actual native command registrations in `packages/pi-eforge/extensions/eforge/index.ts` (search for `pi.registerCommand(`):

- `eforge:profile` — native, calls `handleProfileCommand`
- `eforge:profile:new` — native, calls `handleProfileNewCommand`
- `eforge:config` — native, calls `handleConfigCommand`
- `eforge:playbook` — native, calls `handlePlaybookCommand` (overlay-driven create/edit/run/list/promote/demote menu)
- `eforge:build` — native wrapper: when `ctx.hasUI`, shows a profile-picker overlay then delegates to the `eforge-build` skill; when headless, delegates straight to the skill
- `eforge:status`, `eforge:init`, `eforge:plan`, `eforge:extend`, `eforge:restart`, `eforge:update`, `eforge:recover` — registered as command aliases that delegate to their respective `eforge-*` skills via `pi.sendUserMessage('/skill:eforge-...')`

Update the README paragraph so the native-overlay commands list includes `/eforge:playbook`. Optionally note that `/eforge:build` adds an interactive profile picker on Pi when the UI is available. Keep the wording lean.

**3. `docs/architecture.md` — Pi command native/skill split is incomplete (mirrors README)**

The `### Pi Package` paragraph (around line 121) currently lists native overlay commands as `/eforge:profile`, `/eforge:profile-new`, and `/eforge:config`. Apply the same correction as the README: include `/eforge:playbook` as a native overlay command, and keep `/eforge:build` accurate (native profile-picker wrapper + skill).

**4. `docs/architecture.md` — `Agent roles by function` table does not match `AGENT_ROLE_TIERS`**

The table around line 223 reads:

```
| **Planning** | formatter, planner, module-planner, staleness-assessor, prd-validator, dependency-detector |
| **Building** | builder, doc-author, doc-syncer, test-writer, tester |
| **Review**   | reviewer, parallel-reviewer, review-fixer, plan-evaluator, cohesion-reviewer, architecture-reviewer |
| **Recovery** | validation-fixer, merge-conflict-resolver, gap-closer, recovery-analyst |
```

Issues vs `AGENT_ROLE_TIERS` in `packages/engine/src/pipeline/agent-config.ts` (the authoritative 24-role list, also documented correctly in `docs/config.md`):

- `parallel-reviewer` is NOT a role — it is a module/file (`packages/engine/src/agents/parallel-reviewer.ts`). Remove it.
- Missing roles entirely: `pipeline-composer`, `evaluator`, `architecture-evaluator`, `cohesion-evaluator`, `plan-reviewer`.
- `staleness-assessor`, `prd-validator`, `dependency-detector` live on the `implementation` tier in `AGENT_ROLE_TIERS`, not `planning`. (`docs/config.md` already places them under "Implementation tier" in its built-in table — `architecture.md` should be consistent with that source.)
- `gap-closer` is on the `planning` tier, not in a "Recovery" function group.
- `review-fixer`, `validation-fixer`, `merge-conflict-resolver`, `recovery-analyst` are on the `implementation` or `planning` tiers; the "Recovery" function label is fine as a conceptual grouping but should not be presented as if it maps to a tier.

Rewrite this table so it matches the codebase. Two acceptable shapes:

- **Tier-grouped** (preferred — matches `AGENT_ROLE_TIERS` directly):
  - `Planning`: planner, module-planner, formatter, pipeline-composer, merge-conflict-resolver, gap-closer
  - `Implementation`: builder, doc-author, doc-syncer, review-fixer, validation-fixer, test-writer, tester, recovery-analyst, dependency-detector, prd-validator, staleness-assessor
  - `Review`: reviewer, architecture-reviewer, cohesion-reviewer, plan-reviewer
  - `Evaluation`: evaluator, architecture-evaluator, cohesion-evaluator, plan-evaluator
- **Function-grouped** (keep current labels but fix membership): list 24 real roles only, drop `parallel-reviewer`, add missing roles, and add a sentence clarifying that the function grouping is conceptual while tier assignment is canonical and documented in `docs/config.md`.

Whichever shape is chosen, the table must contain exactly the 24 roles in `AGENT_ROLE_TIERS`, no more, no fewer, and no fictitious entries.

**5. `docs/extensions-api.md` — closing paragraph of `## Runtime support status` contradicts the table immediately above it**

The runtime-support table at lines 938–950 lists `registerValidationProvider` with `Runtime execution today: Yes (per-plan validate build stage)`. The closing paragraph at line 954 still says:

> Validation-provider execution, `beforeEnqueue`, `beforeValidation`, approval workflow/state, and `modify` decisions are future runtime work.

Remove `Validation-provider execution` from the "future runtime work" list. The remaining items (`beforeEnqueue`, `beforeValidation`, approval workflow/state, `modify` decisions) are still deferred per `docs/extensions.md` and the SDK source, so leave those in place.

**6. `docs/daemon-mutation-audit.md` — internal implementation audit not appropriate for public `docs/`**

This file documents an internal mutation audit tied to a specific plan (`plan-01-mutation-sweep`) and references line numbers in `packages/monitor/src/server.ts` as part of a Workstream B refactor. Per the source's out-of-scope rule ("Do not document internal implementation details that are not user-facing") and the acceptance criterion ("Stale, incorrect, or misleading documentation is corrected or removed"), delete this file. It is not referenced by `README.md`, the docs site under `web/`, or other docs in `docs/` — verify with a repo-wide grep before deletion. If a current cross-link is found, fix it (or remove the cross-link) as part of the deletion.

**7. `docs/roadmap.md` — "Native TypeScript extensions" bullet implies extensions are mostly future work**

The bullet currently reads:

> **Native TypeScript extensions** — Typed event hooks, agent context/tool injection, policy gates, input transformers, and limited stage-like APIs (e.g. custom reviewer perspectives) authored as TypeScript modules and discoverable in user/project/project-local scopes. Includes an extension SDK package, a `/eforge:extend` skill in both Pi and Claude Code, CLI/daemon management commands, and event-replay testing. Multi-phase rollout starting with typed event hooks. Depends on TypeBox schema unification. Design in `docs/prd/typescript-extensibility.md`.

Per `docs/extensions.md` and `docs/extensions-api.md`, the following have shipped: `onEvent`, `onAgentRun`, `registerTool` (provenance + per-run injection via `onAgentRun`), `beforeQueueDispatch`/`beforePlanMerge`/`beforeFinalMerge` policy gates, `registerProfileRouter`, `registerInputSource`, `registerPrdEnricher`, `registerReviewerPerspective`, `registerValidationProvider`, the `/eforge:extend` skill, the CLI/daemon management surface (list/show/validate/test/new/reload/trust/untrust/install/update/remove/promote/demote), and event-replay testing. Deferred items per current docs: `beforeEnqueue`, `beforeValidation`, approval workflow/state, and `modify` policy decisions.

Per `AGENTS.md` ("**Future only** — remove items once they ship"), revise this bullet. Two acceptable shapes: (a) remove the bullet entirely and let the topic live in `docs/extensions.md` / `docs/extensions-api.md`, or (b) narrow it to the still-deferred surfaces (approval workflow, `beforeEnqueue`/`beforeValidation`, `modify` decisions). Pick whichever produces a leaner roadmap.

If `docs/prd/typescript-extensibility.md` referenced by the bullet is also a stale design doc, evaluate it the same way (see `docs/prd/` inspection below).

### Sweep (read-and-verify) for remaining hand-maintained docs

Even where the planner did not pre-confirm specific drift, the source requires that every file under `docs/` is inspected. Do at least one careful read of each of the following against the live codebase, and correct any drift found. Do not rewrite for style — fix only factual mismatches against the implementation. Do not introduce new content unless it replaces incorrect content.

- `docs/config.md` — Verify: tier table defaults match `DEFAULT_CONFIG.agents.tiers` in `packages/engine/src/config.ts`; the 24-role table matches `AGENT_ROLE_TIERS`; the `extensions` block field table matches the Zod schema in `packages/engine/src/config.ts` (search for `extensions:`); the toolbelt schema and `agent:start` field list match `packages/engine/src/agent-runtime-registry.ts`; the playbook CLI surface (`list`, `new`, `edit`, `run`, `promote`, `demote`, `play`) matches `packages/eforge/src/cli/playbook.ts`. The doc is currently mostly accurate per planner exploration — only correct concrete mismatches.
- `docs/extensions.md` — Verify: the `## Configuration` field table matches the same Zod schema as above; the runtime-support table matches the one in `docs/extensions-api.md` (after the line 954 fix); the CLI command list in `## Statuses, diagnostics, and provenance` matches the `extension` subcommands in `packages/eforge/src/cli/index.ts`; the example file paths under `examples/extensions/` all exist (verify with `ls examples/extensions/`).
- `docs/extensions-api.md` — Beyond the line 954 fix, verify section headings match the public `EforgeExtensionAPI` surface in `packages/extension-sdk/src/api.ts` (`onEvent`, `onAgentRun`, `registerTool`, `beforeQueueDispatch`, `beforePlanMerge`, `beforeFinalMerge`, `registerProfileRouter`, `registerInputSource`, `registerPrdEnricher`, `registerReviewerPerspective`, `registerValidationProvider`). Confirm `defineEforgeExtension` and `defineExtensionTool` helpers behave as documented (re-exports from `packages/extension-sdk/src/index.ts`).
- `docs/hooks.md` — Verify: env-var list matches what `packages/engine/src/hooks.ts` actually populates; the link `packages/engine/src/events.ts` exists. Today's source-of-truth event union actually lives in `packages/client/src/events.schemas.ts` per `AGENTS.md` ("Event types and schemas are co-located. `packages/client/src/events.schemas.ts` is the wire-protocol source of truth"). If `packages/engine/src/events.ts` re-exports from there, the existing link can be kept; if it does not exist or is no longer authoritative, point the link at the correct file. Verify before changing.
- `docs/architecture.md` — Beyond the two confirmed items above, verify: package-topology mermaid lists the actual `packages/` contents (note that `extension-sdk` and `monitor-ui` are not currently shown — decide whether to add them or annotate the diagram as showing core engine/consumer packages only; do not invent edges); event-category table matches `packages/client/src/events.schemas.ts`; compile/build stage tables match the stage registry referenced from `packages/engine/src/pipeline/`. Correct only concrete mismatches.
- `docs/config-migration.md` — This is a migration guide from the old pre-tier schema to the current tier-based schema. Verify that the "After" examples are valid against today's config schema. The guide is still useful because `docs/config.md` notes that legacy `eforge.yaml` aborts with `ConfigMigrationError`. Leave it in place unless concrete content is wrong.
- `docs/roadmap.md` — Beyond the extensions bullet, scan each remaining bullet ("Queue reordering & priority", "Low-fidelity input handling", "Schema library unification on TypeBox", "TypeScript project references") and check whether any have shipped. The roadmap is required to contain only future work. Remove anything that has shipped; otherwise leave alone.
- `docs/prd/typescript-extensibility.md` — `AGENTS.md` says: "**Delete PRDs after implementation** — `docs/` should reflect current state and planned work only." If this PRD describes work that is now substantially complete (matches the extensions runtime-support table in `docs/extensions.md`), delete it. If it still describes genuinely future work, leave it. Use the runtime-support table in `docs/extensions.md` as the cutover signal.

### Out-of-scope reminder

- Do not edit any file under `web/content/reference/` (auto-generated; has a `Generated file. Do not edit.` header).
- Do not edit `CHANGELOG.md` (managed by the release flow per `AGENTS.md`).
- Do not change implementation code unless a doc claim can be made correct by trivial code wording (e.g. fixing a code comment). Documentation accuracy comes from updating the doc to match the code, not the other way around. If the code itself is wrong, leave it and surface the discrepancy in the plan output rather than fixing the code.
- Do not add tutorials, marketing copy, or speculative "coming soon" content.
- Do not introduce new top-level docs files unless replacing one being removed.
- Do not edit `eforge-plugin/skills/*/SKILL.md` or `packages/pi-eforge/skills/*/SKILL.md` as part of this plan — those are user-facing skill content but covered by `scripts/check-skill-parity.mjs` and are not what this plan targets. (If a skill description references a fact that is wrong elsewhere, fix it in the source doc; the skill content sweep is a separate task.)

### Key Decisions

1. **Single plan, single excursion.** All work is in the documentation domain, mutually consistent, and small enough to land in one builder turn. Splitting per-file would invite cross-file inconsistencies (e.g. README and architecture.md must agree on the Pi command list).
2. **Delete `docs/daemon-mutation-audit.md` rather than edit it.** It documents an internal audit tied to one completed plan; there is no user-facing purpose for it in `docs/`.
3. **Tier-grouped roles preferred for the architecture.md fix.** It removes the need to invent a non-canonical "function" taxonomy and stays in lockstep with `AGENT_ROLE_TIERS` and `docs/config.md`.
4. **Roadmap.md extensions bullet is narrowed, not removed.** The remaining deferred surfaces (`beforeEnqueue`, `beforeValidation`, approval workflow/state, `modify` decisions) are genuine future work and the roadmap is the right place for them.

## Scope

### In Scope
- `README.md` (root): Pi commands paragraph.
- `AGENTS.md` (root): workspace layout package list.
- `docs/architecture.md`: Pi commands paragraph; `Agent roles by function` table; any other concrete mismatches identified during the sweep.
- `docs/extensions-api.md`: closing paragraph of `## Runtime support status`; any other concrete mismatches.
- `docs/extensions.md`: any concrete mismatches identified during the sweep.
- `docs/config.md`: any concrete mismatches identified during the sweep.
- `docs/hooks.md`: link to the events source file if it points at a non-authoritative path.
- `docs/config-migration.md`: any concrete mismatches.
- `docs/roadmap.md`: narrow or remove the "Native TypeScript extensions" bullet; verify the rest.
- `docs/daemon-mutation-audit.md`: delete (verify no inbound links first).
- `docs/prd/typescript-extensibility.md`: delete if substantially implemented; otherwise leave.

### Out of Scope
- `web/content/**` (auto-generated reference docs and the docs site content tree).
- `CHANGELOG.md`.
- `eforge-plugin/skills/**` and `packages/pi-eforge/skills/**`.
- Implementation code changes (engine, CLI, daemon, plugin, Pi extension, packages/*).
- New documentation files except as replacements for removed ones.
- Style-only rewrites; only correct factual drift.

## Files

### Modify
- `README.md` — update Pi commands paragraph (item 2).
- `AGENTS.md` — add `extension-sdk` to the packages-in-`packages/` list (item 1).
- `docs/architecture.md` — fix Pi commands paragraph (item 3) and `Agent roles by function` table (item 4); apply any drift fixes found during sweep.
- `docs/extensions-api.md` — fix the `## Runtime support status` closing paragraph (item 5); apply any drift fixes found during sweep.
- `docs/extensions.md` — apply any concrete drift fixes found during sweep.
- `docs/config.md` — apply any concrete drift fixes found during sweep.
- `docs/hooks.md` — fix the events source link if it has drifted; apply any other concrete drift fixes.
- `docs/config-migration.md` — apply any concrete drift fixes found during sweep.
- `docs/roadmap.md` — narrow/remove the "Native TypeScript extensions" bullet (item 7); apply any other concrete updates.

### Delete
- `docs/daemon-mutation-audit.md` — internal mutation audit, not user-facing (item 6). Verify no inbound links from `README.md`, other `docs/**.md`, `web/content/**`, or `AGENTS.md` before deletion; if any cross-link exists, remove or repoint it as part of the deletion edit.
- `docs/prd/typescript-extensibility.md` — delete only if its design content is substantially shipped per `docs/extensions.md` runtime-support table. If retained, leave untouched. Verify with a quick read before deciding.

### Create
- None.

## Verification

All criteria are specific and observable.

- [ ] `AGENTS.md` workspace-layout package list contains exactly the names returned by `ls packages/` (engine, eforge, monitor, monitor-ui, client, pi-eforge, scopes, input, docs-gen, extension-sdk) and no other names.
- [ ] `README.md` Pi commands paragraph lists `/eforge:profile`, `/eforge:profile-new`, `/eforge:config`, and `/eforge:playbook` as native overlay commands. (Order need not match this list; content must include all four.)
- [ ] `docs/architecture.md` Pi commands paragraph (currently around line 121) lists the same four native overlay commands as the README and remains consistent with the README on `/eforge:build` (native profile picker + skill delegation).
- [ ] `docs/architecture.md` `Agent roles by function` table contains exactly the 24 roles defined in `AGENT_ROLE_TIERS` in `packages/engine/src/pipeline/agent-config.ts`. Specifically: the role `parallel-reviewer` does not appear anywhere in the table, and the roles `evaluator`, `architecture-evaluator`, `cohesion-evaluator`, `plan-reviewer`, and `pipeline-composer` each appear exactly once.
- [ ] `docs/extensions-api.md` no longer contains the substring `Validation-provider execution` in the trailing prose paragraph of `## Runtime support status`. The runtime-support table at lines 938–950 is unchanged (still lists `registerValidationProvider` runtime execution today as `Yes`).
- [ ] `docs/daemon-mutation-audit.md` is removed from the repo. A repo-wide `grep -r daemon-mutation-audit` returns zero hits in `docs/`, `README.md`, `AGENTS.md`, and `web/content/`.
- [ ] `docs/roadmap.md` "Native TypeScript extensions" bullet either does not exist or is narrowed to surfaces that are still deferred per `docs/extensions.md` (acceptable narrow content: `beforeEnqueue`, `beforeValidation`, approval workflow/state, `modify` policy decisions). It does not list `onEvent`, `onAgentRun`, `registerTool`, policy gates, `registerProfileRouter`, `registerInputSource`, `registerPrdEnricher`, `registerReviewerPerspective`, `registerValidationProvider`, or the `/eforge:extend` skill as future work.
- [ ] Every file under `docs/` not deleted by this plan has been read at least once during implementation, and any concrete drift discovered has been corrected with a targeted edit (not a rewrite). The reviewer should be able to spot-check this by sampling at least one specific claim per file against the codebase and finding it accurate.
- [ ] No file modified by this plan contains marketing copy, tutorials, speculative future behavior, or internal implementation-detail prose that is not user-facing.
- [ ] All Markdown links in modified docs resolve to existing files or sections. (`pnpm docs:check` runs link-check across `web/`; for hand-maintained `docs/` links, a manual sample check during implementation is acceptable since there is no project-wide link checker for `docs/`.)
- [ ] `pnpm type-check` passes from the worktree root.
- [ ] `pnpm test` passes from the worktree root (this runs `node scripts/check-skill-parity.mjs && vitest run`).
