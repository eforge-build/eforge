---
title: Per-invocation runtime choice routing
created: 2026-07-01
---

# Per-invocation runtime choice routing

## Executive Summary

Create a deep feature plan to add named runtime choices inside the existing planning/implementation/review/evaluation tiers. The plan changes profile/config schema, engine runtime resolution, optional extension policy hooks, shared event metadata, docs, and Pi/Claude profile-creation surfaces while explicitly preserving build-level profile routing and keeping full Console profile editing out of scope. Validation is medium-confidence but bounded: the core risk is resolver/registry drift, addressed by a single choice-resolution path plus schema, fallback, event, and integration tests.

## Problem Statement

Current eforge runtime selection is single-axis: an agent role resolves to one of four tiers, and that tier has one harness/model/toolbelt recipe. `registerProfileRouter` can choose an entire profile once before a queued PRD build starts, while `onAgentRun` can only augment prompts/tools for an invocation. Users need a middle layer: keep the selected profile and the four-tier role model, but choose among named runtime choices within the resolved tier per spawned agent invocation.

Primary user outcome: a profile can declare choices such as `implementation.backend` and `implementation.ui`, then declaratively route UI-heavy builder/reviewer/fixer work to the UI runtime and backend work to the backend runtime without requiring a native extension.

## Scope

In scope:
- Extend `agents.tiers.<tier>` to support optional named runtime choices while preserving the current tier recipe as the default choice.
- Add deterministic per-invocation choice resolution after role-to-tier resolution and before harness/model/config selection.
- Add declarative routing rules for common UI/backend/docs/API/path/keyword cases.
- Add an optional extension router hook for advanced heuristics that cannot be expressed declaratively, with fail-open fallback.
- Stamp safe observability on events/traces: role, tier, selected choice, selection source, rule/router name, and fallback reason.
- Update config docs, generated reference docs, profile creation surfaces in Pi and Claude plugin skills, and tests.

Out of scope:
- Replacing the four built-in tiers with arbitrary tier names.
- Changing build-level `registerProfileRouter` semantics.
- Letting `onAgentRun` mutate harness/model/runtime selection.
- A full Console profile editing UI, unless there is already a small read-only metadata display to update.
- LLM-based routing/classification in the kernel.

Proposed config direction:
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

## Acceptance Criteria

- Existing profiles with one recipe per tier continue to load and resolve exactly as before.
- The four tiers remain the role-routing axis; named choices are addressed as `tier.choice` only after tier resolution.
- A tier can define multiple named choices, and invalid choice names, invalid route references, missing effective harness/model/effort, or unsupported nested choice blocks fail config validation with path-specific messages.
- Per invocation, eforge resolves role -> tier -> runtime choice -> effective recipe -> harness/model/config, and both the harness instance and resolved agent config use the same selection.
- Declarative rules can route common cases such as UI paths to `implementation.ui` and backend paths to `implementation.backend`.
- Optional extension-provided runtime-choice routers can select a configured choice when declarative rules do not match; declines, timeouts, errors, and invalid choices fall back deterministically.
- Existing build-level profile routers still select only the overall active profile before build dispatch.
- `onAgentRun` remains prompt/tool augmentation only, but its context may include the already-selected runtime choice for observability.
- `agent:start` and/or a dedicated typed event exposes role, tier, runtime choice, source, rule/router name, and fallback reason without secrets.
- Pi and Claude profile creation docs/surfaces can create or describe profiles with choices/routing, and the Claude plugin version is bumped if plugin files change.
- Targeted and full validation pass: schema/resolver/registry/fallback/event tests, docs generation/check, type-check, unit tests, and maintainability check.

## Code Impact

Expected implementation surfaces:
- `packages/engine/src/config.ts`: add choice/routing schema, TypeScript output types, merge/default behavior, profile load/create preservation, and validation errors.
- `packages/engine/src/pipeline/agent-config.ts`: replace the single tier recipe assumption with effective-choice recipe resolution while preserving role and plan override precedence.
- `packages/engine/src/agent-runtime-registry.ts`: make harness lookup choice-aware and memoize by effective recipe dimensions such as harness, provider, resources, toolbelt-selected MCP servers, and subagent policy.
- Add or extract a shared runtime-choice resolver so config resolution and registry lookup cannot drift. Prefer a helper that returns `{ agentConfig, harness, toolbeltSummary, selection }` for an invocation instead of having call sites independently call `forRoleResolved` and `resolveAgentConfig`.
- Update build/compile/standalone call sites that spawn agents so they pass invocation context consistently.
- `packages/engine/src/harness.ts`, `packages/engine/src/harnesses/claude-sdk.ts`, and `packages/engine/src/harnesses/pi.ts`: carry choice metadata through agent run options and emitted lifecycle events.
- `packages/client/src/events/**`: add typed event fields or a new event variant using the shared client event-schema ownership rules.
- `packages/engine/src/extensions/*`, `packages/extension-sdk/src/hooks.ts`, `packages/extension-sdk/src/api.ts`, and related recorder/types files: add optional runtime-choice router registration/context if included in MVP.
- `packages/pi-eforge/extensions/eforge/profile-payload.ts` and `profile-commands.ts`, plus `eforge-plugin/skills/profile-new/profile-new.md`: expose/profile-preview the new schema in both consumer-facing integrations.
- `docs/config.md`, `docs-gen/src/generators/config.ts`, and public docs references: document schema, routing order, examples, fallback, and distinctions from profile routers/onAgentRun.
- Tests likely belong near `test/agent-config.*`, `test/agent-runtime-registry.test.ts`, `test/toolbelt-runtime.test.ts`, `test/extension-profile-router-runtime.test.ts`, `test/extension-agent-context-runtime.test.ts`, event-schema tests, and profile payload tests.

## Design Decisions

Recommended decisions:
1. Treat the existing tier recipe as the `default` runtime choice. If `choices` is omitted, behavior is API-compatible with current profiles.
2. Define named choices as tier-local recipe overlays: unspecified fields inherit from the tier default, then validation checks the effective recipe. Do not allow nested `choices` or `routing` inside a choice.
3. Resolve in this order: explicit plan/role choice override if implemented -> first matching declarative rule -> extension runtime-choice routers in registration order -> default choice.
4. Routing rules should be deterministic and ordered. MVP predicates should stay simple: `roles`, `phase`, `stage`, `pathGlobs`, `keywords`, and maybe `shardIds`/`shardRoots` for builder work.
5. Extension routers should receive only safe bounded context: role, tier, active profile, available choice names, phase/stage, planId, capped PRD/plan summary, changedFiles/shard hints, and project paths/logger/exec equivalent to other extension contexts. They return a choice name plus reason/confidence or decline.
6. Invalid extension selections, throws, and timeouts are diagnostics, not build failures, unless a future explicit fail-closed policy is added.
7. Do not overload `toolbelt` for runtime routing. Toolbelts remain MCP access bundles; choices may select different toolbelts as part of their effective recipe.
8. Prefer a new selection result type, e.g. `RuntimeChoiceSelection`, with `tier`, `choice`, `source`, `ruleName/routerName`, `fallbackReason`, and `effectiveRecipe`, used by both config and registry code.
9. Keep events secret-safe: include choice names, source, model id already emitted by agent starts, and non-secret routing metadata; never include API keys or raw full PRD/profile bodies.

Architecture guardrail: the kernel gains only a small secondary routing layer. Profiles define runtime policy, the engine resolves deterministic runtime inputs, extensions may contribute optional policy hooks, and harnesses run the already-resolved invocation. Do not expand this into scheduling/workflow orchestration.

## Assumptions And Validation

Validation plan:
- Schema tests: legacy tier configs; tier choices with inherited/defaulted fields; full choice recipes; invalid choice names; invalid route choice references; rejected nested choices; Pi provider validation after inheritance; toolbelt reference validation still works.
- Resolver tests: role-tier precedence is unchanged; choice selection occurs after tier resolution; routing rules select expected choices; explicit override precedence if implemented; fallback reasons for no match, invalid choice, declined router, thrown router, and timed-out router.
- Registry tests: selected choice changes harness/model/toolbelt; identical effective recipes share harness instances; different providers/resources/toolbelts produce distinct instances; `agents.bare` still forces Pi resources isolation.
- Event tests: new/extended events validate through `@eforge-build/client`; `agent:start` includes choice metadata when selected; secret fields are absent; model tracker behavior remains based on model ids.
- Extension tests: recorder captures runtime-choice routers, runtime invokes them in order, diagnostics are emitted, and build continues under deterministic fallback.
- Product surface tests: Pi payload builder accepts choices/routing; Claude skill examples match daemon profile create payload; docs generation produces no drift.
- Commands before handoff/merge: `pnpm type-check`, targeted `pnpm test` for changed units, full `pnpm test` if runtime/event surfaces are broad, `pnpm docs:generate` or `pnpm docs:check`, and `pnpm maintainability:check`.

Key risks and mitigations:
- Resolver/registry drift: use one resolver/helper and integration tests asserting choice, model, harness, and toolbelt match.
- Backward-compatibility regressions: keep fields optional and cover legacy fixtures.
- Overbroad declarative rules: make rule order explicit and emit selection/fallback metadata.
- Extension router failures: timeout, fail-open diagnostics, invalid-selection handling, and deterministic default fallback.
- Cross-surface drift: update Pi and Claude plugin surfaces together; bump the Claude plugin version if plugin files change.