---
id: plan-02-docs-integration-vocabulary
name: Docs, Skills, and Landing Vocabulary Alignment
branch: close-stacked-pr-follow-up-gaps/plan-02-docs-integration-vocabulary
agents:
  builder:
    effort: medium
    rationale: Mostly source/docs alignment plus a contained Pi type rename across a
      small integration surface.
  doc-author:
    effort: medium
    rationale: Consumer-facing Pi and Claude skill guidance plus generated docs
      wording need synchronized updates.
---

# Docs, Skills, and Landing Vocabulary Alignment

## Architecture Context

Runtime already rejects `build.onSuccess`, PRD `onSuccess`, and old full-string landing values. Generated config reference and integration guidance still describe old compatibility or old vocabulary. Pi and Claude integration packages must remain in sync, and plugin edits require a plugin version bump.

This plan updates source docs, generated artifacts, skills, CLI/Pi descriptions, and the misleading Pi `BuildOnSuccess` type name without changing runtime compatibility behavior.

## Implementation

### Overview

Fix the docs generator text first, regenerate references, update hand-authored docs/skills, and clean active prompts/descriptions so user-facing text uses `pr`, `merge`, and `leave`. Rename Pi's canonical landing action type from `BuildOnSuccess` to `LandingAction` or `LandingActionValue` and update imports.

### Key Decisions

1. Docs must match the runtime clean break: `build.onSuccess` is removed and rejected with migration guidance.
2. `git-spice` remains the documented default command; `gs` appears only as an optional user-configured alias.
3. Active prompts and descriptions use `pr`, `merge`, and `leave`; old values remain only in migration guidance/tests/event history where they are intentional.
4. Pi and Claude skills are edited together and checked with `scripts/check-skill-parity.mjs`.
5. Bump `eforge-plugin/.claude-plugin/plugin.json` because plugin skill files change.

## Scope

### In Scope

- Replace stale generated config reference wording that claims `build.onSuccess` backward compatibility or deprecation warnings.
- Regenerate docs artifacts from the generator.
- Update Pi and Claude init skills to pass `stackingEnabled` and `gitSpiceCommand` to init when the user opts into stacking.
- Update Pi and Claude config skills and config samples to use canonical landing vocabulary in comments.
- Update CLI and Pi extension prompts/descriptions/comments that still say `issue-pr`, `merge-to-base-branch`, or `leave-branch` in active guidance.
- Rename Pi integration type alias `BuildOnSuccess` to `LandingAction` or `LandingActionValue` and update consumers.
- Add or update tests/guards for generator wording, skill parity, and landing menu descriptions.

### Out of Scope

- Changing runtime config parsing or adding old-value aliases.
- Removing old strings from migration tests, migration error messages, API-version history, or event workflow literals such as `leave-branch` that remain part of the wire schema.
- New user workflows for automated restack/sync.

## Files

### Modify

- `packages/docs-gen/src/generators/config.ts` — replace compatibility/deprecation language with removed/rejected migration language; keep `git-spice` as default and frame `gs` as an explicit optional alias.
- `web/content/reference/config.md` — regenerated output from docs generator.
- `web/public/reference/config.md` — regenerated output from docs generator.
- `web/public/llms-full.txt` — regenerated output from docs generator.
- Any additional files changed by `pnpm docs:generate` — review the diff and keep generator-driven artifacts only.
- `docs/config.md` — replace active comments such as `Allow merge-to-base-branch...` with `Allow landing.action: merge...`; keep migration table.
- `docs/stacking.md` — verify command alias and migration language reflect runtime rejection.
- `web/content/docs/configuration.md` and `web/content/docs/stacking.md` — update hand-authored web docs if `docs:generate` does not mirror the needed wording.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — remove false “tool does not persist stacking config” guidance; include `stackingEnabled` and `gitSpiceCommand` fields in init examples when stacking is selected.
- `eforge-plugin/skills/init/init.md` — mirror the Pi init skill update using Claude MCP tool names.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — replace old landing comments/descriptions in active config guidance.
- `eforge-plugin/skills/config/config.md` — mirror the Pi config skill update.
- `eforge-plugin/.claude-plugin/plugin.json` — increment the plugin version patch component.
- `packages/eforge/src/cli/interactive.ts` — change trunk prompt text to `merge` and `pr` vocabulary.
- `packages/eforge/src/cli/mcp-proxy.ts` — update `landingAction`, `allowLocalMergeToTrunk`, `stackingEnabled`, and `gitSpiceCommand` descriptions to canonical terms.
- `packages/pi-eforge/extensions/eforge/index.ts` — update tool descriptions and type imports.
- `packages/pi-eforge/extensions/eforge/trunk-landing.ts` — rename `BuildOnSuccess` type and update comments.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts` — update renamed type imports/usages.
- `packages/pi-eforge/extensions/eforge/landing-policy.ts` — update renamed type imports/usages and canonical menu descriptions/comments.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — update renamed type import/usages.
- `test/pi-landing-policy.test.ts` and `test/pi-trunk-landing-policy.test.ts` — assert menu descriptions contain canonical terms and no old active labels.
- `test/docs-gen-determinism.test.ts` or a new docs generator test — assert generated config reference does not contain `kept for backward compatibility` or `deprecation warning` for `build.onSuccess`.

## Implementation Notes

- Run `pnpm docs:generate` after editing the generator; do not hand-edit generated reference files without generator changes.
- Keep skill parity outside `parity-skip` blocks unless there is platform-only UI behavior.
- For init skills, pass these fields in both existing-profile and fresh-init examples when stacking is selected:
  - `"stackingEnabled": true`
  - `"gitSpiceCommand": "<custom path>"` only when the user supplied a custom command/path.
- Use `git-spice` in examples; mention `gs` only as `set command: gs if you explicitly use that alias`.
- Old landing values may remain in `packages/eforge/src/cli/landing-options.ts`, config/PRD migration messages, and tests that assert rejection.

## Verification

- [ ] Generated config reference contains `build.onSuccess` migration guidance and does not contain `kept for backward compatibility` or `deprecation warning` for that field.
- [ ] Pi and Claude init skills state that init persists `stackingEnabled` and `gitSpiceCommand`.
- [ ] Init examples include `stackingEnabled: true` when stacking is selected and include `gitSpiceCommand` only for a custom command/path.
- [ ] Active CLI/Pi prompt and tool-description text contains `pr`, `merge`, and `leave` labels and does not contain `issue-pr`, `merge-to-base-branch`, or `leave-branch` outside migration/test/history contexts.
- [ ] All imports that referenced `BuildOnSuccess` compile against the renamed Pi landing action type.
- [ ] `node scripts/check-skill-parity.mjs` passes.
- [ ] `pnpm docs:generate` updates generated artifacts from the changed generator.
- [ ] `pnpm docs:check` passes.
- [ ] `pnpm vitest run test/docs-gen-determinism.test.ts test/pi-landing-policy.test.ts test/pi-trunk-landing-policy.test.ts test/cli-landing-options.test.ts test/onsuccess-config.test.ts test/prd-frontmatter-onsuccess.test.ts` passes.