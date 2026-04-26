---
id: plan-02-skill-docs-and-plugin-bump
name: Skill doc updates and plugin version bump
branch: move-pi-provider-from-model-refs-to-agentruntime-config/skill-docs-and-plugin-bump
---

# Skill doc updates and plugin version bump

## Architecture Context

The `eforge-plugin/` directory contains the Claude Code plugin published as part of eforge. It includes user-facing skill prompts (`/eforge:init`, `/eforge:profile-new`, `/eforge:config`) that document how to write `eforge/config.yaml` and `eforge/profiles/<name>.yaml` files. Several of these prompts reference the old config shape — `provider:` on per-model entries — and emit example YAML in that shape. After plan-01 lands, those examples and instructions are wrong and would lead users to write configs that fail Zod validation.

Per `AGENTS.md`, every change to `eforge-plugin/` requires a version bump in `eforge-plugin/.claude-plugin/plugin.json`.

This plan depends on plan-01 because the skill docs describe the new shape established by plan-01's schema. Splitting it out keeps the schema/resolver change reviewable on its own and keeps doc-only edits in a single focused plan.

## Implementation

### Overview

Mechanical doc edits across three skill markdown files plus a one-line version bump. No behavior change beyond what plan-01 already shipped.

### Key Decisions

1. **Move provider into the runtime block in every example.** Examples in `init.md` and `profile-new.md` currently emit `agents.models.<class>: { id, provider }`; rewrite them to emit `agents.models.<class>: { id }` plus `agentRuntimes.<name>.pi.provider`.
2. **Drop provider-on-model-ref language from the schema-shape comments in `config.md`.** Replace lines that describe `{ provider: "...", id: "..." }` for Pi with `{ id: "..." }` plus a one-sentence note that the provider lives on the runtime entry.
3. **Bump plugin minor version.** This is a user-visible breaking change to the documented config shape, so a minor bump (0.10.0 -> 0.11.0) is appropriate. The npm package version is independent (per `AGENTS.md`) and is not touched.

## Scope

### In Scope

- Edit `eforge-plugin/skills/init/init.md` so any example or instruction emitting profile YAML writes `provider:` into the runtime block, not per-model.
- Edit `eforge-plugin/skills/profile-new/profile-new.md` to update both the model-class shape comments (around lines 92-94) and the example output blocks (around lines 110-116) to the new shape.
- Edit `eforge-plugin/skills/config/config.md` to update the model-shape comments (around lines 56 and 153) so they no longer instruct users to put `provider:` on a Pi model ref.
- Bump `version` in `eforge-plugin/.claude-plugin/plugin.json` from `0.10.0` to `0.11.0`.

### Out of Scope

- Engine, resolver, and test changes — covered by plan-01.
- Eval profile migrations — separate follow-on PRD.
- npm package (`packages/pi-eforge/package.json`) version — explicitly not touched per `AGENTS.md`.
- `DAEMON_API_VERSION` — wire shape unchanged.
- Skill files that don't reference provider (`build/`, `status/`, `update/`, `restart/`, `plan/`, `profile/`).

## Files

### Modify

- `eforge-plugin/skills/init/init.md` — Around lines 32-33 (the "Pick backend, provider, and model" step): keep the provider-selection prompt for Pi (it's still part of the user flow), but update any subsequent instructions or examples that describe writing the picked provider into the profile YAML so they target `agentRuntimes.<name>.pi.provider` instead of per-model entries. Audit the full file and fix every reference to `agents.models.<class>.provider` or `{ id, provider }` shape.
- `eforge-plugin/skills/profile-new/profile-new.md` — Around lines 92-94 (the model-class shape comments): change `max: { id: "<id>", provider: "<provider>"? }` (and the `balanced` / `fast` lines) to `max: { id: "<id>" }` (and the same for `balanced` / `fast`). Add a separate comment explaining that provider lives on the agentRuntime entry. Around lines 110-116 (the example output block): remove `provider: anthropic` (or whichever provider) from each model-class entry and add `pi:\n      provider: anthropic` to the `agentRuntimes.<name>` block. Audit the rest of the file for any other example YAML that uses the old shape.
- `eforge-plugin/skills/config/config.md` — Around line 56 and line 153 (the schema-shape comments referencing `{ provider: "provider-name", id: "model-name" }` for Pi): change to `{ id: "model-name" }` and add a note like `# provider lives on the agentRuntime entry, not on the model ref`. Audit lines 91 and 95 (the redirect-to-profile-skill language) to confirm it still reads correctly given the new shape.
- `eforge-plugin/.claude-plugin/plugin.json` — Change `"version": "0.10.0"` to `"version": "0.11.0"`.

## Verification

- [ ] `eforge-plugin/skills/init/init.md` contains zero occurrences of `provider:` placed inside an `agents.models` example block. All `provider:` mentions in YAML examples sit under `agentRuntimes.<name>.pi.provider`.
- [ ] `eforge-plugin/skills/profile-new/profile-new.md` contains zero occurrences of `provider:` inside an `agents.models.<class>:` block in any example, and at least one example shows `pi.provider` under an `agentRuntimes` entry.
- [ ] `eforge-plugin/skills/config/config.md` schema-shape comments around lines 56 and 153 describe the Pi model ref as `{ id: "..." }` and explicitly note that provider lives on the runtime entry.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field equals `0.11.0`.
- [ ] `pnpm test` still passes (the doc edits cannot break tests, but the parity check `node scripts/check-skill-parity.mjs` runs as part of `pnpm test` and must still pass).
- [ ] `pnpm type-check` still passes.
