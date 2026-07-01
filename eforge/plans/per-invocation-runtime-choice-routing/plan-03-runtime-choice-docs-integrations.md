---
id: plan-03-runtime-choice-docs-integrations
name: Runtime Choice Docs and Profile Creation Surfaces
branch: per-invocation-runtime-choice-routing/plan-03-runtime-choice-docs-integrations
---

# Runtime Choice Docs and Profile Creation Surfaces

## Architecture Context

Plans 01 and 02 establish the runtime-choice schema and engine behavior. This plan updates user-facing documentation, generated reference artifacts, and both consumer-facing profile creation surfaces: the Pi extension and the Claude Code plugin skill. Pi and Claude surfaces must stay in sync for capabilities that both can expose. Do not bump `packages/pi-eforge/package.json`; bump the Claude plugin version if any plugin file changes.

## Implementation

### Overview

Document the new config schema, routing order, fallback behavior, event metadata, and boundaries between profile routers, runtime-choice routers, and `onAgentRun`. Update profile payload builders and profile creation prompts/examples so users can create or describe tier choices and routing rules.

### Key Decisions

1. Put config reference changes in the docs generator as the source of generated reference artifacts, then regenerate docs.
2. Keep examples centered on the primary user outcome: `implementation.ui` and `implementation.backend` choices inside the implementation tier.
3. Explicitly document that the four built-in tiers remain the role-routing axis and choices are tier-local overlays.
4. Explicitly document that `registerProfileRouter` selects the active profile before build dispatch and `onAgentRun` observes the selected choice but cannot change runtime selection.
5. Keep Console profile editing out of scope; only read-only display changes from plan 02 are described if they were implemented.

## Scope

### In Scope

- Config docs for `agents.tiers.<tier>.choices`, route rules, predicate semantics, inheritance, validation failures, and examples.
- Generated reference docs updates through `pnpm docs:generate`.
- Public docs pages or README references that describe profile/runtime configuration.
- Pi extension profile payload creation and preview surfaces for choices/routing.
- Claude plugin `profile-new` skill examples and instructions for choices/routing.
- Claude plugin version bump if plugin files are modified.
- Product surface tests for profile payload creation and skill/doc parity where existing tests cover those areas.

### Out of Scope

- Additional runtime kernel changes beyond fixes needed to align docs with plans 01 and 02.
- Full Console profile editing UI.
- New scheduling, workflow orchestration, or LLM-based routing features.
- Pi package version bump.

## Files

### Create

- Optional docs examples under the existing docs examples location if the repo already keeps standalone config examples. Use the existing docs organization; do not introduce a new docs section root unless the current docs structure requires it.

### Modify

- `docs/config.md` — Document runtime choices, effective recipe inheritance, routing rule order, predicate semantics, fallback behavior, validation errors, and examples.
- `docs/roadmap.md` — Remove or adjust future-looking runtime-choice text only if this feature was already listed there as future work.
- `packages/docs-gen/src/generators/config.ts` — Add generated config reference entries for choices/routing fields and event metadata references if config generator owns them.
- Generated docs/reference artifacts produced by `pnpm docs:generate` — Commit the generated updates instead of hand-editing generated files.
- `web/**` docs content or navigation manifests — Update only pages that mirror config/profile reference content or link to generated config docs.
- `packages/pi-eforge/extensions/eforge/profile-payload.ts` — Add choices/routing support to profile payload construction and preview serialization.
- `packages/pi-eforge/extensions/eforge/profile-commands.ts` — Expose profile creation/description flow updates for runtime choices, following existing command patterns.
- `eforge-plugin/skills/profile-new/profile-new.md` — Add examples and instructions for creating profiles with choices/routing.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump the plugin version because plugin content changed.
- Existing Pi profile payload tests — Add payload cases for inherited choices and routing rules.
- Existing Claude plugin skill parity or profile-new tests/scripts, including `scripts/check-skill-parity.mjs` if it encodes expected skill content.
- Docs generator and docs drift tests under `test/`, `packages/docs-gen`, or `web/__tests__/` that cover config reference output.

## Documentation Content Requirements

Include an example equivalent to:

```yaml
agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
      choices:
        backend:
          model: qwen3-coder
          pi:
            provider: local
          toolbelt: none
        ui:
          effort: high
          toolbelt: browser-ui
      routing:
        rules:
          - name: ui-paths
            choice: ui
            when:
              pathGlobs: ["packages/console-ui/**", "web/**", "**/*.{tsx,jsx,css}"]
              keywords: ["ui", "frontend", "browser", "component"]
          - name: backend-paths
            choice: backend
            when:
              pathGlobs: ["packages/engine/**", "packages/client/**", "packages/monitor/**"]
```

Document these points with explicit wording:

- Existing tier recipe equals `tier.default`.
- Named choices inherit from the tier default.
- Choices are selected after role-to-tier resolution.
- Declarative rules run before extension runtime-choice routers.
- Extension router failures fall back to `default` and do not fail the build.
- `registerProfileRouter` is still build-level profile selection.
- `onAgentRun` can observe selected choice metadata but cannot mutate runtime selection.
- Events expose non-secret runtime-choice metadata.

## Database Migration

None.

## Verification

- [ ] `pnpm docs:generate` updates the config reference artifacts with runtime-choice schema fields and leaves `pnpm docs:check` passing.
- [ ] Pi profile payload tests serialize a profile containing `implementation.ui`, `implementation.backend`, and two routing rules matching the documented example.
- [ ] Claude `profile-new` skill content includes a choices/routing example and the plugin version in `eforge-plugin/.claude-plugin/plugin.json` is incremented from its pre-change value.
- [ ] Skill parity checks, if present for profile creation surfaces, pass after Pi and Claude updates.
- [ ] Public docs state that build-level profile routers and per-invocation runtime-choice routers are separate routing layers.
- [ ] Public docs state that `onAgentRun` cannot change harness, model, provider, effort, or toolbelt.
- [ ] Public docs and generated reference content contain no API keys, provider secrets, raw local profile paths, or user-specific absolute paths.