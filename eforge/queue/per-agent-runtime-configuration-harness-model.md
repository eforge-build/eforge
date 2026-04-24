---
title: Per-Agent Runtime Configuration (Harness + Model)
created: 2026-04-24
---

# Per-Agent Runtime Configuration (Harness + Model)

## Problem / Motivation

Today, an eforge run configures a single backend (Claude SDK or Pi) globally and every agent shares it. This creates two problems:

- **No mixed-runtime runs.** Users cannot run the planner on Claude SDK with Opus while running the builder on Pi with a local LLM. The cheap parts of the pipeline cannot run on a local model while the expensive cognitive parts stay on frontier models.
- **Terminology muddle.** "Backend" is really an *agent harness* (execution engine: Claude Agent SDK or Pi); the thing a role binds to is a named bundle of `harness + harness-config (+ default model)`.

The change unlocks mixed-runtime eval variants ("Opus planner + local builder vs. Sonnet-all-the-way-down").

## Goal

Allow each agent (planner, builder, reviewer, etc.) to pick its own execution runtime, via a named `agentRuntimes` map that bundles a harness with its config and optional default model, while renaming the "backend" concept to "harness"/"profile" throughout the codebase.

## Approach

### Config shape

Top-level schema (`packages/engine/src/config.ts`):

```yaml
agentRuntimes:
  opus:
    harness: claude-sdk
    claudeSdk: { disableSubagents: false }

  pi-openrouter:                         # pi harness routed through openrouter
    harness: pi
    pi:
      apiKey: env:OPENROUTER_API_KEY
      thinkingLevel: high
      extensions: { autoDiscover: true }

  pi-anthropic:                          # second pi instance, different provider + key
    harness: pi
    pi:
      apiKey: env:ANTHROPIC_API_KEY
      thinkingLevel: xhigh

defaultAgentRuntime: opus                 # required when agentRuntimes is non-empty

agents:
  models:
    max:      { id: claude-opus-4-7 }
    balanced: { id: claude-sonnet-4-6 }
  roles:
    planner:
      agentRuntime: opus
      model: { id: claude-opus-4-7 }
    builder:
      agentRuntime: pi-openrouter
      model: { provider: openrouter, id: qwen/qwen3-coder }
    reviewer:
      agentRuntime: pi-anthropic
      model: { provider: anthropic, id: claude-opus-4-7 }
```

Each named Pi entry targets one provider, with its `pi.apiKey` matched to that provider's credentials. Two Pi entries coexist cleanly because each owns its own `pi:` config block - no shared global state. Pi's file-backed auth (`~/.pi/agent/auth.json`) still works when `apiKey` is omitted.

**Removals** (rip cleanly, no compat per memory): scalar top-level `backend`, top-level `pi:`, top-level `claudeSdk:`. They move inside each `agentRuntimes.<name>` entry.

**Zod changes** (`packages/engine/src/config.ts`):
- `harnessSchema = z.enum(['claude-sdk', 'pi'])` (replaces `backendSchema`).
- `agentRuntimeEntrySchema = z.object({ harness, claudeSdk?, pi? })` with `superRefine` rejecting cross-kind sub-blocks (e.g. `harness: pi` + `claudeSdk: {...}`).
- Top-level `agentRuntimes: z.record(z.string(), agentRuntimeEntrySchema).optional()`, `defaultAgentRuntime: z.string().optional()`.
- `agents.roles.*` gains `agentRuntime: z.string().optional()`.
- Cross-field refinements: `defaultAgentRuntime` must reference an existing entry; every `agents.roles.*.agentRuntime` must reference an existing entry.
- `ModelRef` provider-ness validation becomes per-role (resolve role's agentRuntime → harness → check). For the global `agents.model` / `agents.models.*` defaults: move provider-ness check from schema-time to resolve-time (so the resolver can use the role's chosen harness to judge the ref). Error message includes provenance ("role builder resolved { id: x } from agents.model but harness pi requires provider").

### Harness registry & engine lifecycle

New file: `packages/engine/src/agent-runtime-registry.ts`

```ts
export interface AgentRuntimeRegistry {
  forRole(role: AgentRole): AgentHarness;              // resolves role → config name → harness instance
  byName(name: string): AgentHarness;                   // direct lookup
  nameForRole(role: AgentRole): string;                 // for telemetry
  readonly configured: ReadonlySet<string>;             // all declared config names
}

export function singletonRegistry(harness: AgentHarness): AgentRuntimeRegistry;  // test adapter
```

Implementation: lazy. Only dynamically imports `./backends/pi.js` the first time an entry with `harness: pi` is requested. Instances are memoized by config name - two roles pointing at the same `agentRuntime` share one harness instance.

`EforgeEngine` (`packages/engine/src/eforge.ts`):
- Replace `private readonly backend: AgentBackend` (L121) with `private readonly agentRuntimes: AgentRuntimeRegistry`.
- Replace `EforgeEngineOptions.backend?: AgentBackend` with `agentRuntimes?: AgentRuntimeRegistry | AgentHarness` (single-harness argument auto-wraps in `singletonRegistry` for tests).
- In `create()` (L151-214): remove the scalar-backend branch and the Pi dynamic-import block; build the registry from `config.agentRuntimes` + `config.defaultAgentRuntime`.
- Rename all internal callsites that pass `this.config.backend` to `resolveAgentConfig` (L377, 412, 595, 629, 688, 727, 884) - the new `resolveAgentConfig` no longer takes a harness-kind parameter (it derives the harness from the role's config internally).

### Interface & type renames

Mechanical rename pass (all in `packages/engine/src/`):
- `AgentBackend` → `AgentHarness` (`backend.ts` L129-148)
- `ClaudeSDKBackend` → `ClaudeSDKHarness` (`backends/claude-sdk.ts`)
- `PiBackend` → `PiHarness` (`backends/pi.ts`)
- `StubBackend` → `StubHarness` (`test/stub-backend.ts`)
- `BackendDebugCallback` / `BackendDebugPayload` → `HarnessDebugCallback` / `HarnessDebugPayload`
- Directory `packages/engine/src/backends/` → `packages/engine/src/harnesses/`

The file name `backends/pi.ts` → `harnesses/pi.ts` is worth the paperwork since the AGENTS.md SDK-import restriction doc-block references it.

### Pipeline context

`packages/engine/src/pipeline/types.ts` L20:
- `backend: AgentBackend` → `agentRuntimes: AgentRuntimeRegistry`

23 stage call sites in `packages/engine/src/pipeline/stages/{build-stages,compile-stages}.ts` change from:
```ts
runBuilder({ backend: ctx.backend, ...agentRuntime, ... })
```
to:
```ts
runBuilder({ harness: ctx.agentRuntimes.forRole('builder'), ...agentRuntime, ... })
```

Agent function signatures (`packages/engine/src/agents/*.ts`) update the options field name `backend: AgentBackend` → `harness: AgentHarness`. Body unchanged.

### Model resolution (`packages/engine/src/pipeline/agent-config.ts`)

Replace the `backend: 'claude-sdk' | 'pi'` parameter plumbing with a pre-step that resolves the role's agentRuntime → harness kind:

```ts
export function resolveAgentRuntimeForRole(
  role: AgentRole,
  config: EforgeConfig,
): { agentRuntimeName: string; harness: 'claude-sdk' | 'pi' } {
  const ref = config.agents?.roles?.[role]?.agentRuntime ?? config.defaultAgentRuntime;
  if (!ref) throw new Error(`No agentRuntime for role "${role}" and no defaultAgentRuntime set.`);
  const entry = config.agentRuntimes?.[ref];
  if (!entry) throw new Error(`Role "${role}" references agentRuntime "${ref}" which is not declared.`);
  return { agentRuntimeName: ref, harness: entry.harness };
}
```

`resolveAgentConfig(role, config, planEntry?)` drops its third parameter - it calls `resolveAgentRuntimeForRole` internally and passes `.harness` to the existing `resolveModel`. Add `agentRuntimeName: string` and `harness: 'claude-sdk' | 'pi'` to `ResolvedAgentConfig` (both surfaced in events and monitor hover).

`MODEL_CLASS_DEFAULTS` (L74-85) stays keyed by harness. Per-role class defaults (`AGENT_MODEL_CLASSES`, L47-71) unchanged.

### Plan-file per-agent override

`packages/engine/src/events.ts` L43-54, `PlanFile.agents.<role>`:
- Add `agentRuntime?: string` alongside existing `effort?`, `thinking?`, `rationale?`.
- Thread `planEntry` into `resolveAgentRuntimeForRole` (highest precedence).
- Plan-load-time validation: referenced name must exist in config's `agentRuntimes`.

### Events & monitor UI

`packages/engine/src/events.ts` L238-240, `agent:start`:
- Replace `backend: string` with **two fields**: `agentRuntime: string` (the name, e.g. `"opus"`) and `harness: 'claude-sdk' | 'pi'` (the kind).
- Monitor UI stage hover renders `"planner → opus (claude-sdk, claude-opus-4-7)"`.
- `ModelTracker` unchanged; still tracks model IDs for the `Models-Used:` trailer.

### Profile system (kept as config fragments)

Per user decision, keep the marker-file profile system. Repurpose:
- Profile files define `agentRuntimes:` (and optional `defaultAgentRuntime`, `agents:` overrides) that merge over `config.yaml`.
- Rename directory `eforge/backends/` → `eforge/profiles/` and marker file `.active-backend` → `.active-profile` - the terminology clash is gone.
- `loadBackendProfile` → `loadProfile`, `setActiveBackend` → `setActiveProfile`, `listBackendProfiles` → `listProfiles`, etc. (`packages/engine/src/config.ts` L748-1073).
- Merge order unchanged: global → project config → active profile → `resolveConfig()`.

### MCP tool & slash command surface

`eforge_backend` MCP tool → rename to `eforge_profile`:
- `packages/pi-eforge/extensions/eforge/index.ts` L598
- `packages/eforge/src/cli/mcp-proxy.ts` L415

Slash commands (`eforge-plugin/skills/`):
- `/eforge:backend` → `/eforge:profile` (list/switch active profile)
- `/eforge:backend-new` → `/eforge:profile-new` (scaffold a profile file with `agentRuntimes:` + `defaultAgentRuntime`)

HTTP routes (`packages/monitor/src/server.ts`): `/backends` → `/profiles`, `/backends/active` → `/profiles/active`. Register via `API_ROUTES` in `packages/client/src/api-version.ts` - bump `DAEMON_API_VERSION` (breaking).

Bump `eforge-plugin/.claude-plugin/plugin.json` to 0.8.0. Keep `packages/pi-eforge/` skill set + plugin skill set in sync (add/remove identically).

### Migration (breaking release)

- Loader rejects scalar top-level `backend:` + top-level `pi:` / `claudeSdk:` with a clear migration message pointing at `agentRuntimes:` + `defaultAgentRuntime:`.
- Existing `eforge/backends/*.yaml` profiles auto-moved to `eforge/profiles/` on first load (or rejected with a warning if not auto-migrated - see implementation order).
- Release note + CHANGELOG entry produced by the release flow (per memory: CHANGELOG is release-flow-owned).

### Implementation order (each commit keeps the tree green)

1. **Schema + types, non-breaking additions.** Add `agentRuntimes`, `defaultAgentRuntime`, `agents.roles.*.agentRuntime` to schema + `EforgeConfig`. Add `resolveAgentRuntimeForRole`. Keep scalar `backend` + top-level `pi` / `claudeSdk` alive (coexist). Unit tests for the new resolver.
2. **Resolver rewrite.** `resolveAgentConfig` drops its harness-kind parameter; internally uses `resolveAgentRuntimeForRole`. All 14 callers updated. Add `agentRuntimeName` + `harness` fields to `ResolvedAgentConfig`.
3. **Engine + registry.** Add `AgentRuntimeRegistry`, `singletonRegistry`. Wire `EforgeEngine.agentRuntimes`. Adapt test harness injections.
4. **Pipeline + stages.** `ctx.backend` → `ctx.agentRuntimes`, 23 callsites. Agent function options rename `backend` → `harness`.
5. **Interface & directory renames.** `AgentBackend` → `AgentHarness`, `backends/` → `harnesses/`, class renames. Mostly mechanical; test suite green at each step.
6. **Rip the old shape.** Delete scalar `backend`, top-level `pi`, top-level `claudeSdk`. Delete the one-entry-registry bridge from step 3. Update loader rejection message. Update `agent:start` event fields (`backend` → `agentRuntime` + `harness`).
7. **Plan-file override.** Add `agentRuntime` to `PlanFile.agents.<role>`. Plumb through `resolveAgentRuntimeForRole`.
8. **Profile system rename.** `eforge/backends/` → `eforge/profiles/`; `.active-backend` → `.active-profile`; `eforge_backend` tool → `eforge_profile`; slash commands; HTTP routes; `DAEMON_API_VERSION` bump; plugin version bump.
9. **Docs.** README, AGENTS.md, plugin READMEs. (CHANGELOG owned by release flow - do not edit.)

### Critical files

- `packages/engine/src/config.ts` - schema, type, migration errors, profile loader rename
- `packages/engine/src/backend.ts` → rename interface; `packages/engine/src/harnesses/{claude-sdk,pi}.ts` - directory & class renames
- `packages/engine/src/agent-runtime-registry.ts` - NEW
- `packages/engine/src/eforge.ts` - engine lifecycle, 6 `resolveAgentConfig` callsites
- `packages/engine/src/pipeline/types.ts` - `PipelineContext` shape
- `packages/engine/src/pipeline/stages/{build-stages,compile-stages}.ts` - 23 callsites
- `packages/engine/src/pipeline/agent-config.ts` - `resolveAgentRuntimeForRole`, `resolveAgentConfig` signature, `ResolvedAgentConfig` fields
- `packages/engine/src/agents/*.ts` - field rename `backend` → `harness` (mechanical, ~25 files)
- `packages/engine/src/events.ts` - `agent:start` fields, `PlanFile.agents.*.agentRuntime`
- `packages/monitor-ui/` - stage hover rendering
- `packages/pi-eforge/extensions/eforge/index.ts` + `packages/eforge/src/cli/mcp-proxy.ts` - MCP tool rename
- `eforge-plugin/skills/backend/` + `backend-new/` - slash command rename
- `eforge-plugin/.claude-plugin/plugin.json` - version bump
- `packages/monitor/src/server.ts` + `packages/client/src/api/*.ts` - HTTP route rename, `DAEMON_API_VERSION` bump

## Scope

### In scope

- New `agentRuntimes` + `defaultAgentRuntime` config schema with Zod validation and cross-field refinements.
- `agents.roles.*.agentRuntime` per-role binding.
- New `AgentRuntimeRegistry` with lazy Pi loading and per-config-name memoization.
- Rename pass: `AgentBackend` → `AgentHarness`, `*Backend` classes → `*Harness`, `backends/` dir → `harnesses/`, debug callback types.
- `EforgeEngine` lifecycle rewiring (`backend` → `agentRuntimes`).
- Pipeline context + 23 stage callsite updates; agent function options field rename.
- Model resolution rewrite: `resolveAgentRuntimeForRole`, new `ResolvedAgentConfig` fields, per-role provider-ness validation at resolve time.
- Plan-file `agentRuntime?` override with load-time validation (highest precedence: plan > role > default).
- `agent:start` event: replace `backend` with `agentRuntime` + `harness` fields.
- Monitor UI stage hover rendering of agentRuntime + harness + model.
- Removal (rip cleanly, no compat): scalar top-level `backend`, top-level `pi:`, top-level `claudeSdk:`; loader rejection message.
- Profile system rename: `eforge/backends/` → `eforge/profiles/`, `.active-backend` → `.active-profile`, loader function renames; profile files define `agentRuntimes:` + optional `defaultAgentRuntime` / `agents:` overrides; merge order unchanged.
- MCP tool rename `eforge_backend` → `eforge_profile` in both `packages/pi-eforge/extensions/eforge/index.ts` and `packages/eforge/src/cli/mcp-proxy.ts`.
- Slash commands rename: `/eforge:backend` → `/eforge:profile`, `/eforge:backend-new` → `/eforge:profile-new`.
- HTTP route rename `/backends` → `/profiles` and `/backends/active` → `/profiles/active` via `API_ROUTES`; `DAEMON_API_VERSION` bump (breaking).
- Plugin version bump to 0.8.0; keep `packages/pi-eforge/` skill set + plugin skill set in sync.
- Auto-migrate existing `eforge/backends/*.yaml` profiles on first load (or warn-reject per implementation order).
- Docs updates: README, AGENTS.md, plugin READMEs.

### Out of scope

- Eval harness updates (`--backend` → `--profile`, `eval/eforge/backends/` → `eval/eforge/profiles/`, `backend-envs.yaml` → `profile-envs.yaml`, `result.json` field shape, mixed-runtime variant smoke test) - tracked as a **separate follow-on PRD**: `tmp/eval-harness-per-agent-config.md`. Lands after this PRD.
- CHANGELOG entries (owned by release flow per memory; do not edit in this PR).
- Pi package version bump in `packages/pi-eforge/package.json` (versioned at npm publish time).

### Open paperwork decisions (defer to review)

- Exact names: `agentRuntimes:` vs. `agentRuntimes:` vs. `runtimes:`. Plan uses `agentRuntimes:` per earlier conversation; open to alternative.
- Whether to ship an `eforge init --migrate` helper or rely on the rejection-message migration path.

## Acceptance Criteria

### Build & type checks

- `pnpm build && pnpm test && pnpm type-check` green at each commit boundary along the 9-step implementation order.

### Unit + integration tests

- `packages/engine/test/agent-runtime-registry.test.ts` - lazy Pi load; shared instance for two roles using same name; throws on unknown name.
- `packages/engine/test/agent-config.resolution.test.ts` - `resolveAgentRuntimeForRole` precedence (plan > role > default); missing/dangling reference errors; per-role ModelRef provider-ness validation at resolve time.
- `packages/engine/test/agent-config.mixed-harness.test.ts` - config with planner on claude-sdk and builder on pi; validate each resolves to the correct class defaults table.
- `test/agent-wiring.test.ts` - adapt stub injection to `singletonRegistry(stub)`. Add case: two stubs, two roles, dispatch verification.
- `packages/engine/test/plan-file.agent-config.test.ts` - plan-level `agentRuntime` override wins; validation failure when plan references undeclared config.
- Integration: one eval scenario run through a mixed-runtime profile; verify `agent:start` events show the correct `agentRuntime` + `harness` per role.

### Manual verification

- `eforge init` scaffolds a config using `agentRuntimes:`.
- `/eforge:profile` lists profiles.
- `/eforge:profile new <name>` scaffolds one.
- `eforge enqueue` kicks off a build with mixed-runtime config.
- Monitor UI shows per-agent `agentRuntime` + `harness` + `model` in stage hover (e.g. `"planner → opus (claude-sdk, claude-opus-4-7)"`).

### Migration behavior

- Loader rejects scalar top-level `backend:` + top-level `pi:` / `claudeSdk:` with a clear migration message pointing at `agentRuntimes:` + `defaultAgentRuntime:`.
- Existing `eforge/backends/*.yaml` profiles auto-moved to `eforge/profiles/` on first load (or rejected with warning per implementation order).

### Version + release

- `eforge-plugin/.claude-plugin/plugin.json` bumped to 0.8.0.
- `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` bumped (breaking) for HTTP route rename.
- `packages/pi-eforge/package.json` version untouched.
- CHANGELOG.md not edited in this PR.
