---
id: plan-01-foundation
name: Generalize createAgentRuntimeProfile, daemon route, API version
branch: redesign-eforge-init-around-multi-runtime-profiles/foundation
---

# Generalize createAgentRuntimeProfile, daemon route, API version

## Architecture Context

The goal of this plan set is to redesign `/eforge:init` so that the skill drives all elicitation and the `eforge_init` tool becomes a pure persister that accepts a fully-formed profile spec. Profiles can declare multiple `agentRuntimes` and assign different model tiers (`max` / `balanced` / `fast`) to different runtimes (e.g. `claude-sdk` for `max`, `pi`/openrouter for `fast`).

This plan is the foundation: it generalizes the engine helper that materializes profile YAML, extends the daemon HTTP route that wraps it, exposes a small name-derivation utility for the skill+tool to share, and bumps the daemon API version. It is intentionally non-breaking - existing single-runtime callers (the current MCP proxy and Pi extension `eforge_init` paths, the `--migrate` path, and any tests that pass `{ harness, ... }`) keep working unchanged. Plan 02 then rewrites the consumers on top of this foundation.

Key existing pieces that constrain this plan:

- `eforgeConfigBaseSchema` and the `superRefine` in `packages/engine/src/config.ts` (around lines 249-285) already validate that `defaultAgentRuntime` references an existing `agentRuntimes` entry and that `agents.tiers.<tier>.agentRuntime` references an existing entry. We rely on that schema rather than re-implementing the checks.
- `agentRuntimeEntrySchema` already accepts `{ harness, pi?: { provider } }` shape with `pi.provider` schema-required for `harness: 'pi'`.
- `agents.tiers.<tier>.agentRuntime` is already a supported field on `eforgeConfigBaseSchema.agents.tiers` (line 218-222) - we do not need to add it to the schema.
- `sanitizeProfileName(harness, provider, modelId)` lives in `packages/client/src/profile-utils.ts` and is re-exported from `packages/engine/src/config.ts:1527`. We add `deriveProfileName` next to `sanitizeProfileName` so both engine and consumer code (MCP proxy, Pi extension) can use it.
- The current `createAgentRuntimeProfile` (lines 1425-1524 in `packages/engine/src/config.ts`) hard-codes `agentRuntimes: { main: <single-entry> }` and `defaultAgentRuntime: 'main'`. We extend it to accept a richer input shape (Option A in the source).
- The daemon route `POST /api/profile/create` (`packages/monitor/src/server.ts` around lines 1178-1226) currently accepts `{ name, harness, pi?, agents?, overwrite?, scope? }`. We extend it to also accept `{ name, agentRuntimes, defaultAgentRuntime, agents?, overwrite?, scope? }` and forward to the generalized helper.

## Implementation

### Overview

Three layered changes:

1. Engine: extend `createAgentRuntimeProfile` to accept either the legacy `{ harness, pi?, agents? }` shape (single-runtime, current behavior) or the new `{ agentRuntimes, defaultAgentRuntime, agents? }` shape (multi-runtime, new behavior). Add `deriveProfileName(spec)` colocated in `packages/engine/src/config.ts` (re-exported alongside `sanitizeProfileName`).
2. Daemon: extend the `POST /api/profile/create` JSON body parser in `packages/monitor/src/server.ts` to also accept `agentRuntimes` + `defaultAgentRuntime` and forward both shapes to `createAgentRuntimeProfile`.
3. API version: bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` from `10` to `11` and update the comment trailer to record the new shape.

### Key Decisions

1. **Option A (single helper, discriminated input)** - per the source PRD. Detect by the presence of `agentRuntimes` on the input object. Keeps the call-site count low and avoids a parallel `createMultiRuntimeProfile` API surface.
2. **`deriveProfileName` lives in `packages/engine/src/config.ts`** (next to the `sanitizeProfileName` re-export). Co-locating with the existing helper means the MCP proxy and the Pi extension can import both from `@eforge-build/engine/config` without touching `@eforge-build/client`. Consumers that already import `sanitizeProfileName` from `@eforge-build/client` (e.g. the `--migrate` path in `mcp-proxy.ts:637` and `pi-eforge/extensions/eforge/index.ts:1065`) continue to work via the existing client export.
3. **Validation strategy** - lean on the existing `partialEforgeConfigSchema` + `eforgeConfigSchema` round-trip already used by `createAgentRuntimeProfile`. The cross-field rules (`defaultAgentRuntime` exists in `agentRuntimes`; every `tiers.<tier>.agentRuntime` exists in `agentRuntimes`) are already enforced by `eforgeConfigBaseSchema.superRefine`. When the multi-runtime branch fires, we simply assemble the partial config without injecting the `main: { harness }` stub and let the existing validation surface errors with their current messages.
4. **API version bump** - the daemon route accepts a *new optional* request shape. Per the rule in `api-version.ts`, adding an optional field is non-breaking. The PRD nonetheless asks for an explicit bump for clarity; we bump and document the reason.
5. **No API changes to `agents.tiers.*.agentRuntime`** - the schema already supports this. We don't touch `eforgeConfigBaseSchema`. Plan-02 simply emits this field through the existing `agents` passthrough.

### Generalized helper signature

Update `createAgentRuntimeProfile` in `packages/engine/src/config.ts` to accept either of two input shapes (TypeScript union, discriminated by presence of `agentRuntimes`):

```ts
export type CreateProfileInput =
  // Legacy single-runtime input - unchanged behavior
  | {
      name: string;
      harness: 'claude-sdk' | 'pi';
      pi?: PartialEforgeConfig['pi'];
      agents?: PartialEforgeConfig['agents'];
      overwrite?: boolean;
      scope?: 'project' | 'user';
    }
  // New multi-runtime input
  | {
      name: string;
      agentRuntimes: Record<string, AgentRuntimeEntry>;
      defaultAgentRuntime: string;
      agents?: PartialEforgeConfig['agents'];
      overwrite?: boolean;
      scope?: 'project' | 'user';
    };
```

In the function body, branch:

- If `'agentRuntimes' in input`, build `partial: PartialEforgeConfig = { agentRuntimes: input.agentRuntimes, defaultAgentRuntime: input.defaultAgentRuntime }`.
- Else, keep the existing single-runtime construction (`{ agentRuntimes: { main: { harness, ...(pi && { pi }) } }, defaultAgentRuntime: 'main' }`).

The rest of the function (`partialEforgeConfigSchema.safeParse`, merged-config validation, atomic write, round-trip verify) is unchanged.

### deriveProfileName helper

Add to `packages/engine/src/config.ts` next to the `sanitizeProfileName` re-export:

```ts
export interface DeriveProfileNameSpec {
  agentRuntimes: Record<string, AgentRuntimeEntry>;
  defaultAgentRuntime: string;
  models?: {
    max?: { id: string };
    balanced?: { id: string };
    fast?: { id: string };
  };
  tiers?: {
    max?: { agentRuntime?: string };
    balanced?: { agentRuntime?: string };
    fast?: { agentRuntime?: string };
  };
}

export function deriveProfileName(spec: DeriveProfileNameSpec): string;
```

Name-derivation rules per the source PRD:

- **Single runtime + same model id across all three tiers**: `<sanitized-model-id>` (e.g. `opus-4-7`). Reuse the model-id sanitization logic from `sanitizeProfileName` (lowercase, `.` -> `-`, strip `claude-` prefix, collapse repeated dashes).
- **Single runtime + model varies across tiers**: `<harness>` if no provider, else `<harness>-<provider>` (e.g. `claude-sdk`, `pi-anthropic`).
- **Multiple runtimes**: `mixed-<runtime-backing-max>` where `runtime-backing-max` is the runtime name assigned to the `max` tier (or the `defaultAgentRuntime` if `tiers.max.agentRuntime` is absent).

Sanitize the final result through the existing `/^[A-Za-z0-9._-]+$/` constraint (the schema already enforces this; the helper is best-effort - any unexpected chars get collapsed/dashed by reusing `sanitizeProfileName`'s sanitization step). When the spec only provides legacy single-runtime fields (i.e. agentRuntimes has exactly one entry called `main` and `models.max.id === models.balanced.id === models.fast.id`), derive `<sanitized-model-id>` rather than `main`.

Expose extraction of the sanitization step as a small private helper inside `config.ts` (do not export). The existing `sanitizeProfileName` in `profile-utils.ts` stays untouched - we are not modifying client-package internals here.

### Daemon route extension

In `packages/monitor/src/server.ts` around line 1178, update the `POST /api/profile/create` body parser:

```ts
const body = await parseJsonBody(req) as {
  name?: unknown;
  harness?: unknown;
  pi?: unknown;
  agents?: unknown;
  agentRuntimes?: unknown;
  defaultAgentRuntime?: unknown;
  overwrite?: unknown;
  scope?: unknown;
};
```

Validation logic:

- `name` remains required (string).
- If `body.agentRuntimes !== undefined`: validate it is an object whose values look like `{ harness: 'claude-sdk' | 'pi', pi?: { provider: string } }`. Validate `body.defaultAgentRuntime` is a string. Forward to the helper as the new shape. (Lean on the helper's schema validation - the route only does a shallow shape check to return 400 with a clear message rather than 500 on a Zod throw.)
- Else, fall back to the existing `harness` single-runtime path unchanged.

Return `409` on `already exists`, `400` on other validation errors - same as today.

### API version bump

In `packages/client/src/api-version.ts`, bump `DAEMON_API_VERSION` from `10` to `11` and update the trailing comment to: `// v11: /api/profile/create accepts agentRuntimes + defaultAgentRuntime body shape`. No other code changes are needed - the version verifier in the same file already handles arbitrary integers.

### Tests

Extend `test/config-backend-profile.test.ts` (the existing home for `createAgentRuntimeProfile` tests, lines 227-288) with additional cases inside the `describe('createAgentRuntimeProfile', ...)` block:

- **Multi-runtime spec round-trips**: call `createAgentRuntimeProfile(configDir, { name: 'mixed', agentRuntimes: { 'claude-sdk': { harness: 'claude-sdk' }, 'pi-openrouter': { harness: 'pi', pi: { provider: 'openrouter' } } }, defaultAgentRuntime: 'claude-sdk', agents: { models: { max: { id: 'claude-opus-4-7' }, fast: { id: 'zai-glm-4-6' } }, tiers: { fast: { agentRuntime: 'pi-openrouter' } } } })`. Read back the YAML. Assert: top-level `agentRuntimes:` block contains exactly the two declared entries with the correct `harness:` values; `defaultAgentRuntime: claude-sdk`; `agents.tiers.fast.agentRuntime: pi-openrouter`.
- **Multi-runtime: defaultAgentRuntime must exist in agentRuntimes**: pass `{ defaultAgentRuntime: 'missing', agentRuntimes: { foo: { harness: 'pi', pi: { provider: 'openrouter' } } } }`. Expect a thrown error whose message references `defaultAgentRuntime`.
- **Multi-runtime: tier runtime must exist**: pass two valid runtimes plus `agents.tiers.fast.agentRuntime: 'nonexistent'`. Expect a thrown error whose message names the missing entry.
- **Single-runtime legacy callers still work** (regression check): the existing two cases (`pi-with-provider`, `pi-prod`) at lines 239-261 must keep passing without modification.

Add a separate `describe('deriveProfileName', ...)` block in `test/config-backend-profile.test.ts` with cases:

- Single runtime, single model id across tiers (`max=balanced=fast={id:'claude-opus-4-7'}`) -> `'opus-4-7'` (the `claude-` prefix is stripped, `.` becomes `-`).
- Single runtime, single model id across tiers, non-claude prefix (`{id:'glm-4.6'}`) -> `'glm-4-6'`.
- Single runtime, model varies across tiers, claude-sdk harness, no provider -> `'claude-sdk'`.
- Single runtime, model varies, pi harness, provider=`anthropic` -> `'pi-anthropic'`.
- Multiple runtimes, max tier assigned to `claude-sdk` -> `'mixed-claude-sdk'`.
- Multiple runtimes, max tier assigned via `defaultAgentRuntime` (no explicit `tiers.max.agentRuntime`) -> `'mixed-<defaultAgentRuntime>'`.

## Scope

### In Scope
- Extending `createAgentRuntimeProfile` to accept multi-runtime input (Option A).
- Adding `deriveProfileName(spec)` and exporting it from `packages/engine/src/config.ts`.
- Extending `POST /api/profile/create` to accept the new request shape.
- Bumping `DAEMON_API_VERSION` from `10` to `11`.
- Unit tests for the new helper branches and the new name-derivation utility.

### Out of Scope
- Touching the MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`), the Pi extension (`packages/pi-eforge/extensions/eforge/index.ts`), or either init skill - all consumer-facing rewiring lives in plan-02.
- Touching `eforgeConfigBaseSchema` cross-field validation - the existing `superRefine` already covers `defaultAgentRuntime` and `agents.tiers.<tier>.agentRuntime` referential integrity.
- Touching `sanitizeProfileName` in `packages/client/src/profile-utils.ts` - it remains the legacy single-model name helper.
- The `--migrate` path in either `mcp-proxy.ts` or `pi-eforge/extensions/eforge/index.ts`. It continues to use `sanitizeProfileName` and the legacy single-runtime call shape.
- Bumping the plugin version in `eforge-plugin/.claude-plugin/plugin.json` (plan-02 owns the consumer-facing version bump).

## Files

### Create
- (none)

### Modify
- `packages/engine/src/config.ts` - generalize `createAgentRuntimeProfile` to accept either single-runtime or multi-runtime input via discriminated union; add `deriveProfileName(spec)` + its `DeriveProfileNameSpec` type next to the existing `sanitizeProfileName` re-export; export both from this file. Existing single-runtime callers must keep working.
- `packages/monitor/src/server.ts` - extend the `POST /api/profile/create` handler around line 1178 to also accept `{ agentRuntimes, defaultAgentRuntime }` in the body and forward to the generalized helper. Existing harness-based callers must keep working.
- `packages/client/src/api-version.ts` - bump `DAEMON_API_VERSION` from `10` to `11`; update the trailing `// vN: ...` comment to describe the new field.
- `test/config-backend-profile.test.ts` - add multi-runtime cases inside the existing `describe('createAgentRuntimeProfile', ...)` block (multi-runtime round-trip, missing defaultAgentRuntime error, missing tier runtime error). Add a new top-level `describe('deriveProfileName', ...)` block covering the six naming branches above.

## Verification

- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes, including the new `createAgentRuntimeProfile` multi-runtime cases and the new `deriveProfileName` cases in `test/config-backend-profile.test.ts`
- [ ] `pnpm build` produces a fresh `packages/engine/dist/` and `packages/monitor/dist/` without errors
- [ ] In a unit test, calling `createAgentRuntimeProfile(configDir, { name: 'mixed', agentRuntimes: { 'claude-sdk': { harness: 'claude-sdk' }, 'pi-openrouter': { harness: 'pi', pi: { provider: 'openrouter' } } }, defaultAgentRuntime: 'claude-sdk', agents: { models: { max: { id: 'claude-opus-4-7' }, fast: { id: 'zai-glm-4-6' } }, tiers: { fast: { agentRuntime: 'pi-openrouter' } } } })` writes a YAML whose top-level keys include exactly `agentRuntimes`, `defaultAgentRuntime`, and `agents`; `agentRuntimes` has exactly two entries (`claude-sdk` and `pi-openrouter`); `agents.tiers.fast.agentRuntime` equals `pi-openrouter`
- [ ] `createAgentRuntimeProfile(configDir, { name: 'x', agentRuntimes: { foo: { harness: 'pi', pi: { provider: 'openrouter' } } }, defaultAgentRuntime: 'missing' })` rejects with an error message containing the string `defaultAgentRuntime`
- [ ] `createAgentRuntimeProfile(configDir, { name: 'x', agentRuntimes: { foo: { harness: 'pi', pi: { provider: 'openrouter' } } }, defaultAgentRuntime: 'foo', agents: { tiers: { fast: { agentRuntime: 'nonexistent' } } } })` rejects with an error message containing the string `nonexistent`
- [ ] Existing test cases at `test/config-backend-profile.test.ts:239-287` continue to pass without modification
- [ ] `deriveProfileName({ agentRuntimes: { main: { harness: 'claude-sdk' } }, defaultAgentRuntime: 'main', models: { max: { id: 'claude-opus-4-7' }, balanced: { id: 'claude-opus-4-7' }, fast: { id: 'claude-opus-4-7' } } })` returns `'opus-4-7'`
- [ ] `deriveProfileName({ agentRuntimes: { 'claude-sdk': { harness: 'claude-sdk' }, 'pi-openrouter': { harness: 'pi', pi: { provider: 'openrouter' } } }, defaultAgentRuntime: 'claude-sdk', tiers: { max: { agentRuntime: 'claude-sdk' } } })` returns `'mixed-claude-sdk'`
- [ ] `deriveProfileName({ agentRuntimes: { main: { harness: 'pi', pi: { provider: 'anthropic' } } }, defaultAgentRuntime: 'main', models: { max: { id: 'claude-opus-4-7' }, balanced: { id: 'claude-sonnet-4-6' }, fast: { id: 'claude-haiku-4' } } })` returns `'pi-anthropic'`
- [ ] `DAEMON_API_VERSION` exported from `packages/client/src/api-version.ts` equals `11`
- [ ] Posting `{ name: 'mixed', agentRuntimes: { 'claude-sdk': { harness: 'claude-sdk' }, 'pi-openrouter': { harness: 'pi', pi: { provider: 'openrouter' } } }, defaultAgentRuntime: 'claude-sdk' }` to `POST /api/profile/create` (live daemon) returns `200` and writes a profile file with the same shape verified above; posting the existing `{ name, harness, pi?, agents? }` shape still returns `200`
