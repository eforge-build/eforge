---
id: plan-05-docs-and-dogfood-config
name: Update Documentation Generated References and Dogfood Config
branch: complete-first-class-stacked-pr-and-git-spice-support/plan-05-docs-and-dogfood-config
agents:
  builder:
    effort: high
    rationale: This plan updates multiple documentation surfaces and generated
      artifacts that must match final runtime contracts.
  reviewer:
    effort: high
    rationale: Review must verify stale aggregation semantics are removed and docs
      generation artifacts are synchronized.
---

# Update Documentation Generated References and Dogfood Config

## Architecture Context

Docs and generated reference artifacts still emphasize `build.onSuccess` and old non-trunk aggregation behavior. After runtime and consumer surfaces are complete, docs must describe branch-per-PR stacking, git-spice setup, dependency semantics, stack state visibility, and the compatibility bridge from `build.onSuccess` to `landing.action`.

## Implementation

### Overview

Update core docs, public web docs, generated reference artifacts, and repo config. Add a focused stacking guide. Regenerate schemas/reference docs. Finalize `eforge/config.yaml` to either enable stacking for dogfooding or leave it disabled with an explicit documented reason.

### Key Decisions

1. Document `landing.action: pr|merge|leave` as the primary config vocabulary and `build.onSuccess` as a compatibility alias.
2. Document direct PR publication as `artifact branch -> resolved base branch` for both trunk and non-trunk bases.
3. Document git-spice as the only v1 stack provider; do not mention unsupported providers as available features.
4. Enable `eforge/config.yaml` `stacking.enabled: true` only after the previous plans pass their targeted tests; otherwise keep it false and add a note explaining the opt-in decision.

## Scope

### In Scope

- Architecture/config/concepts/README docs updates.
- New focused stacking documentation.
- Public web content equivalents.
- Generated reference docs/schema artifacts.
- Roadmap update only for future work that remains out of scope after this completion slice.
- Final checked-in project config decision for stack dogfooding.

### Out of Scope

- Runtime implementation.
- Tool schema changes.
- New stack providers.

## Files

### Create

- `docs/stacking.md` — focused stacking guide covering artifact branches, dependency semantics, `stack_id`, `stack_parent`, single-dependency inference, multi-dependency ambiguity, git-spice command setup, branch-per-PR topology, restack/sync expectations, and GitHub stale inline comment limitations.
- `web/content/docs/stacking.md` — public docs equivalent linked from the docs navigation if the site uses explicit nav metadata.

### Modify

- `README.md` — add concise stacked PR/git-spice overview and link to stacking docs.
- `docs/architecture.md` — replace branch-aware landing aggregation section with direct PR publication and stacked child base behavior.
- `docs/config.md` — document `landing.action`, `stacking.enabled`, `stacking.provider`, `stacking.gitSpice.command`, and `build.onSuccess` compatibility/precedence.
- `docs/roadmap.md` — add only future stack work that remains out of scope, such as automated post-merge restack/sync polish, if not implemented.
- `web/content/docs/configuration.md` — mirror config changes.
- `web/content/docs/concepts.md` — explain artifact branches and branch-per-PR stacks conceptually.
- `web/content/docs/playbooks.md` — update landing vocabulary and direct PR semantics.
- Web navigation/content index files if required for the new stacking page.
- `packages/engine/src/config.ts` — improve schema descriptions for `landing` and `stacking` so generated config reference has meaningful text.
- `web/content/reference/config.md`, `web/public/reference/config.md`, `web/content/reference/events.md`, `web/public/reference/events.md`, `web/public/schemas/config.schema.json`, `web/public/schemas/events.schema.json`, `web/public/llms-full.txt`, and other artifacts changed by `pnpm docs:generate` — regenerate, do not hand-edit.
- `eforge/config.yaml` — set `stacking.enabled: true` for dogfooding only if the completed runtime can fail early/actionably on missing git-spice and project maintainers accept the requirement; otherwise leave `false` and add a YAML comment documenting opt-in status.

## Verification

- [ ] `rg "feature-pr-after-local-merge|mergeIntoBaseFirst|merges the eforge work branch into the feature branch locally, then opens a PR" README.md docs web packages/pi-eforge/skills eforge-plugin/skills --glob '!node_modules/**' --glob '!dist/**'` returns no matches except migration notes that explicitly label the behavior as removed.
- [ ] `docs/stacking.md` and `web/content/docs/stacking.md` mention `stack_id`, `stack_parent`, single-dependency inference, multi-dependency ambiguity, canonical `git-spice`, `stacking.gitSpice.command`, and `artifact branch -> parent artifact branch` topology.
- [ ] Generated config reference contains descriptions for `stacking` and `landing` fields.
- [ ] `pnpm docs:generate` completes and produces committed reference/schema artifact changes.
- [ ] `pnpm docs:check` passes.
- [ ] `eforge/config.yaml` has an intentional final `stacking.enabled` value and any `false` value has an adjacent comment explaining why this repo remains opt-in.