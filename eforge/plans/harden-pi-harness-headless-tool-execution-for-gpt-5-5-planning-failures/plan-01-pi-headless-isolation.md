---
id: plan-01-pi-headless-isolation
name: Pi Harness Headless Isolation, Tool-Infra Error Classification, and Config
  Surface
branch: harden-pi-harness-headless-tool-execution-for-gpt-5-5-planning-failures/plan-01-pi-headless-isolation
agents:
  builder:
    effort: high
    rationale: Touches harness construction, DefaultResourceLoader overrides, tier
      wiring, config schema/types, and error classification across ~10 files.
      Requires careful coordination so deterministic default, explicit opt-in,
      and bare-mode semantics all hold simultaneously.
  reviewer:
    effort: high
    rationale: "Cross-cutting harness reliability change. Reviewer must verify: (a)
      isolated default actually suppresses ambient resources, (b) opt-in ambient
      still filters @eforge-build/pi-eforge, (c) agents.bare is never weaker
      than the isolated default, and (d) required custom + bridged MCP tools
      remain callable."
---

---
id: plan-01-pi-headless-isolation
name: Pi Harness Headless Isolation, Tool-Infra Error Classification, and Config Surface
depends_on: []
---

# Pi Harness Headless Isolation, Tool-Infra Error Classification, and Config Surface

## Architecture Context

The Pi harness (`packages/engine/src/harnesses/pi.ts`) constructs a Pi SDK session via `createAgentSession(...)` using `DefaultResourceLoader` to discover ambient Pi resources (extensions, skills, prompts, themes) from project-local `.pi/`, user-global `~/.pi/`, and any installed pi-packages. Today the harness only filters resources contributed by the `@eforge-build/pi-eforge` package (to prevent eforge recursion); every other ambient resource is left active.

In this repo, the project-local `.pi/extensions/eforge-dev` extension is interactive/TUI-oriented and touches `ctx.ui.theme` from `session_start`, `turn_end`, `before_agent_start`, and `tool_call` handlers. In a non-interactive eforge agent session, the global Pi theme proxy throws `Theme not initialized. Call initTheme() first.`. Pi's agent core surfaces tool-call hook failures as tool-result text, so the model sees `Theme not initialized. Call initTheme() first.` on every tool call - including the required `submit_plan_set` - and compile fails with `Planner agent completed without calling a submission tool (submit_plan_set) or emitting <skip>`.

The Claude SDK harness does not load Pi's DefaultResourceLoader, theme proxy, or project-local Pi extension runtime, which is why the `claude-sdk-4-7` rerun of the same PRD completes.

This plan makes eforge's Pi-backed agent runs deterministic by default: no ambient project/user/global Pi extensions, skills, prompts, or themes unless the user explicitly opts in via `pi.resources: 'ambient'`. The explicit `agents.bare` flag must remain at least as isolated as the deterministic default. Recursive `@eforge-build/pi-eforge` resources continue to be excluded in every mode. Pi tool-execution infrastructure errors (theme init, hook crashes) are classified as harness errors instead of passing through as model-visible tool text.

Key constraints (from CLAUDE.md / AGENTS.md):

- Provider SDK imports must remain restricted to `packages/engine/src/harnesses/`. All `DefaultResourceLoader`, `discoverAndLoadExtensions`, and pi-ai imports stay inside this directory.
- Engine emits events; consumers render. Tool-infra failures must surface as `agent:warning` / `agent:stop error` / `agent:result` lifecycle events with a typed `AgentTerminalError`, not as raw tool text.
- Tests follow project conventions: real code, no mocks, hand-crafted SDK-shaped objects through `unknown`, group by logical unit.

## Implementation

### Overview

1. Add a tier-local `pi.resources` field (`'isolated' | 'ambient'`, default `'isolated'`) to the config schema and `PiConfig` interface.
2. Plumb the resolved `resources` mode + `agents.bare` into `PiHarness` via the existing `PiHarnessOptions`.
3. In `PiHarness.run`:
   - When effective mode is **isolated** (the deterministic default, or any time `agents.bare` is true): construct `DefaultResourceLoader` overrides that return **empty arrays** for `extensions`, `skills`, `prompts`, and `themes` (after the existing `@eforge-build/pi-eforge` filter, so the counters in the debug payload remain meaningful). Skip `discoverPiExtensions` and the `discoverAndLoadExtensions(...)` / `session.bindExtensions({})` call entirely.
   - When effective mode is **ambient**: keep the existing behavior of running `DefaultResourceLoader` with the pi-eforge filter and discovering `.pi/extensions/*` (still excluding `eforge` basename), so users who explicitly opt in still cannot recurse into eforge.
   - Continue to register **eforge custom tools** (including `submit_plan_set`) and **bridged MCP tools** in the Pi `tools` allowlist in both modes. The allowlist already passes these through; this plan must not regress that path.
4. Detect Pi tool-call infrastructure failures (theme init and analogous global-state errors) on `tool_execution_end` events and on the prompt-promise rejection path. When detected, classify as a typed `AgentTerminalError('error_pi_tool_infrastructure', message)` so the engine and monitor render it as a clear infrastructure failure with remediation, rather than silently producing a no-submission compile failure.
5. Update tier wiring (`buildPiConfig` + `instanceForTier`) so:
   - `pi.resources` defaults to `'isolated'`.
   - `agents.bare: true` forces `resources = 'isolated'` regardless of the per-tier setting (bare is never weaker than the default).
   - The resolved `resources` mode is passed to `PiHarness` and stamped on the debug payload `extra` for observability.
6. Add regression tests for: resource-loader isolation, opt-in ambient still filtering `pi-eforge`, custom + bridged tools surviving the allowlist in both modes, theme-init failure classification, bare-mode upgrade to isolated, and preservation of existing result-text extraction.
7. Update `docs/config.md` to document the new `pi.resources` field, the deterministic-default behavior, the `agents.bare` invariant, and the explicit opt-in path with its risk note.

### Key Decisions

1. **Isolation lives in the harness, not the resource loader.** Instead of adding a new option to Pi's `DefaultResourceLoader` (which would require an SDK change), the existing override callbacks (`extensionsOverride`, `skillsOverride`, `promptsOverride`, `themesOverride`) are extended to return empty arrays under isolated mode. This works with the SDK as shipped and keeps the change inside `packages/engine/src/harnesses/`.

2. **`agents.bare` is the strongest setting, not a synonym.** `bare` historically meant "skip extension auto-discovery" but did not suppress `DefaultResourceLoader`. To preserve the `bare = maximum isolation` invariant promised in the PRD, the registry coerces `resources = 'isolated'` whenever `bare: true`, regardless of the per-tier `pi.resources` value. The deterministic default already matches this; the coercion only matters when a user opts into `ambient` and then sets `bare: true`.

3. **Recursive `@eforge-build/pi-eforge` is filtered in every mode.** The existing `isEforgePiResource` filter runs first, then the isolation step decides whether to drop the remainder. This preserves the existing anti-recursion guarantee and keeps the `eforgeExtensionsFiltered` / `eforgeSkillsFiltered` / `eforgePromptsFiltered` / `eforgeThemesFiltered` counters meaningful in both modes.

4. **Classify infra failures with a typed terminal subtype.** Add `'error_pi_tool_infrastructure'` to `AgentTerminalSubtype` and a focused `isPiToolInfrastructureError(message)` matcher that recognizes `Theme not initialized. Call initTheme() first.` and the closely related `initTheme()` pattern. The matcher is intentionally narrow (single, well-attested string family) - broader heuristics belong in a follow-up if other classes of infra failures surface. On detection during `tool_execution_end`, abort the Pi session and throw the typed error from `run()`'s `finally`/catch path so the engine sees a clear terminal subtype.

5. **No belt-and-suspenders `initTheme()` call by default.** The PRD permits defensive theme initialization only when `resources: 'ambient'` is opted in. To keep this plan focused and avoid coupling to Pi's TUI internals, defensive `initTheme()` is **not** added in this plan. Ambient mode preserves today's behavior; a follow-up may add an opt-in defensive init if real-world ambient use surfaces the same crash.

6. **`discoverPiExtensions` semantics are unchanged in shape.** The `bare` flag in this helper already gated `.pi/extensions` discovery for coding agents. We now gate it on the resolved isolated mode (i.e. `bare || resources === 'isolated'`), which is a strict superset of the previous condition. Existing tests for `discoverPiExtensions` keep their meaning; one test is updated to assert isolated-mode short-circuit.

## Scope

### In Scope

- New tier-local config field `pi.resources: 'isolated' | 'ambient'` with default `'isolated'`.
- Honoring the resolved isolation mode in `PiHarness.run`: empty-array overrides for `DefaultResourceLoader` extensions/skills/prompts/themes, and short-circuiting `discoverPiExtensions` + extension binding.
- `agents.bare: true` always forces `resources = 'isolated'` at registry construction time.
- Continued filtering of `@eforge-build/pi-eforge` in all modes.
- New `AgentTerminalSubtype` value `'error_pi_tool_infrastructure'`, plus a narrow detector for `Theme not initialized. Call initTheme() first.` and the `initTheme()` family of strings on Pi tool-result text and prompt rejection messages. Throws a typed `AgentTerminalError` so the engine surfaces it as a build failure with clear remediation in `agent:stop`.
- Debug payload `extra` is extended with `resourcesMode: 'isolated' | 'ambient'` so monitor/diagnostic tooling can render the effective mode.
- Regression tests covering the above.
- Doc updates in `docs/config.md` for `pi.resources`, deterministic default, bare invariant, and opt-in ambient.

### Out of Scope

- Changes to the Claude SDK harness or `eforge-resource-filter.ts` constants (already correct).
- Redesigning or rewriting `.pi/extensions/eforge-dev/index.ts` itself.
- Live GPT-5.5 integration tests. All tests use real code with hand-crafted SDK-shaped objects.
- Defensive `initTheme()` execution under ambient mode (deferred to a follow-up).
- Broader heuristics for non-theme Pi infra failures.
- New monitor UI surfaces beyond the existing `agent:stop`/`agent:warning` rendering.
- Pi extension `eforge-dev` behavior changes; the project-local extension keeps its current TUI behavior, just no longer loads inside eforge-run agent sessions by default.

## Files

### Create

- `test/pi-harness-resource-isolation.test.ts` - Unit tests for the resource-loader override builder used by `PiHarness`. Constructs hand-crafted `LoadedExtension` / `LoadedSkill` / `LoadedPrompt` / `LoadedTheme` shapes (cast through `unknown`) and asserts: (a) isolated mode returns empty arrays, (b) ambient mode preserves non-eforge resources but still drops `@eforge-build/pi-eforge`-owned and project-local `pi-eforge` paths via `isEforgePiResource`, (c) the per-category filtered counters increment correctly in both modes, (d) the resolved mode appears in the debug payload's `extra.resourcesMode` field. To keep harness construction testable without an SDK round-trip, extract the override-building logic into a small named helper in `pi.ts` (e.g. `buildResourceLoaderOverrides({ mode })`) and export it via `piHarnessInternalsForTest`.
- `test/pi-harness-tool-error-classification.test.ts` - Unit tests for a new exported predicate `isPiToolInfrastructureError(message)` (placed alongside `isTransientTransportError` in `packages/engine/src/harness.ts`). Asserts: (a) the canonical string `Theme not initialized. Call initTheme() first.` is matched, (b) leading/trailing whitespace and case variations are matched, (c) unrelated tool-result text (`File not found`, `permission denied`, JSON tool payloads) is NOT matched, (d) `classifyAgentTerminalSubtype` returns `'error_pi_tool_infrastructure'` for an `AgentTerminalError` of that subtype and for a plain message containing the theme-init pattern.

### Modify

- `packages/engine/src/config.ts` - In `piConfigSchema`, add `resources: z.enum(['isolated', 'ambient']).optional().describe('Whether ambient Pi resources (project/user/global extensions, skills, prompts, themes) are loaded into eforge agent sessions. Default \'isolated\'.')`. In the `PiConfig` interface, add `resources: 'isolated' | 'ambient'` (required after defaulting in `buildPiConfig`). Keep `extensions.autoDiscover`'s default at `true` so user behavior under explicit `ambient` is unchanged.
- `packages/engine/src/agent-runtime-registry.ts` - In `buildPiConfig`, default `resources` to `'isolated'`. In `instanceForTier`, after building `piCfg`, coerce `piCfg.resources = 'isolated'` whenever `config.agents.bare === true` (record the prior value internally only if it differs - no event emission required; the harness debug payload will surface the effective mode). Pass `piConfig: piCfg` to `PiHarness` as today (the harness reads `piCfg.resources` directly). Include `resources` in the memoization key (`makeKey`) so isolated and ambient harness instances are not shared across tiers.
- `packages/engine/src/harnesses/pi.ts` - Read `this.piConfig?.resources` (or treat `undefined` as `'isolated'` defensively) to compute the effective isolation mode. Extract a named helper `buildResourceLoaderOverrides({ mode, cwd, settingsManager })` that returns the four override callbacks plus counters; isolated mode returns empty arrays after the `isEforgePiResource` pass, ambient mode preserves today's behavior. Replace the inline override block (~lines 554-604) with this helper. Gate `discoverPiExtensions` and the `discoverAndLoadExtensions` + `session.bindExtensions({})` block on `!this.bare && mode === 'ambient'`. Extend the `onDebugPayload` `extra` object with `resourcesMode: mode` and keep the existing `bare` field. Subscribe to `tool_execution_end` events: if the result text (after the existing `truncateOutput` step is bypassed for classification - classify the *raw* result) matches `isPiToolInfrastructureError`, set `error = 'Pi tool-call infrastructure failure: <message>'`, call `session.abort()`, and after the prompt loop unwinds, throw `new AgentTerminalError('error_pi_tool_infrastructure', error)` from the existing `if (error) { throw ... }` branch. Also wrap the prompt-rejection path so a thrown `Theme not initialized` from `session.prompt(...)` is classified the same way. Export `piHarnessInternalsForTest.buildResourceLoaderOverrides` and `piHarnessInternalsForTest.isPiToolInfrastructureError` for unit tests. Eforge custom tools and bridged MCP tools must remain in the `tools` allowlist in both isolated and ambient modes - this is the existing behavior and must be asserted by a regression test in `pi-harness-resource-isolation.test.ts`.
- `packages/engine/src/harnesses/pi-extensions.ts` - No public API change. Add a brief JSDoc note clarifying that callers (i.e. `PiHarness`) skip this helper entirely under the isolated mode; the helper itself remains unchanged. The existing `eforge` basename filter is retained.
- `packages/engine/src/harness.ts` - Add `'error_pi_tool_infrastructure'` to the `AgentTerminalSubtype` union. Add and export `isPiToolInfrastructureError(message: string): boolean` next to `isTransientTransportError`. Extend `classifyAgentTerminalSubtype` to return `'error_pi_tool_infrastructure'` for messages matching `isPiToolInfrastructureError` (after the transient-transport check, so unrelated transport errors keep their existing subtype). Add a JSDoc block above the new subtype describing the remediation hint that consumers should render (e.g. "Set `pi.resources: ambient` only if you intentionally want project/user/global Pi extensions inside eforge agent sessions, and ensure those extensions guard `ctx.ui.theme` access for headless SDK contexts.").
- `test/pi-extension-discovery.test.ts` - No behavior changes to `discoverPiExtensions`. Add one new test asserting that the helper still returns extensions in the existing way when called directly (regression guard), and add a comment in the file header noting that `PiHarness` now short-circuits the helper entirely under isolated mode (see `pi-harness-resource-isolation.test.ts`). Existing tests remain.
- `test/agent-runtime-registry.test.ts` - Add tests asserting: (a) the default `PiConfig.resources` is `'isolated'` when omitted, (b) explicit `pi.resources: 'ambient'` is preserved, (c) `agents.bare: true` forces `resources = 'isolated'` even when the tier sets `'ambient'`, (d) the memoization key differs between isolated and ambient Pi tiers with otherwise identical settings.
- `test/pi-harness-result-extraction.test.ts` - No changes required, but verify it continues to pass; this plan must not regress streamed result-text extraction.
- `docs/config.md` - In the Pi backend tiers section (around line 213+) add a new subsection "Headless resource isolation" documenting: (i) the deterministic-by-default `pi.resources: 'isolated'` behavior, (ii) what is suppressed (ambient project/user/global Pi extensions, skills, prompts, themes) and what is preserved (eforge custom tools, bridged MCP tools from `tools.toolbelts`, the `@eforge-build/pi-eforge` filter), (iii) the explicit opt-in (`pi.resources: 'ambient'`) and its risk note (project-local Pi extensions must guard TUI state access if they are to function under headless SDK execution), (iv) the `agents.bare: true` invariant (forces isolated regardless of `pi.resources`), and (v) the typed `error_pi_tool_infrastructure` failure that surfaces when an ambient Pi extension throws during tool-call dispatch.

## Verification

- [ ] `pnpm type-check` exits zero after the changes; `PiConfig.resources` is required at the type level after `buildPiConfig` and the `pi.resources` enum is part of the exported config schema.
- [ ] `pnpm test` exits zero. All new and existing tests in `test/pi-harness-resource-isolation.test.ts`, `test/pi-harness-tool-error-classification.test.ts`, `test/pi-extension-discovery.test.ts`, `test/pi-harness-result-extraction.test.ts`, `test/agent-runtime-registry.test.ts`, and `test/eforge-resource-filter.test.ts` pass.
- [ ] With no `pi.resources` declared in a Pi tier (default isolated), `buildResourceLoaderOverrides({ mode: 'isolated' })` returns overrides whose `extensions`, `skills`, `prompts`, and `themes` arrays are length-0 after running against hand-crafted base resources that include one `@eforge-build/pi-eforge` entry and three non-eforge entries.
- [ ] With `pi.resources: 'ambient'` declared, the same hand-crafted input yields exactly the three non-eforge entries per category (the `@eforge-build/pi-eforge` filter still fires).
- [ ] With `agents.bare: true` and `pi.resources: 'ambient'` declared on the tier, the registry passes `resources: 'isolated'` to the `PiHarness` constructor (asserted via the harness debug payload `extra.resourcesMode`).
- [ ] `isPiToolInfrastructureError('Theme not initialized. Call initTheme() first.')` returns `true`; `isPiToolInfrastructureError('File not found')`, `isPiToolInfrastructureError('Tool result: ok')`, and `isPiToolInfrastructureError('')` return `false`.
- [ ] `classifyAgentTerminalSubtype(new Error('Theme not initialized. Call initTheme() first.'))` returns `'error_pi_tool_infrastructure'`; `classifyAgentTerminalSubtype(new AgentTerminalError('error_pi_tool_infrastructure', '...'))` also returns `'error_pi_tool_infrastructure'`.
- [ ] The `tools` allowlist passed to `createAgentSession` includes every eforge custom tool name (asserted by inspecting the debug payload `tools` array for `submit_plan_set` when `customTools` includes it) in both isolated and ambient modes.
- [ ] The `tools` allowlist also includes every bridged MCP tool name when `mcpServers` is non-empty, in both isolated and ambient modes.
- [ ] The debug payload `extra` object includes a string field `resourcesMode` whose value is exactly `'isolated'` or `'ambient'`, matching the resolved mode.
- [ ] `docs/config.md` contains a new "Headless resource isolation" subsection under Pi backend tiers that mentions all five points listed in the Files > Modify > `docs/config.md` entry, and a `grep` for `pi.resources` in `docs/config.md` returns at least one match.
