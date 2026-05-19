---
title: Add guided toolbelt UX and presets for least-privilege MCP configuration
created: 2026-05-19
profile: gpt-claude-combo
---

# Add guided toolbelt UX and presets for least-privilege MCP configuration

## Problem / Motivation

eforge already has a runtime toolbelt system, docs, validation, and observability, but users do not have a guided UX that helps them define useful least-privilege MCP toolbelts.

Evidence reviewed:

- `docs/roadmap.md`: no explicit toolbelt UX item exists. The work aligns with the Integration & Maturity goal by making provider/tool configuration safer and easier, but it is not currently roadmapped.
- `web/content/docs/configuration.md` and `web/content/reference/config.md`: toolbelts are already documented as declarative bundles of project MCP servers from `.mcp.json`, with `browser-ui` / Playwright as the canonical example.
- `packages/engine/src/config.ts`: runtime schema already supports `tools.toolbelts`, reserved name validation (`none`), tier `toolbelt` references, and cross-reference validation against `.mcp.json` server names.
- `packages/pi-eforge/extensions/eforge/profile-commands.ts`: native Pi `/eforge:profile:new` is a guided overlay wizard for scope, tiers, harness/provider/model/effort, but it does not ask about toolbelt presets or modify `.mcp.json` / `eforge/config.yaml`. `buildYamlPreview` can render `toolbelt` and `tools.toolbelts`, but `buildProfileCreatePayload` currently emits only `name`, `scope`, `agents`, and optional `metadata`.
- `packages/pi-eforge/extensions/eforge/config-command.ts`: native `/eforge:config` is a read-only structured viewer and does not surface or author toolbelts.
- `packages/monitor/src/server.ts` and `packages/eforge/src/cli/mcp-proxy.ts`: profile creation via daemon/MCP forwards `agents` and metadata, not arbitrary `tools` blocks. This reinforces the existing split: toolbelt registry lives in config layers; profile files select named toolbelts on tiers.
- `packages/pi-eforge/skills/eforge-profile-new/SKILL.md` and `eforge-plugin/skills/profile-new/profile-new.md`: fallback skills mention when to use an MCP-backed `browser-ui` profile, but do not provide a full guided preset gallery.
- Current project `.mcp.json`: has `eval` and `schaake-os` servers, not Playwright. This shows the UX must handle both existing servers and missing recommended servers.

User-facing gap:

- User asked how to use toolbelts and whether a UX exists for guiding users to define them.
- Code inspection confirms `/eforge:profile:new` currently guides scope and per-tier harness/provider/model/effort only (`packages/pi-eforge/extensions/eforge/profile-commands.ts`).
- Native `/eforge:config` is read-only and does not surface toolbelts (`packages/pi-eforge/extensions/eforge/config-command.ts`).
- Docs currently teach only the `browser-ui` Playwright pattern, not a broader preset gallery or guided workflow (`web/content/docs/configuration.md`).

Why it matters:

- Without guidance, users are likely to leave the default behavior where all `.mcp.json` project MCP servers are available to all tiers.
- Toolbelts are specifically useful for least privilege: planning can get context tools, implementation can get action tools, review/evaluation can get validation tools, and unrelated tiers can use `toolbelt: none`.
- Missing UX makes an existing feature harder to discover and more error-prone.

Initial conclusions:

- The engine/runtime foundation for toolbelts exists; the gap is primarily authoring UX, preset guidance, and docs/skill parity.
- A low-risk implementation can avoid changing the engine toolbelt model: add helpers around config/profile file mutation and wire them into Pi’s native profile-new flow and fallback skill docs.
- The safest UX should preserve least privilege: recommend explicit tier assignments (`none` for tiers that do not need project MCP access) rather than silently keeping the “all servers” default.

Roadmap relation:

- Not explicitly listed in `docs/roadmap.md`, but consistent with Integration & Maturity by improving safe configuration workflows.

## Goal

Add a guided, least-privilege toolbelt preset experience to profile/config setup so users can safely select MCP tool access per tier without changing existing engine runtime semantics.

The first implementation should focus on Pi native profile creation plus docs/skill parity, with conservative file mutation only where safe and valid.

## Approach

### Recommended eforge profile

Recommended eforge profile: **Excursion**.

Rationale:

- This is a user-facing feature that touches multiple integration/docs/test files, but it is cohesive and can be planned by one planner.
- Runtime toolbelt semantics already exist; the work is primarily guided UX, pure helper logic, file/config safety, and documentation parity.
- It does not require delegated module planning or independent subsystem architecture. A single ordered plan can cover Pi UX, helper/tests, docs/skills, and validation.

Not Errand because the change is not purely mechanical and includes product/UX decisions. Not Expedition because there is no need for independently planned module subprojects.

### High-level implementation

1. Add toolbelt guidance to `/eforge:profile:new` first, not a new command.
   - Rationale: profile creation is where users already choose tier behavior. Toolbelts are selected per tier, so this is the most discoverable least-privilege moment.
   - Trade-off: users who want to edit toolbelts later still need docs/manual editing until a dedicated `/eforge:toolbelt` or config editor exists.

2. Keep toolbelt presets declarative and local to the integration UX.
   - Add a pure preset definition/helper module, e.g. `toolbelt-presets.ts`.
   - Presets describe name, use case, suggested MCP server names, suggested tier assignments, and setup hints.
   - Do not change engine semantics or add magic behavior to runtime config loading.

3. Prefer least-privilege assignments when a preset is chosen.
   - Example `browser-ui`: `implementation` and `review` get `toolbelt: browser-ui`; `planning` and `evaluation` get `toolbelt: none` unless the preset explicitly says otherwise.
   - Rationale: the current omitted-toolbelt default passes all project MCP servers. A guided preset should intentionally reduce access rather than leave unrelated tiers broad.

4. Write only valid references.
   - The wizard should not create a profile that references a missing named toolbelt.
   - If selected preset MCP servers already exist in `.mcp.json`, the wizard can add/update `tools.toolbelts.<name>` in `eforge/config.yaml` and assign the profile tiers.
   - If required MCP servers are missing, the wizard should either:
     - show setup instructions and leave the preset unapplied, or
     - for presets with a safe exact server command, initially Playwright, offer an explicit confirmation to add the `.mcp.json` entry before writing the toolbelt.
   - After mutation, call config validation and surface errors before creating/activating the profile.

5. Start with a curated preset gallery, but keep it small in the first build.
   - Recommended first-class presets:
     - `browser-ui` — Playwright; implementation + review.
     - `docs-research` — docs/search/fetch/context providers; planning + implementation.
     - `issue-triage` — GitHub/GitLab/Linear/Jira-style servers; planning.
     - `observability` — Sentry/Datadog/Grafana/Prometheus-style servers; planning + evaluation.
     - `database-readonly` — read-only DB MCP server; planning, optionally implementation.
     - `design-ui` — Figma + Playwright; planning + implementation + review.
   - If implementation time is tight, ship `browser-ui` plus a generic/custom existing-server path, and document additional preset candidates.

6. Preserve Pi/Claude plugin parity at the user-facing documentation layer.
   - Native overlay UX exists only in Pi, but both Pi skills and Claude Code plugin skills should describe the same toolbelt patterns and fallback workflow.
   - If plugin files change, bump `eforge-plugin/.claude-plugin/plugin.json` as required by repo policy.

7. Do not bump `packages/pi-eforge/package.json`.
   - Repo policy says Pi package versioning happens at publish time.

### Preset candidates

Initial preset candidates:

- `browser-ui`
- `docs-research`
- `issue-triage`
- `repo-review`
- `observability`
- `database-readonly`
- `api-testing`
- `design-ui`

Recommended first-class presets:

- `browser-ui` — Playwright; implementation + review.
- `docs-research` — docs/search/fetch/context providers; planning + implementation.
- `issue-triage` — GitHub/GitLab/Linear/Jira-style servers; planning.
- `observability` — Sentry/Datadog/Grafana/Prometheus-style servers; planning + evaluation.
- `database-readonly` — read-only DB MCP server; planning, optionally implementation.
- `design-ui` — Figma + Playwright; planning + implementation + review.

### File/config mutation strategy

- Existing daemon profile creation can write tier `toolbelt` fields because they are part of `agents.tiers`.
- Toolbelt registry definitions (`tools.toolbelts`) belong in `eforge/config.yaml` or merged config layers, not in the profile-create payload.
- `.mcp.json` server definitions may need a safe, explicit write path or a copy/paste preview, depending on desired implementation risk.
- Daemon `profileCreate` currently forwards only `agents` and metadata to `createAgentRuntimeProfile`; it does not accept a top-level `tools` block. This means direct toolbelt registry creation through profile creation is not currently supported.
- Engine config validation already checks tier references against declared toolbelts and `.mcp.json`, so UX must avoid writing profiles that reference undeclared toolbelts unless it also writes/updates the registry first.
- Product decision resolved by user: proceed with conservative mutating UX.
- Implementation recommendation: apply presets only when required servers already exist, plus an explicit auto-add path for `browser-ui`/Playwright because the command is already documented. For all other missing servers, show setup guidance and do not create invalid references.

Open design question for user/product confirmation:

- Should the first implementation actually mutate `.mcp.json` and `eforge/config.yaml`, or only generate a preview/instructions? The most useful UX mutates files, but the safest first slice could apply only when referenced servers already exist and otherwise show setup snippets.

### Likely code impact

Pi integration:

- `packages/pi-eforge/extensions/eforge/profile-commands.ts`
  - Add the wizard step after tier selection and before preview/confirm.
  - Render preset choices and apply selected tier `toolbelt` assignments.
  - Potentially show instructions/warnings for missing `.mcp.json` servers and missing `tools.toolbelts` declarations.
- `packages/pi-eforge/extensions/eforge/profile-payload.ts`
  - Extend pure payload helpers/types so tier selections can carry `toolbelt?: string`.
  - Keep payload limited to `agents.tiers` + metadata unless a daemon/API change is deliberately chosen.
- New likely helper module, e.g. `packages/pi-eforge/extensions/eforge/toolbelt-presets.ts`
  - Holds preset definitions and pure functions for applying presets to tier recipes.
  - Keeps wizard code smaller and testable.
- Maybe `packages/pi-eforge/extensions/eforge/config-command.ts`
  - If scope includes better visibility, add a Toolbelts section to the config viewer. Current viewer does not show `tools.toolbelts`.

Claude Code plugin / skill parity:

- `packages/pi-eforge/skills/eforge-profile-new/SKILL.md`
- `eforge-plugin/skills/profile-new/profile-new.md`
- Possibly `packages/pi-eforge/skills/eforge-config/SKILL.md` and `eforge-plugin/skills/config/config.md` if config/toolbelt editing instructions are updated.
- `eforge-plugin/.claude-plugin/plugin.json` version must be bumped if plugin files change.

Docs:

- `web/content/docs/configuration.md` for user-facing guidance.
- `packages/docs-gen/src/generators/config.ts` and generated reference/content files if generated config reference should mention preset guidance.
- Existing generated docs artifacts under `web/public/...` may need regeneration through `pnpm docs:generate` if generator-managed content changes.

Tests:

- `test/profile-payload.test.ts` for pure payload/toolbelt assignment behavior.
- `test/profile-wiring.test.ts` or a new source-grep/pure helper test for native command wiring and preset affordances.
- `test/reference-content.test.ts` for skill/docs links and expected preset content.
- Existing toolbelt runtime/config tests (`test/config.toolbelts.test.ts`, `test/toolbelt-runtime.test.ts`) should not require runtime semantic changes; add coverage only if engine validation changes.

Validation commands:

```bash
pnpm test
pnpm type-check
pnpm docs:check
```

Use `pnpm docs:check` if generated docs/reference content changes.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The first UX should live in native Pi `/eforge:profile:new`, with skill/doc parity for Claude Code, rather than a new `/eforge:toolbelt` command. | Inspected `profile-commands.ts`; this wizard already owns per-tier profile setup. Toolbelts are selected per tier. | medium-high | low | User/product confirmation; optionally inspect command registry constraints. | If wrong, implementation should create a new command and potentially a broader config editor instead. |
| The engine/runtime model does not need changes. | Inspected `config.ts`, runtime tests, docs; toolbelt schema, validation, and runtime filtering already exist. | high | low | Run existing toolbelt tests after implementation. | Engine changes would increase scope and risk. |
| Toolbelt registry definitions should remain in `eforge/config.yaml` / config layers; profile files should only select names via tier `toolbelt`. | Docs and daemon profile create path support this split; `profileCreate` forwards only `agents` and metadata. | high | low | Confirm by testing profile create with `toolbelt` fields and declared config toolbelt. | If wrong, payload/API might need to accept `tools` in profile creation. |
| Initial preset list should include `browser-ui`, `docs-research`, `issue-triage`, `observability`, `database-readonly`, and `design-ui`. | Derived from user discussion and common MCP use cases; only `browser-ui` is currently documented concretely. | medium | medium | Product/user review; look at common MCP packages and expected team workflows. | Too many presets may make UX noisy or imply unsupported server setup. |
| The wizard can safely mutate `eforge/config.yaml` and possibly `.mcp.json` from the Pi extension. | Pi extension already writes/creates profiles via daemon; package has `yaml` dependency; Node fs APIs are available in extension runtime. User confirmed conservative mutating UX. | medium-high | medium | Implement a small helper with tests; validate files after writes. | If wrong, need daemon route or preview-only approach. |
| Adding missing `.mcp.json` entries should be conservative. | Current project lacks Playwright; invalid references would fail validation. Some presets require secrets/URLs and cannot be safely auto-created. User confirmed conservative approach. | high | low | Implement exact-command auto-add only for known safe presets, e.g. Playwright, or require manual setup for others. | Unsafe auto-generation could create broken or insecure MCP config. |
| Current overlay helpers are enough for a first preset flow. | Inspected `ui-helpers.ts`; there are select/search/info overlays but no multiselect or text input helper exported. | medium | medium | Prototype with sequential single-select choices; add helper if needed. | UX may be clunky for custom multi-server toolbelts. |

Assumption review:

- Cheap/static validations completed: docs, roadmap, config schema, native Pi profile/config command code, daemon profile-create route, MCP proxy profile tool, current `.mcp.json`, package dependencies, and UI helper capabilities were inspected.
- Product decision resolved by user: proceed with conservative mutating UX.
- Implementation recommendation: apply presets only when required servers already exist, plus an explicit auto-add path for `browser-ui`/Playwright because the command is already documented. For all other missing servers, show setup guidance and do not create invalid references.

Early assumptions and unknowns:

- Assumption: initial implementation should focus on the Pi native UX plus docs/skills, not a daemon API for mutating `.mcp.json` and `eforge/config.yaml`. Confidence: medium. Validation cost: low/medium. Impact if wrong: scope increases to shared client/daemon API work.
- Assumption: `browser-ui`, `docs-research`, `issue-triage`, `observability`, `database-readonly`, and `design-ui` are useful starter presets. Confidence: medium. Validation cost: user/product decision. Impact if wrong: preset list may feel noisy or encourage unsafe MCP access.
- Unknown: whether we should create a dedicated `/eforge:toolbelt` command or fold guidance into `/eforge:profile:new` first.

## Scope

### In scope

1. Add a guided toolbelt step to the native Pi `/eforge:profile:new` wizard.
   - After tier model/effort selection, ask whether the profile should use project MCP toolbelts.
   - Offer `none / skip`, `browser-ui`, and a small preset gallery for common use cases.
   - Apply chosen presets as per-tier `toolbelt` assignments in the profile payload.

2. Introduce a shared preset definition module for the Pi integration.
   - Presets should include name, description, suggested MCP server names, suggested tier assignments, and optional `.mcp.json` setup hint text.
   - Initial preset candidates: `browser-ui`, `docs-research`, `issue-triage`, `repo-review`, `observability`, `database-readonly`, `api-testing`, `design-ui`.
   - Keep preset definitions descriptive; they should not change runtime semantics.

3. Add file/config mutation support at the integration layer only if needed for the selected UX.
   - Existing daemon profile creation can write tier `toolbelt` fields because they are part of `agents.tiers`.
   - Toolbelt registry definitions (`tools.toolbelts`) belong in `eforge/config.yaml` or merged config layers, not in the profile-create payload.
   - `.mcp.json` server definitions may need a safe, explicit write path or a copy/paste preview, depending on desired implementation risk.

4. Update fallback skills and docs.
   - Keep `packages/pi-eforge/skills/eforge-profile-new/SKILL.md` and `eforge-plugin/skills/profile-new/profile-new.md` in sync.
   - Expand configuration docs from a single `browser-ui` example to a guided preset gallery / least-privilege recommendations.
   - Add tests for source/content drift where existing docs tests already cover toolbelt references.

5. Potentially improve toolbelt visibility in config.
   - Maybe update `packages/pi-eforge/extensions/eforge/config-command.ts`.
   - If scope includes better visibility, add a Toolbelts section to the config viewer. Current viewer does not show `tools.toolbelts`.
   - Possibly update `packages/pi-eforge/skills/eforge-config/SKILL.md` and `eforge-plugin/skills/config/config.md` if config/toolbelt editing instructions are updated.

### Out of scope

- Changing engine toolbelt runtime semantics.
- Multiple toolbelts per tier; current MVP remains one `toolbelt` field per tier.
- Filtering Pi extensions, Claude Code plugins, extension-contributed tools, harness built-ins, or eforge internal tools.
- Building full MCP server install/health-check automation for every preset.
- Adding a separate `/eforge:toolbelt` command unless the implementation discovers `/eforge:profile:new` cannot provide a good enough first UX.
- Bumping `packages/pi-eforge/package.json`; repo policy says Pi package versioning happens at publish time.

## Acceptance Criteria

1. Native Pi profile creation includes toolbelt guidance.
   - `/eforge:profile:new <name>` offers an optional toolbelt/preset step after tier model setup and before YAML preview.
   - Users can skip toolbelt guidance without changing existing behavior.
   - Selecting an applicable preset results in tier YAML preview showing explicit `toolbelt` fields.

2. Presets are implemented through testable pure helpers.
   - A preset registry exposes the preset name, description/use case, suggested MCP server names, suggested tier assignments, and setup guidance.
   - Pure tests cover applying at least `browser-ui` and one non-browser preset to tier recipes.
   - Pure tests cover `toolbelt: none` assignment for tiers that should not receive project MCP servers.

3. The UX prevents invalid toolbelt references.
   - The wizard does not create a profile referencing `toolbelt: <name>` unless that toolbelt is declared in the merged/project config or is added before profile creation.
   - If required `.mcp.json` servers are missing, the UX clearly explains what is missing and how to add it.
   - Config validation errors are surfaced before the profile is reported as successfully created.

4. `browser-ui` has a concrete guided path.
   - When `playwright` exists in `.mcp.json`, the wizard can define/use `tools.toolbelts.browser-ui` and assign it to implementation/review.
   - If `playwright` is missing, the wizard shows the documented Playwright MCP snippet and, if mutation is in scope, can add it only after explicit user confirmation.

5. Documentation and fallback skills are updated.
   - Public configuration docs describe the guided toolbelt UX and preset gallery, not just the single Playwright example.
   - Pi and Claude Code profile-new skill docs stay in sync.
   - Generated docs/reference checks pass or generated artifacts are updated as appropriate.
   - If plugin files change, `eforge-plugin/.claude-plugin/plugin.json` version is bumped as required by repo policy.

6. Existing runtime semantics remain unchanged.
   - Omitted `toolbelt` still means all project MCP servers.
   - `toolbelt: none` still means no project MCP servers.
   - Named toolbelts still filter only `.mcp.json` project MCP servers.
   - Extensions, built-ins, and eforge internal tools remain outside toolbelt filtering.

7. Validation passes.
   - `pnpm type-check` passes.
   - `pnpm test` passes.
   - `pnpm docs:check` passes if docs generation/reference output is touched.
