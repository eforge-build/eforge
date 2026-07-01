---
id: plan-01-runtime-choice-core
name: Runtime Choice Config and Core Resolution
branch: per-invocation-runtime-choice-routing/plan-01-runtime-choice-core
agents:
  builder:
    effort: high
    rationale: This plan changes the core runtime selection path, config validation,
      registry memoization, and agent spawn call sites; careful coordination
      prevents resolver/registry drift.
  tester:
    effort: high
    rationale: The plan requires targeted regression coverage for legacy configs,
      choice inheritance, routing predicates, and harness memoization.
---

# Runtime Choice Config and Core Resolution

## Architecture Context

The current engine resolves runtime selection through a single axis: role -> tier -> tier recipe. This plan adds tier-local runtime choices without changing the four built-in tiers or build-level profile routing. The selected profile remains the outer routing decision; runtime choices are resolved only after role-to-tier resolution.

The core guardrail is a single resolution path that returns both the resolved agent config and the harness selected from the same effective recipe. Existing profiles that define one recipe per tier must keep their current behavior.

## Implementation

### Overview

Add config schema support for tier-local choices and ordered declarative routing rules. Create a shared runtime-choice resolver that computes the selected choice, effective recipe, agent config, toolbelt summary, and harness for each invocation. Update registry lookup so it keys by harness-relevant effective recipe dimensions rather than tier name alone.

### Key Decisions

1. Treat the tier body as the implicit `default` choice. Do not require existing configs to add a `choices` block.
2. Resolve the tier first, including existing role defaults and plan/role tier overrides, then define `choices.<name>` as a recipe overlay on that resolved tier default. Unspecified fields inherit from the tier recipe; existing non-tier role and plan recipe overrides apply after choice selection.
3. Reserve `default` as the implicit choice name. Reject `choices.default` and nested `choices` or `routing` inside any choice overlay.
4. Accept routing references as `choice: ui`, `choice: default`, or `choice: implementation.ui` for the owning tier. Reject cross-tier references and unknown choice names with path-specific validation errors.
5. Keep routing deterministic: rules are evaluated in declaration order; the first rule whose predicates match selects the choice; no match selects `default` with a recorded fallback reason.
6. Use one runtime helper for invocation setup, for example `resolveAgentRuntimeForInvocation(...)`, returning `{ agentConfig, harness, toolbeltSummary, selection }` so call sites do not separately call config resolution and registry lookup.

### Routing Semantics

Implement a tier-level schema shaped like:

```yaml
agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
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
```

Predicate behavior:

- `roles`: matches the resolved agent role.
- `phase` and `stage`: match invocation metadata when present.
- `pathGlobs`: matches changed files, shard roots, explicit shard files, or other bounded path hints supplied by the invocation.
- `keywords`: matches lower-cased bounded search text derived from plan name, plan summary, PRD title/summary, task summary, and shard labels. Cap the text before matching; do not store the full PRD body in the selection result.
- `shardIds` and `shardRoots`: match builder shard hints when present.
- All predicate groups present in a rule must match; within a group, any listed value may match.
- A rule with an empty or missing `when` block is invalid.

Use an existing repo path-matching utility if one exists. If no existing helper supports the documented glob forms, add a focused helper under `packages/engine/src/pipeline/` and test `**`, path prefixes, and brace extension patterns such as `**/*.{tsx,jsx,css}`.

## Scope

### In Scope

- Config schema additions for `agents.tiers.<tier>.choices` and `agents.tiers.<tier>.routing.rules`.
- TypeScript output types for tier choices, routing rules, selection metadata, and effective recipes.
- Validation for choice names, unknown route references, cross-tier route references, nested choice/routing blocks, and missing effective `harness`, `model`, or `effort` after inheritance.
- Validation that harness-specific settings, Pi provider settings, toolbelt references, bare-agent resource isolation, and model capability clamping still run on the effective recipe.
- Declarative routing by role, phase, stage, path globs, keywords, shard ids, and shard roots.
- Shared resolver/helper used by agent config resolution and registry lookup.
- Registry memoization by effective harness-relevant dimensions: harness type, provider, resource isolation, selected project MCP servers/toolbelt surface, subagent policy, and other existing harness construction inputs.
- Core tests for schema, resolver, registry, toolbelt, and legacy config compatibility.

### Out of Scope

- Extension-provided runtime-choice routers.
- Public event schema changes.
- Pi and Claude profile creation surfaces.
- Full Console profile editing.
- Arbitrary tier names beyond planning, implementation, review, and evaluation.
- Letting `onAgentRun` alter harness, model, or runtime choice selection.

## Files

### Create

- `packages/engine/src/pipeline/runtime-choice.ts` — Runtime choice types, declarative rule matching, choice reference canonicalization, effective recipe inheritance, and selection result construction.
- `packages/engine/src/pipeline/agent-runtime.ts` — Shared invocation helper that resolves role/tier/choice/effective recipe, resolves agent config, and obtains the harness from the registry.
- Optional `packages/engine/src/pipeline/path-globs.ts` — Add only if no existing path matcher supports the required routing glob forms.

### Modify

- `packages/engine/src/config.ts` — Add Zod schemas, output types, strict validation, path-specific errors, legacy profile preservation, and profile creation/loading behavior for tier choices and routing rules.
- `packages/engine/src/pipeline/agent-config.ts` — Replace the single tier recipe assumption with effective-choice recipe input while preserving existing role tier defaults, role overrides, plan overrides, provenance stamping, effort clamping, and thinking coercion.
- `packages/engine/src/agent-runtime-registry.ts` — Replace tier-only lookup with effective recipe lookup; keep harness sharing for identical effective recipes and distinct instances for different providers/resources/toolbelt surfaces.
- `packages/engine/src/agents/common.ts` and `packages/engine/src/agents/resolved-agent-task.ts` — Route all agent invocation setup through the shared helper.
- Any direct call sites under `packages/engine/src/` found by searching for `resolveAgentConfig`, `forRoleResolved`, `forRole(`, or direct tier recipe access — update them to use the shared helper or pass the already resolved runtime result.
- `test/agent-config.test.ts` or the nearest existing agent-config test file — Add schema and resolver tests.
- `test/agent-runtime-registry.test.ts` — Add harness memoization and choice-aware lookup tests.
- `test/toolbelt-runtime.test.ts` — Add effective recipe/toolbelt routing cases if this file owns toolbelt runtime coverage.
- `test/stub-harness.ts` or related test utilities — Extend only if needed to assert selected harness/model/toolbelt from a resolved runtime.

## Database Migration

None.

## Verification

- [ ] A legacy profile fixture without `choices` resolves the same tier, harness, model, effort, thinking, toolbelt, and provenance values as before this change.
- [ ] A role or plan tier override with tier choices resolves the overridden tier before evaluating that tier’s routing/default choice, preserving existing role-to-tier precedence.
- [ ] A tier with `choices.ui` and `choices.backend` inherits missing fields from the tier default and validates the effective recipe after inheritance.
- [ ] Config validation rejects `choices.default`, choice names outside the selected slug pattern, nested `choices`, nested `routing`, unknown route choices, cross-tier route choices, and missing effective `harness`, `model`, or `effort` with error paths under the offending tier field.
- [ ] Ordered declarative rules select `implementation.ui` for UI path/keyword hints and `implementation.backend` for backend path hints in resolver tests.
- [ ] A no-match declarative routing case selects `implementation.default` and records a deterministic no-match fallback reason.
- [ ] Agent invocation setup returns one result object whose `agentConfig.model`, selected harness, toolbelt summary, and `selection.effectiveRecipe` all refer to the same choice.
- [ ] Registry tests show identical effective recipes share a harness instance and different providers, resource isolation settings, toolbelt-selected MCP server sets, or subagent policies create distinct instances.
- [ ] `agents.bare` Pi resource isolation behavior remains covered by an existing or new test.

## Recovery Guidance

- Failed PRD: "per-invocation-runtime-choice-routing"
- Root failed plan: "plan-01-runtime-choice-core"
- Failure summary: "Compiled plan artifacts are eligible for continue-and-repair for per-invocation-runtime-choice-routing. artifact source: feature-branch; 3 landed commit(s); failing plan: plan-01-runtime-choice-core; feature branch: eforge/per-invocation-runtime-choice-routing. Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD."
- Failure detail: "1 blocking issue outcome(s) remain after 2 review round(s) (1 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Failure detail: "1 blocking issue outcome(s) remain after 2 review round(s) (1 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Recommended action: "Continue and repair build (Continue build): run `eforge continue-repair per-invocation-runtime-choice-routing`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD."
- Remaining work:
  - "Repair plan-01-runtime-choice-core by making config validation run unknown-choice checks against the same merged effective config layers used by loadConfig."
  - "Avoid validating unknown choices in each raw config layer before merge, because layered configs may define routing and choices separately."
  - "After repair, continue blocked plans [REDACTED_HIGH_ENTROPY] and [REDACTED_HIGH_ENTROPY]."
- Retry/resume guidance: Continue plan-01-runtime-choice-core for failed PRD per-invocation-runtime-choice-routing from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.
- Sidecar generated at: 2026-07-01T16:09:18.919Z
- Source sidecar: .eforge/queue/failed/per-invocation-runtime-choice-routing.recovery.json
- Source identity: prdId=per-invocation-runtime-choice-routing; setName=per-invocation-runtime-choice-routing; featureBranch=eforge/per-invocation-runtime-choice-routing; baseBranch=main
