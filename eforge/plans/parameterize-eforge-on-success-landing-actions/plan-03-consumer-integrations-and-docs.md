---
id: plan-03-consumer-integrations-and-docs
name: Pi extension, Claude plugin, skill docs, and public docs
branch: parameterize-eforge-on-success-landing-actions/plan-03-consumer-integrations-and-docs
agents:
  builder:
    effort: medium
    rationale: Mirrored tool-schema changes across two integrations plus parallel
      skill markdown updates. Mechanical but requires careful Pi/Claude parity.
---

# Pi extension, Claude plugin, skill docs, and public docs

## Architecture Context

With the engine, wire protocol, and daemon API surface in place, this plan finishes the feature by exposing the landing-policy choice in the two consumer integrations and updating user-facing documentation. Per AGENTS.md, `eforge-plugin/` (Claude Code) and `packages/pi-eforge/` (Pi) are kept in sync — every capability available in one is available in the other when technically feasible. Pi is allowed to use richer UI (`showSelectOverlay`/`showSearchableSelectOverlay`) while the Claude plugin uses a conversational flow.

UI/UX requirements from the source:
- `/eforge:init` in both surfaces asks for an on-success landing action with the three options and guidance about when to use each.
- `/eforge:init` writes `build.onSuccess: issue-pr` by default unless the user overrides — and when `issue-pr` is selected, warns if `gh` is unavailable but does not block the choice.
- `/eforge:build` in both surfaces accepts an optional per-build `onSuccess` override and explains its precedence over the project default.
- `/eforge:config` (both surfaces) documents `build.onSuccess` alongside the other build settings.

The Pi extension tool definitions live in `packages/pi-eforge/extensions/eforge/index.ts` (`eforge_init` and `eforge_build`). The Claude plugin MCP proxy mirrors them in `packages/eforge/src/cli/mcp-proxy.ts`. Skill markdown is in `eforge-plugin/skills/*` and `packages/pi-eforge/skills/*`. Per AGENTS.md, the plugin version is bumped in `eforge-plugin/.claude-plugin/plugin.json` because plugin files change.

## Implementation

### Overview

1. Add `onSuccess` to `eforge_init` tool schemas (Pi and Claude). Persist it into `eforge/config.yaml::build.onSuccess` when provided. Default the **written** value to `issue-pr` if the skill didn't supply one and a new config is being created. (Existing-config / `existingProfile` modes already overwrite or skip `build` so no special case there.)
2. Add `onSuccess` to `eforge_build` tool schemas (Pi and Claude). Pass it through to `EnqueueRequest.onSuccess` on the daemon POST.
3. Update skill markdown in both surfaces:
   - `init/init.md` and `eforge-init/SKILL.md` gain a new step that asks the user for the landing action with the three documented options, defaults to `issue-pr`, and runs a `gh --version` shell check to warn when missing (Pi can use a selector overlay; Claude plugin uses a Q&A prompt).
   - `build/build.md` and `eforge-build/SKILL.md` document the optional `onSuccess` arg for per-build override and explain the precedence ordering.
   - `config/config.md` and `eforge-config/SKILL.md` document `build.onSuccess` next to the existing build settings.
4. Bump `eforge-plugin/.claude-plugin/plugin.json` version.
5. Update public documentation in `web/content/docs/configuration.md` (and any corresponding generated artifact under `web/public/...` that is checked in is regenerated via `pnpm docs:generate`). Add a short section under build settings explaining `build.onSuccess` with the three options. Note in `web/content/docs/concepts.md` that successful builds may complete without merging when `issue-pr` or `leave-branch` is configured.
6. Update `docs/config.md` so the reference reflects the new field.

### Key Decisions

1. **Tool schemas accept an exact union.** Both `eforge_init.onSuccess` (Pi `StringEnum` / Claude `z.enum`) and `eforge_build.onSuccess` use the closed set `['merge-to-base-branch', 'issue-pr', 'leave-branch']`. The Pi extension uses TypeBox `StringEnum`; the Claude plugin uses `z.enum`. No "other" escape hatch — the daemon and engine reject unknown values, and the skill is responsible for surfacing the three choices to the user.
2. **Pi uses `showSelectOverlay`; Claude plugin uses conversational prompts.** Pi extension can present a single-select overlay listing the three options with their guidance text inline. The Claude plugin skill prints the three options with their guidance and asks the user to pick conversationally (matches the existing `/eforge:init` setup style).
3. **`gh` availability is a warn-only check at init.** When the user picks `issue-pr`, the skill runs `gh --version` (Bash on Claude, native shell on Pi) and:
   - If non-zero or not found: prints a warning that `issue-pr` requires `gh` and that builds with `issue-pr` will fail until it's installed, but proceeds to write the config anyway because the user may install `gh` later. Source explicitly says "do not disallow the option outright".
   - If zero: proceeds silently.
4. **Skill default is `issue-pr`; tool default is `undefined`.** The skill chooses `issue-pr` as the recommended option but ultimately the tool persists what the skill sends. If the skill omits `onSuccess`, the tool persists no `build.onSuccess` key — and at runtime the engine resolves to `merge-to-base-branch` (the back-compat default from plan-01). This keeps the tool a pure persister while letting the skill drive the recommendation.
5. **Status text in monitor / status outputs is owned by plan-02.** This plan does not re-touch reducer/event-card text. It does update the Pi extension's footer/status helpers only if they currently say "merged" unconditionally — checked but expected to be a no-op since the existing status helpers query `apiGetRunningSessionSummaries` and don't hard-code merge wording.

## Scope

### In Scope
- `eforge_init` schema + persistence (Pi extension + Claude MCP proxy).
- `eforge_build` schema + body propagation (Pi extension + Claude MCP proxy).
- Skill markdown updates for `/eforge:init`, `/eforge:build`, `/eforge:config` in both Pi and Claude surfaces.
- Public docs additions in `web/content/docs/configuration.md` and a one-line clarification in `web/content/docs/concepts.md`.
- `docs/config.md` reference update.
- `eforge-plugin/.claude-plugin/plugin.json` version bump.
- A `pnpm docs:generate` invocation as part of the plan so generated artifacts under `web/public/...` stay in sync (validated by `pnpm docs:check`).

### Out of Scope
- Engine/orchestrator behaviour (plan-01).
- Daemon API or queue plumbing (plan-02).
- New playbook/profile fields (`profile`-style routing already exists for agent runtime — landing action is a per-build override only, not a routable dimension).
- Adding a separate `gh auth status` check at init (a future improvement; current scope is `gh --version`-only per source).

## Files

### Modify
- `packages/pi-eforge/extensions/eforge/index.ts` — 
   - `eforge_init` (line ~1322): add `onSuccess: Type.Optional(StringEnum(['merge-to-base-branch', 'issue-pr', 'leave-branch'], { description: '...' }))`. In the fresh-init path (around line ~1650 where `configData.build = { postMergeCommands }` is built), include `onSuccess` in `configData.build` when supplied. Same wiring in the `existingProfile` path so the field can be set alongside `postMergeCommands`.
   - `eforge_build` (line ~305): add `onSuccess: Type.Optional(StringEnum([...]))`. In `execute`, include `body.onSuccess = params.onSuccess` when defined before calling `requireDaemon` on `API_ROUTES.enqueue`.
- `packages/eforge/src/cli/mcp-proxy.ts` — mirror exactly:
   - `eforge_build` (line ~196): add `onSuccess: z.enum([...]).optional()` to schema; include in `body` before `daemonRequest`.
   - `eforge_init` (line ~673): add `onSuccess: z.enum([...]).optional()` to schema; include in the `configData.build` block (both existing-profile and fresh-init branches) when defined.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — add a step (after the postMergeCommands step) that explains the landing-policy choice with the three options and the recommended default (`issue-pr`). Document the `gh --version` warn-only behaviour for `issue-pr`. Show how to surface a selector via the native `showSelectOverlay` pattern Pi already supports.
- `eforge-plugin/skills/init/init.md` — add the same step in the Claude plugin variant, using a conversational ask instead of an overlay, including the `Bash` call to `gh --version` to detect `gh`.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — document the optional `onSuccess` argument and the precedence (option > frontmatter > config > default). Suggest using `showSelectOverlay` when the user explicitly asks to choose per-build.
- `eforge-plugin/skills/build/build.md` — document the same conversationally; show the `mcp__eforge__eforge_build` call shape with `onSuccess` as an optional field.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — list `build.onSuccess` under the build settings section.
- `eforge-plugin/skills/config/config.md` — list `build.onSuccess` under the build settings section.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the `version` field.
- `web/content/docs/configuration.md` — add a `build.onSuccess` section under the existing build subsection (where `postMergeCommands` is documented around line 333). Document defaults and trade-offs.
- `web/content/docs/concepts.md` — add a sentence to the lifecycle/finalize description noting that a successful build can complete without merging when `issue-pr` or `leave-branch` is configured.
- `docs/config.md` — add `build.onSuccess` reference entry with the three values.

## Verification

- [ ] `mcp__eforge__eforge_build { source: '...', onSuccess: 'leave-branch' }` results in a POST body containing `onSuccess: 'leave-branch'` (verify via the Claude plugin and Pi extension code paths; existing test patterns in `test/per-build-profile-override.test.ts` show how to assert the POST shape).
- [ ] `mcp__eforge__eforge_init { ..., onSuccess: 'issue-pr', postMergeCommands: [...] }` writes a `eforge/config.yaml` whose `build` block contains both `onSuccess: issue-pr` and `postMergeCommands: [...]`.
- [ ] `packages/pi-eforge/skills/eforge-init/SKILL.md` and `eforge-plugin/skills/init/init.md` both contain a section explicitly named for the landing-policy step, list the three options, identify `issue-pr` as recommended, and instruct the assistant to run `gh --version` and warn (not block) when missing.
- [ ] `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md` both document the optional `onSuccess` parameter on `eforge_build` and explain the precedence option > frontmatter > config > default.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is greater than the value on the parent branch.
- [ ] `pnpm docs:check` exits 0 (generated reference docs are in sync with content).
- [ ] `pnpm type-check` and `pnpm test` pass.
