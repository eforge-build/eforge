---
id: plan-01-schema-resolver-tests
name: Schema, resolver, and inline test fixtures
branch: move-pi-provider-from-model-refs-to-agentruntime-config/schema-resolver-tests
---

# Schema, resolver, and inline test fixtures

## Architecture Context

Today Pi profiles repeat `provider:` on every model class entry inside `agents.models.<class>`, while the Claude SDK harness (which has no notion of provider) just lists `id:`. Provider is conceptually a property of the harness/connection — it determines which SDK API, auth flow, and model registry are used — not a property of the model itself. The current shape forces:

1. Repetition (e.g. `pi-gpt.yaml` repeats `provider: openai-codex` on every model class).
2. A `modelRefSchema` that has to mean different things depending on the active harness, with provider validation deferred to resolve time (`packages/engine/src/pipeline/agent-config.ts` lines 433-449).
3. Conceptual confusion: a "model" in `agents.models` is actually a "model on a specific provider," tied to the harness it's used with.

This plan executes a clean break per the project's no-backcompat preference: provider moves to `agentRuntimes.<name>.pi.provider`, `modelRefSchema` collapses to `{ id }`, and the resolver splices the provider from the runtime entry into the resolved model ref so downstream consumers (Pi harness, monitor UI, traces) continue to see `model.provider` exactly as before. Wire shape (`ResolvedAgentConfig.model`) is unchanged — only the source of truth in config moves.

The Pi harness factory in `packages/engine/src/agent-runtime-registry.ts` already passes `entry.pi` through as `piConfig`, so no factory changes are required. The harness's defensive provider checks at `packages/engine/src/harnesses/pi.ts:302-322` remain in place as a runtime double-check but should be unreachable after this change.

## Implementation

### Overview

This is a single cohesive change touching schema, resolver, and every test fixture that constructs an inline config with `provider:` on a model ref. The Zod schema changes will fail-fast every test that still uses the old shape, so test fixture updates must land in the same plan.

### Key Decisions

1. **`provider` is optional on `piConfigSchema` itself, required on `agentRuntimeEntrySchema` when `harness === 'pi'`.** This lets the top-level `pi:` defaults block omit `provider:` (it's not meaningful at the global-defaults level — there is no harness binding there), while making it mandatory on every `agentRuntimes.<name>` entry whose harness is `pi`. Enforced via cross-field `superRefine` at the entry level.
2. **Resolver splices provider into the resolved model ref.** The simplest contract-preserving change: when `harness === 'pi'`, build the resolved model ref as `{ ...model, provider: entry.pi.provider }` immediately after `resolveModel` returns. `ResolvedAgentConfig.model.provider` keeps its existing shape, so Pi harness, agent:start events, monitor UI, and traces all continue to see `model.provider` without any other code changes.
3. **Resolve-time provider validation block is deleted, not weakened.** Per the PRD, schema-time validation now covers both directions (Pi requires provider on the runtime entry; Claude SDK rejects `provider:` on model refs because the field no longer exists in `modelRefSchema`). Keeping a duplicate check at resolve time would mask schema bugs and add maintenance burden.
4. **No changes to `packages/engine/src/agent-runtime-registry.ts`.** The factory passes `entry.pi` through to the Pi harness as `piConfig`; the harness reads `provider` off `options.model.provider` at run time. The resolver already populates that. Verification only.
5. **No `DAEMON_API_VERSION` bump.** The wire shape of `ResolvedAgentConfig.model` is unchanged.

## Scope

### In Scope

- Remove `provider` from `modelRefSchema` and the `ModelRef` interface in `packages/engine/src/config.ts`.
- Add optional `provider: z.string()` to `piConfigSchema`.
- Extend `agentRuntimeEntrySchema.superRefine` to require non-empty `pi.provider` when `harness === 'pi'` (with a clear error path pointing at `agentRuntimes.<name>.pi.provider`).
- Update `resolveAgentRuntimeForRole` to optionally surface the resolved provider for the Pi case (so `resolveAgentConfig` can splice it).
- Update `resolveAgentConfig` to splice `provider` from the runtime entry into the resolved model ref when `harness === 'pi'`, and to delete the resolve-time provider validation block.
- Verify `packages/engine/src/harnesses/pi.ts:302-322` defensive checks still compile and behave correctly (no code change expected).
- Update inline-config test fixtures and assertions in: `test/config.test.ts`, `test/config-backend-profile.test.ts`, `test/agent-config.resolution.test.ts`, `test/agent-config.mixed-harness.test.ts`, `test/pipeline.test.ts`.
- Add a new schema-rejection test asserting that `provider:` on a model ref now fails Zod validation with a path pointing at `agents.models.<class>.provider` (extra-keys rejection or removed-field error, whichever Zod surfaces given `z.object` without `.passthrough()`).
- Add a new schema-rejection test asserting that a `harness: pi` runtime with no `pi.provider` fails with a path pointing at `agentRuntimes.<name>.pi.provider`.
- Add a resolver round-trip test asserting that resolving a role against a `harness: pi` runtime with `pi.provider: anthropic` produces a `ResolvedAgentConfig` whose `model.provider === 'anthropic'`.
- Update the `mixed-harness` resolver test so the cross-provider scenario uses two named runtimes with distinct `pi.provider` values rather than per-role provider overrides (the current shape).

### Out of Scope

- Any modification to files under `eval/eforge/profiles/` or `eval/eforge/profiles/README.md`. These are tracked in the follow-on PRD `tmp/migrate-eval-profiles-to-new-provider-shape.md` (drafted alongside this plan, written when implementation begins).
- Bumping `DAEMON_API_VERSION` — wire shape unchanged.
- Any backward-compatibility shim, deprecation warning, or migration helper for the old `provider:` location on model refs.
- Plugin skill doc updates and `eforge-plugin/.claude-plugin/plugin.json` version bump — handled in plan-02.

## Files

### Modify

- `packages/engine/src/config.ts` — In `piConfigSchema` (around line 132), add `provider: z.string().optional().describe('Pi provider name (required when used as an agentRuntime entry)')`. In `modelRefSchema` (lines 62-65), remove the `provider` field; in the `ModelRef` interface JSDoc and shape (lines 56-60), remove the `provider?: string` property and drop the "required for Pi backend" wording. In `agentRuntimeEntrySchema.superRefine` (lines 155-167), add a check that emits an issue with `path: ['pi', 'provider']` when `data.harness === 'pi'` and `data.pi?.provider` is `undefined` or an empty string.
- `packages/engine/src/pipeline/agent-config.ts` — In `resolveAgentRuntimeForRole` (lines 355-404), extend the return shape to include `provider?: string` derived from `entry.pi?.provider` (only when `entry.harness === 'pi'`). In `resolveAgentConfig` (lines 419-463), capture the new `provider` field from the destructured return value, delete the resolve-time provider validation block (lines 433-449), and after the `resolveModel(...)` call splice the provider into the model ref when `harness === 'pi'` and `model !== undefined` so the resolved object continues to expose `model.provider`.
- `packages/engine/src/harnesses/pi.ts` — No code change expected. Verify the defensive `if (!options.model.provider)` block at lines 302-322 still compiles after the `ModelRef` shape change. Because the resolver splices `provider` onto the resolved model object, this branch is now defensive-only at the engine boundary.
- `test/config.test.ts` — Remove or update any test that constructs a model ref containing `provider`. Add: (a) a test that a config containing `agents.models.max: { id: 'foo', provider: 'bar' }` fails Zod parse with the issue path including `provider`; (b) a test that a `harness: pi` runtime with no `pi.provider` fails Zod parse with the issue path `agentRuntimes.<name>.pi.provider`; (c) a test that a `harness: pi` runtime with `pi.provider: 'openai-codex'` parses successfully.
- `test/config-backend-profile.test.ts` — Update inline profile fixtures so `provider:` lives on `agentRuntimes.<name>.pi.provider` rather than on `agents.models.<class>` entries. Adjust any assertions that read `provider` off the parsed config to instead read it from the agentRuntime entry.
- `test/agent-config.resolution.test.ts` — Update inline configs to the new shape. Add a round-trip test: build a config with `agentRuntimes.default = { harness: 'pi', pi: { provider: 'anthropic' } }` and `agents.models.max = { id: 'claude-opus-4-7' }`, call `resolveAgentConfig` for an implementation-tier role, assert `result.model.provider === 'anthropic'` and `result.model.id === 'claude-opus-4-7'` and `result.harness === 'pi'`. Add an inverse case asserting that for `harness: 'claude-sdk'` runtimes, `result.model.provider === undefined`.
- `test/agent-config.mixed-harness.test.ts` — The mixed scenario currently exercises a per-role provider override on the model ref. Rewrite to declare two named runtimes — e.g. `pi-anthropic` (`harness: pi, pi.provider: anthropic`) and `pi-mlx` (`harness: pi, pi.provider: mlx-lm`) — and route the planner role to one and the builder role to the other via `agents.roles.<role>.agentRuntime`. Assert that each role resolves to the expected provider via `model.provider`.
- `test/pipeline.test.ts` — Update any inline configs that put `provider:` on a model ref to instead put it on the agentRuntime entry.

## Verification

- [ ] `pnpm type-check` exits 0. Specifically, no consumer of `ModelRef` constructs an object literal with a `provider` field on the config-shaped (pre-resolve) side.
- [ ] `pnpm test` exits 0 with all updated test files passing.
- [ ] Zod test: a parse of `{ agents: { models: { max: { id: 'x', provider: 'y' } } } }` (with the rest of the config valid) fails, and the resulting `ZodError` contains an issue whose `path` array ends with `provider`.
- [ ] Zod test: a parse of `{ agentRuntimes: { default: { harness: 'pi' } }, defaultAgentRuntime: 'default', ... }` fails, and the resulting `ZodError` contains an issue whose `path` is `['agentRuntimes', 'default', 'pi', 'provider']`.
- [ ] Zod test: a parse of `{ agentRuntimes: { default: { harness: 'pi', pi: { provider: 'openai-codex' } } }, defaultAgentRuntime: 'default', ... }` succeeds.
- [ ] Resolver test: with `agentRuntimes.default = { harness: 'pi', pi: { provider: 'anthropic' } }` and `agents.models.max = { id: 'claude-opus-4-7' }`, `resolveAgentConfig` for an implementation-tier role returns an object satisfying `result.model.provider === 'anthropic'` and `result.model.id === 'claude-opus-4-7'` and `result.harness === 'pi'`.
- [ ] Resolver test: with `agentRuntimes.default = { harness: 'claude-sdk' }` and `agents.models.max = { id: 'claude-opus-4-7' }`, `resolveAgentConfig` returns `result.model.provider === undefined` and `result.harness === 'claude-sdk'`.
- [ ] Mixed-harness test: two named Pi runtimes with distinct `pi.provider` values, routed to different roles via `agents.roles.<role>.agentRuntime`, each resolve to a `model.provider` matching their runtime's declared provider.
- [ ] The defensive provider check at `packages/engine/src/harnesses/pi.ts:302-322` still compiles and is reachable only when the resolver fails to splice (i.e. never under normal flow).
- [ ] No source file under `eval/` is modified by this plan.
