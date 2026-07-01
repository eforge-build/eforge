---
id: plan-02-runtime-choice-events-extensions
name: Runtime Choice Events and Extension Routers
branch: per-invocation-runtime-choice-routing/plan-02-runtime-choice-events-extensions
agents:
  builder:
    effort: high
    rationale: This plan extends public event and extension SDK contracts while
      keeping failures fail-open and secret-safe.
  reviewer:
    effort: high
    rationale: The review needs focused attention on event compatibility, extension
      API boundaries, and secret-safe metadata.
---

# Runtime Choice Events and Extension Routers

## Architecture Context

After plan 01, the engine has a deterministic runtime-choice selection result for every agent invocation. This plan exposes safe observability through the shared client event schema and adds optional extension runtime-choice routers that run only when no declarative rule matches.

Event schemas and daemon wire shapes are owned by `@eforge-build/client`; do not redeclare event wire types in monitor, console, CLI, Pi, or plugin packages.

## Implementation

### Overview

Extend agent lifecycle metadata with the selected runtime choice and selection provenance. Add an extension SDK hook that can choose among configured choices for advanced policy cases. The router hook is fail-open: declines, invalid selections, timeouts, and thrown errors select the deterministic default and emit diagnostics through selection metadata/logging rather than failing the build.

### Key Decisions

1. Extend `agent:start` with choice metadata unless an existing lifecycle event structure requires a companion event. If a companion event is added, `agent:start` still carries the summary fields needed by monitor and console views.
2. Use canonical selection fields: local choice name, qualified `tier.choice`, source, optional rule/router name, and optional fallback reason.
3. Invoke extension routers only when no declarative routing rule matches; a rule that selects `default` is still a rule match and prevents extension routers for that invocation.
4. Execute extension routers in registration order and stop at the first valid configured choice.
5. Keep `onAgentRun` prompt/tool augmentation only. Its context may observe the selected choice but its return value must not mutate harness, model, provider, effort, toolbelt, or runtime choice.
6. Keep router context bounded and secret-safe; include summaries and path hints, not API keys, raw profile bodies, or full PRD text.

## Scope

### In Scope

- Typed runtime-choice metadata on `agent:start` through client event schemas.
- Engine event emission updates so every agent start includes role, tier, runtime choice, source, rule/router name when applicable, and fallback reason when applicable.
- Trace/run options metadata propagation through `AgentRunOptions`, `ClaudeSDKHarness`, and `PiHarness` where lifecycle events are emitted.
- Extension SDK registration for runtime-choice routers, following existing `registerProfileRouter` recorder/runtime patterns.
- Engine extension runtime integration, including timeouts, ordered router execution, diagnostics, invalid-choice fallback, thrown-error fallback, timeout fallback, and decline fallback.
- `onAgentRun` context update to include the already-selected runtime choice for observability.
- Monitor/console read-only display updates if existing agent detail or event rows already display tier/model/harness metadata.
- Event and extension tests.

### Out of Scope

- Changing build-level `registerProfileRouter`; it still selects only the active profile before build dispatch.
- Allowing extension routers to select unconfigured choices.
- Fail-closed runtime-choice policy.
- Full Console profile editing.
- Docs and profile creation surface updates; those are handled in plan 03.

## Event Field Contract

Add fields equivalent to the following to the client-owned agent start schema:

```ts
runtimeChoice: string;              // local name such as "default", "ui", or "backend"
runtimeChoiceQualified: string;     // e.g. "implementation.ui"
runtimeChoiceSource: 'default' | 'rule' | 'extension-router' | 'fallback';
runtimeChoiceRule?: string;
runtimeChoiceRouter?: string;
runtimeChoiceFallbackReason?:
  | 'no-match'
  | 'router-declined'
  | 'router-timeout'
  | 'router-error'
  | 'router-invalid-choice';
```

If existing naming conventions in `packages/client/src/events/` prefer a different prefix, keep the same semantics and update all engine call sites and tests consistently. Do not include API keys, provider secrets, raw profile YAML, or raw full PRD text.

## Extension Router Contract

Mirror existing extension SDK registration style. The public API can be shaped like:

```ts
registerRuntimeChoiceRouter('router-name', async (context) => {
  return { choice: 'ui', reason: 'matched component paths', confidence: 0.8 };
});
```

Context fields:

- `role`, `tier`, and active profile name.
- `availableChoices`, including `default` and configured names for the resolved tier.
- `phase`, `stage`, and `planId` when available.
- Capped PRD/plan/task summary text and keyword text.
- Changed-file, shard-id, shard-root, and shard-file hints when available.
- Existing safe extension services such as logger/project paths/exec equivalents, matching current extension context policy.

Return handling:

- `undefined`, `null`, or an explicit decline continues to the next router.
- A local choice or matching qualified `tier.choice` selects that choice.
- Unknown choices, cross-tier choices, thrown errors, and timeouts are diagnostics and fall back deterministically.
- Router reason/confidence can be logged or traced but must not be required for selection.

## Files

### Create

- `packages/engine/src/extensions/runtime-choice-router.ts` — Runtime support for invoking registered runtime-choice routers with timeout, validation, and fallback mapping.
- Optional `test/runtime-choice-extension-router.test.ts` — Add if no existing extension runtime test file fits this hook.

### Modify

- `packages/client/src/events/agent.ts` and related files under `packages/client/src/events/` — Add runtime-choice fields to the typed event schema and exported event types.
- `packages/client/src/events.schemas.ts` — Keep the compatibility facade in sync with the event module changes.
- `packages/engine/src/events.ts` — Ensure engine event typing reflects the client-owned schema.
- `packages/engine/src/harness.ts` — Add runtime-choice metadata to run options or lifecycle context used by harnesses.
- `packages/engine/src/harnesses/claude-sdk.ts` — Include runtime-choice metadata in emitted `agent:start` events/traces.
- `packages/engine/src/harnesses/pi.ts` — Include runtime-choice metadata in emitted `agent:start` events/traces.
- `packages/engine/src/pipeline/runtime-choice.ts` — Add extension-router selection stage after declarative no-match, while preserving plan 01 deterministic routing behavior.
- `packages/engine/src/pipeline/agent-runtime.ts` — Pass extension runtime context into the resolver and return the final selection.
- `packages/engine/src/extensions/*` — Register, record, load, and expose runtime-choice routers using the existing extension registry/recorder patterns.
- `packages/extension-sdk/src/hooks.ts` — Add public types for runtime-choice router context and result.
- `packages/extension-sdk/src/api.ts` — Export the registration API.
- Extension SDK recorder/types files — Capture runtime-choice router registrations in tests and extension loading.
- `packages/engine/src/agents/common.ts`, `packages/engine/src/agents/resolved-agent-task.ts`, and any agent launcher helpers — Pass phase/stage/plan/shard/path/summary hints into runtime selection and pass selection metadata into harness run options.
- `packages/monitor/src/**` — Update only projection or allow-list code that assumes a fixed `agent:start` shape.
- `packages/console-ui/src/**` — Update only existing read-only agent metadata displays if they already show tier/model/harness fields.
- `test/extension-profile-router-runtime.test.ts` or adjacent extension runtime tests — Add runtime-choice router registration, order, decline, invalid choice, timeout, and thrown-error tests.
- `test/extension-agent-context-runtime.test.ts` — Assert `onAgentRun` receives selected choice metadata and cannot change runtime selection.
- Event schema tests — Assert the extended `agent:start` validates with `safeParseEforgeEvent` and rejects malformed runtime-choice metadata.
- `test/stub-harness.ts` and agent wiring tests — Assert selected runtime-choice metadata reaches harness run options.

## Database Migration

None.

## Verification

- [ ] `agent:start` events emitted by both Claude SDK and Pi harness paths validate through `safeParseEforgeEvent` with runtime-choice fields present.
- [ ] Event tests confirm runtime-choice metadata contains choice names, source, rule/router name, and fallback reason only; API keys, raw profile YAML, and raw full PRD text are absent.
- [ ] A declarative rule match, including one that selects `default`, emits source `rule` and the matching rule name, and no extension router is invoked for that invocation.
- [ ] A registered extension router selects a configured choice when no declarative rule matches, and the harness/model/config used for the run match that selected choice.
- [ ] Router decline, timeout, thrown error, and invalid choice tests all continue the build path and select the deterministic default with the expected fallback reason.
- [ ] Multiple router registrations run in registration order and stop after the first valid configured choice.
- [ ] `registerProfileRouter` tests still show profile selection occurs before build dispatch and does not select per-invocation choices.
- [ ] `onAgentRun` context includes selected runtime-choice metadata and a returned prompt/tool augmentation cannot change harness, model, effort, provider, or toolbelt.
- [ ] Model tracker or commit-message coverage records the resolved model id from the selected runtime choice and leaves the `Models-Used:` trailer format unchanged.