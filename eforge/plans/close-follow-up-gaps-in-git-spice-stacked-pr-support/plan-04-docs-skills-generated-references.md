---
id: plan-04-docs-skills-generated-references
name: Docs, Skills, and Generated References
branch: close-follow-up-gaps-in-git-spice-stacked-pr-support/plan-04-docs-skills-generated-references
agents:
  builder:
    effort: medium
    rationale: Documentation and generated artifact refresh across repo docs, web
      docs, skills, config comments, and plugin metadata.
---

# Docs, Skills, and Generated References

## Architecture Context

After the active code migration, checked-in docs/skills/generated references must stop teaching legacy `onSuccess`, stale `gs`-first guidance, and ASCII stack diagrams. The roadmap must keep automated restack/sync as future work.

## Implementation

### Overview

Update project docs, public web docs, skills, config comments, generated references, and plugin metadata to match canonical landing vocabulary, provider-neutral artifact dependency semantics, canonical `git-spice` commands, Mermaid diagrams, and deferred sync/restack lifecycle.

### Key Decisions

1. Docs use `git-spice` command names in primary examples; `gs` appears only as an optional user alias.
2. Docs explain `landing.action` / `landingAction` as the only active vocabulary and mention old names only in migration-error or migration-guide context.
3. Stack topology diagrams use Mermaid.
4. Claude plugin version is bumped because plugin skill files change.

## Scope

### In Scope
- Update repository docs and public web docs for artifact registry/dependency semantics and canonical landing vocabulary.
- Convert stack ASCII diagrams to Mermaid diagrams.
- Replace stale `gs repo init`, `gs stack rebase`, and `gs branch sync` primary examples with `git-spice repo init`, `git-spice stack restack`, or the current canonical git-spice command names used by tests/provider docs.
- Keep automated post-merge sync/restack documented as deferred roadmap work; do not document it as shipped automation.
- Update Pi skills and Claude plugin skills consistently.
- Correct init/config skill guidance so it matches final init tool support for stacking config.
- Bump `eforge-plugin/.claude-plugin/plugin.json` version.
- Run `pnpm docs:generate` so generated references and LLMS artifacts match the code.

### Out of Scope
- Code behavior changes beyond generated docs and plugin metadata.
- New stack lifecycle automation.
- New stack providers.

## Files

### Create
- None expected.

### Modify
- `README.md` — update stacked PR summary and remove legacy compatibility wording.
- `docs/stacking.md` — Mermaid topology diagrams, canonical `git-spice` setup/restack wording, artifact registry dependency semantics, stack lifecycle status, and deferred automation note.
- `docs/architecture.md` — update landing lifecycle and artifact dependency model; remove legacy `build.onSuccess` tables/text.
- `docs/config.md` and/or configuration docs generated sources — remove deprecation bridge wording and document `landing.action: pr|merge|leave` only.
- `docs/roadmap.md` — keep future automated sync/restack item with canonical `git-spice` wording.
- `eforge/config.yaml` — comments use `git-spice repo init`, `landing.action`, and optional alias wording only.
- `web/content/docs/stacking.md`, `web/content/docs/configuration.md`, `web/content/docs/concepts.md`, `web/content/docs/getting-started.md`, `web/content/docs/integrations.md` — align public docs with repo docs.
- `packages/pi-eforge/skills/eforge-build/SKILL.md`, `eforge-init/SKILL.md`, `eforge-config/SKILL.md`, `eforge-playbook/SKILL.md` — use `landingAction`, remove `onSuccess`, and update stacking init guidance.
- `eforge-plugin/skills/build/build.md`, `eforge-plugin/skills/init/init.md`, `eforge-plugin/skills/config/config.md`, `eforge-plugin/skills/playbook/playbook.md` — mirror Pi skill changes.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version from the current value.
- Generated files under `web/content/reference/`, `web/public/reference/`, `web/public/llms*.txt`, and `web/public/schemas/` produced by `pnpm docs:generate`.

## Verification

- [ ] `pnpm docs:generate` completes and updates generated docs/reference artifacts.
- [ ] `pnpm docs:check` completes with zero drift.
- [ ] `rg -n -- '--on-success|build\.onSuccess|onSuccess' README.md docs web/content web/public packages/pi-eforge/skills eforge-plugin/skills eforge/config.yaml --glob '!dist/**'` returns only intentional migration guidance, if any.
- [ ] ``rg -n -- '(`gs`|gs repo init|gs stack|gs branch)' README.md docs web/content packages/pi-eforge/skills eforge-plugin/skills eforge/config.yaml`` returns no primary-command examples; optional alias text is explicit.
- [ ] `rg -n "ASCII|\+---|\\---|\|   " docs/stacking.md web/content/docs/stacking.md` returns no stack topology ASCII diagram blocks.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version differs from the pre-plan version.
