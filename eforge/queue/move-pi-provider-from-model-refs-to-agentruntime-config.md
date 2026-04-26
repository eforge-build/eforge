---
title: Move Pi `provider` from model refs to agentRuntime config
created: 2026-04-26
---

# Move Pi `provider` from model refs to agentRuntime config

## Problem / Motivation

Today, Pi profiles repeat `provider:` on every model class entry, while the Claude SDK harness (which has no notion of provider) just lists `id:`. The provider is conceptually a property of the harness/connection — it determines which SDK API, auth flow, and model registry are used — not a property of the model itself. The current shape forces:

1. Repetition (`pi-gpt.yaml` has `provider: openai-codex` on every model class).
2. A model ref schema that has to mean different things depending on the active harness, with provider validation deferred to resolve time (`agent-config.ts:434-449`).
3. Conceptual confusion: a "model" in `agents.models` is actually a "model on a specific provider," tied to the harness it's used with.

Per user feedback (no backward-compat cruft): provider is hard-removed from `modelRefSchema` and the new field is a clean break.

## Goal

Move `provider` onto the Pi agentRuntime entry (`agentRuntimes.<name>.pi.provider`) so that:

- Provider is declared exactly once per runtime.
- Model refs collapse to `{ id }` everywhere.
- The Claude SDK and Pi shapes become symmetric ("the runtime knows how to reach its provider; models are just ids").
- Cross-provider experiments (e.g. anthropic vs openai-codex within one profile) require declaring distinct named runtimes — which is the conceptually correct thing.

## Approach

### Target shape

```yaml
agentRuntimes:
  default:
    harness: pi
    pi:
      provider: openai-codex   # NEW — required for harness: pi
      thinkingLevel: high      # existing pi-only knobs unchanged
agents:
  models:
    max:
      id: gpt-5.5              # provider field removed everywhere
    balanced:
      id: gpt-5.5
```

The `mlx-lm` cross-provider override in `mixed-opus-planner-pi-builder.yaml` becomes a second named runtime rather than a per-role provider override.

### Implementation

#### 1. Schema changes — `packages/engine/src/config.ts`

- **`piConfigSchema`** (line 132): add `provider: z.string().optional().describe('Pi provider name (required when used as an agentRuntime entry)')`. Optional at the schema level so the top-level `pi:` defaults block doesn't require it; required at the agentRuntime entry via cross-validation below.
- **`modelRefSchema`** (lines 62-65): remove the `provider` field entirely. Update the JSDoc on `ModelRef` (lines 56-60) to drop the "required for Pi backend" line.
- **`agentRuntimeEntrySchema` `superRefine`** (lines 155-167): add a check — when `data.harness === 'pi'`, require `data.pi?.provider` to be a non-empty string; surface a clear error path if missing.
- Re-export of `ModelRef` derives from the schema, so removing `provider` from `modelRefSchema` propagates the type change automatically.

#### 2. Resolver — `packages/engine/src/pipeline/agent-config.ts`

- **`resolveAgentRuntimeForRole`** (lines 355-404): extend the return shape to include the resolved `provider?: string` (pulled from `entry.pi?.provider` when `entry.harness === 'pi'`, undefined for claude-sdk).
- **`resolveAgentConfig`** (lines 419-463):
  - Remove the resolve-time provider validation block (lines 433-449) — schema-time validation now covers it.
  - When harness is `pi`, splice the resolved provider into the result so downstream consumers (Pi harness, monitor UI, traces) still see `{ id, provider }` on the model ref. Cleanest path: build the model ref as `{ ...model, provider: agentRuntime.pi.provider }` immediately after `resolveModel` returns, gated on `harness === 'pi'`.
- **`ResolvedAgentConfig`** type (in `agent-runtime-registry.ts` or wherever it's defined): no shape change — `model.provider` continues to exist on the resolved object; only its source moves.

#### 3. Pi harness factory — `packages/engine/src/agent-runtime-registry.ts:164-177`

No changes needed. The factory already passes `entry.pi` through as `piConfig`. The Pi harness reads `provider` off the resolved `options.model.provider` at run time (which the resolver now populates from `pi.provider`), so the contract is preserved. The validation paths in `pi.ts:302-322` still fire as a defensive double-check but should now be unreachable.

#### 4. Profile migrations — DEFERRED to follow-on PRD

**Out of scope for this PRD.** The eval project (`/Users/markschaake/projects/eforge-build/eval/`) is a separate working directory and will be running this very change through eforge. Modifying its profile files in the same PRD would conflate the change-under-test with the consumer being tested against. Eval profile migration is captured as a follow-on PRD at `tmp/migrate-eval-profiles-to-new-provider-shape.md` (drafted alongside this plan, written out at implementation time).

**Breakage window note:** Once this PRD lands, all existing profiles (eval + any user profiles) that still use `provider:` on a model ref will fail Zod validation at config load. The follow-on PRD must land promptly to restore eval functionality. There is no compat shim per the no-backcompat preference.

Files the follow-on PRD will touch:

- `eval/eforge/profiles/pi-gpt.yaml`
- `eval/eforge/profiles/pi-opus.yaml`
- `eval/eforge/profiles/pi-kimi-k-2-6.yaml`
- `eval/eforge/profiles/mixed-opus-planner-pi-builder.yaml`
- `eval/eforge/profiles/README.md` (refresh examples)

#### 5. Plugin skill docs — `eforge-plugin/skills/`

These skills emit profile YAML and explain config shape, so they reference the old layout in several places. Update to the new shape:

- `init/init.md:32-33` — provider is now written into the runtime block, not model entries.
- `profile-new/profile-new.md:92-94, 110-116` — example output blocks; remove `provider:` from `models.*` and add `pi.provider:` to the runtime entry.
- `config/config.md:56, 153` — comments saying `{ provider: "...", id: "..." }` for Pi need to become `{ id: "..." }` with a note that provider lives on the runtime.

#### 6. Tests — `test/` (eforge repo only)

Update fixtures and assertions in:

- `test/config.test.ts` — schema-level validation cases for the new `pi.provider` requirement and for rejection of `provider:` on model refs.
- `test/config-backend-profile.test.ts` — profile loading tests.
- `test/agent-config.resolution.test.ts` — verify resolver splices provider into the resolved model ref from runtime config.
- `test/agent-config.mixed-harness.test.ts` — the mixed scenario now exercises two named runtimes with distinct providers rather than a per-role provider override.
- `test/pipeline.test.ts` — any inline configs that use `provider:` on a model.

All test fixtures are inline objects in the eforge repo — they are NOT the eval profile YAML files. Updating these tests is in scope and required for this PRD to pass `pnpm test`.

#### 7. Daemon API version

The HTTP API surface (`packages/client/src/api-version.ts`) is unaffected — the resolved `model.provider` field shape on the wire is unchanged. No `DAEMON_API_VERSION` bump.

#### 8. Plugin version bump

Per `AGENTS.md`: bump `eforge-plugin/.claude-plugin/plugin.json` because skill docs change.

## Scope

### In scope

Critical files (eforge repo only — eval/ is out of scope):

- `packages/engine/src/config.ts` (schema)
- `packages/engine/src/pipeline/agent-config.ts` (resolver)
- `packages/engine/src/harnesses/pi.ts` (defensive validation only — no change required, but verify)
- `eforge-plugin/skills/{init,profile-new,config}/*.md`
- `eforge-plugin/.claude-plugin/plugin.json` (version bump)
- `test/{config,config-backend-profile,agent-config.resolution,agent-config.mixed-harness,pipeline}.test.ts`

### Out of scope

- Eval profile migrations (`eval/eforge/profiles/*.yaml`, `eval/eforge/profiles/README.md`) — captured in follow-on PRD `tmp/migrate-eval-profiles-to-new-provider-shape.md`.
- `DAEMON_API_VERSION` bump — wire shape unchanged.
- Backward-compatibility shim for the old `provider:` location on model refs — explicitly rejected per no-backcompat preference.

### Follow-on PRD (drafted, not written this turn)

`tmp/migrate-eval-profiles-to-new-provider-shape.md` — to be created when implementation begins (plan-mode rules block writes outside the plan file). Contents:

```markdown
# Migrate eval profiles to new provider shape

## Context

The schema change in <main PRD link/id> moved Pi `provider` from per-model
fields to `agentRuntimes.<name>.pi.provider`. Eval profiles in
`eval/eforge/profiles/` still use the old shape and now fail Zod validation
at config load. This PRD migrates them in lockstep with the main change so
evals are runnable again.

## Scope

Migrate four profile files and refresh README examples. Mechanical edits
only — no behavior change, no resolver/test work.

### Files

- `eval/eforge/profiles/pi-gpt.yaml` — move `provider: openai-codex` from
  both `agents.models.{max,balanced}` entries to
  `agentRuntimes.default.pi.provider`.
- `eval/eforge/profiles/pi-opus.yaml` — same pattern, provider `anthropic`.
- `eval/eforge/profiles/pi-kimi-k-2-6.yaml` — same pattern, provider
  `openrouter`.
- `eval/eforge/profiles/mixed-opus-planner-pi-builder.yaml` — add
  `pi.provider: mlx-lm` to the existing `pi-local` runtime entry; drop the
  `provider:` field from the `roles.builder.model` block (becomes
  `model: { id: unsloth/Qwen3.6-... }`). The `opus` runtime stays
  claude-sdk and gets no `pi:` block.
- `eval/eforge/profiles/README.md` — update the "Profile matrix" notes and
  any inline YAML examples to reflect the new shape.

## Verification

1. Load each migrated profile via `eforge` CLI / MCP — Zod accepts.
2. Run a smoke eval against `pi-gpt` and confirm dispatch to
   `openai-codex/gpt-5.5`.
3. Run a `mixed-opus-planner-pi-builder` build and confirm the builder
   role still routes to `mlx-lm` Qwen via the renamed runtime.
```

## Acceptance Criteria

1. `pnpm type-check` — surfaces every site that read `model.provider` off a config-shaped object (vs the resolved object).
2. `pnpm test` — schema, resolver, and pipeline suites all pass with migrated inline fixtures.
3. **Schema rejection**: construct a Zod test input with `provider:` still on a model — schema rejects with a path pointing at `agents.models.<class>.provider`. Construct a `harness: pi` runtime with no `pi.provider` — schema rejects with the path `agentRuntimes.<name>.pi.provider`.
4. **Resolver round-trip**: assert that resolving a role against a `harness: pi` runtime with `pi.provider: anthropic` produces a `ResolvedAgentConfig` whose `model.provider === 'anthropic'`.
5. End-to-end eval verification (running `pi-gpt`, `mixed-opus-planner-pi-builder`) is part of the follow-on PRD's verification, not this one — eval profiles are still in the old shape until that PRD lands.
