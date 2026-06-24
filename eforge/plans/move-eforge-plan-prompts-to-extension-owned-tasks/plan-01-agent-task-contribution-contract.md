---
id: plan-01-agent-task-contribution-contract
name: Agent Task Contribution Contract
branch: move-eforge-plan-prompts-to-extension-owned-tasks/plan-01-agent-task-contribution-contract
agents:
  builder:
    effort: high
    rationale: Adds a new extension contribution surface and client wire shape used
      by later plans.
  reviewer:
    effort: high
    rationale: Public SDK/client contracts and registry projection changes need
      API-focused review.
---

# Agent Task Contribution Contract

## Architecture Context

eforge already records extension actions, workstations, reviewer perspectives, tools, and validation providers through the native extension recorder. This plan adds the product-agnostic registration surface that later plans use for prompt-backed agent tasks. It does not move eforge-plan execution yet; it establishes typed owner-scoped contribution declarations, safe metadata projection, and a client request shape that can identify a contribution without sending prompt paths to the engine.

Key boundary decisions:
- Extension-facing requests name owner-scoped task contributions.
- Engine-facing execution will receive resolved prompt text and generic run configuration in later plans.
- Prompt asset paths are declared by trusted extension code, not supplied by task-start callers.

## Implementation

### Overview

Add a `registerAgentTask`/`defineExtensionAgentTaskContribution` API to `@eforge-build/extension-sdk`, record those contributions in the engine extension registry, project safe manifest metadata, and extend `@eforge-build/client` task-start contracts to support contribution references alongside the legacy task kind during transition.

### Key Decisions

1. **Use local contribution ids plus extension owner.** The SDK contribution `id` is local to an extension; effective ids are projected with the same `extensionName:localId` convention used by actions.
2. **Expose asset metadata, never resolver functions.** Manifest projections include title, description, input schema, output schema when supplied, and prompt source metadata (`asset` or `export`). Function bodies and raw prompt text stay private.
3. **Keep legacy start shape as a client/daemon compatibility variant.** `{ kind: 'eforge-plan.planning-draft', input }` remains parseable during the transition, but later plans must not route it to engine eforge-plan prompt names.
4. **Validate declared assets twice.** Recorder validation rejects absolute paths, NULs, `..` segments, and empty asset names; daemon resolution in later plans must repeat path containment checks before reading.

## Scope

### In Scope

- New SDK task contribution types and helper.
- Extension recorder/registry/loader support for task contribution declarations.
- Client schema/type additions for contribution references and manifest metadata.
- API documentation for extension authors.
- Tests for declaration validation, duplicate handling, manifest parsing, and client request parsing.

### Out of Scope

- Running contributions through the daemon service.
- Moving eforge-plan prompt files.
- Removing engine eforge-plan prompt loaders.
- Backlog-curation map/reduce execution changes.

## Files

### Create

- `packages/extension-sdk/src/agent-tasks.ts` — SDK types for prompt-backed agent task contributions, prompt sources, resolver context/result, custom tools, and `defineExtensionAgentTaskContribution()`.
- `packages/client/src/__tests__/extension-agent-task-contributions.test.ts` — client schema tests for contribution references, legacy start compatibility, manifest parsing, and rejection of caller-supplied prompt paths.
- `test/extension-agent-task-contribution-registration.test.ts` — recorder/manifest tests for valid registrations, duplicate local ids, bad input schemas, bad prompt asset paths, and export prompt sources.

### Modify

- `packages/extension-sdk/src/api.ts` — add `registerAgentTask()` to `EforgeExtensionAPI`.
- `packages/extension-sdk/src/index.ts` — export new task contribution types/helper.
- `packages/extension-sdk/src/contributions.ts` — update `ExtensionAgentTasksApi.start()` to accept the new contribution-reference start request type.
- `packages/engine/src/extensions/types.ts` — add `AgentTaskRegistration`, contribution spec types, recorder state, registry state, and registration counts.
- `packages/engine/src/extensions/recorder.ts` — validate and record `registerAgentTask()` calls; merge duplicate local ids with diagnostics.
- `packages/engine/src/extensions/loader.ts` — initialize task contribution arrays and include counts in loaded-extension registration summaries.
- `packages/engine/src/extensions/manifest.ts` — project optional `agentTasks` manifest entries without raw prompt text or resolver functions.
- `packages/engine/src/extensions/projector.ts` — include task contribution counts and safe details in registry projections.
- `packages/engine/src/extensions/dependency-resolution.ts` — include task contributions in contribution availability evaluation.
- `packages/client/src/extension-agent-tasks.ts` — add `ExtensionAgentTaskContributionRefSchema` and a start-request union for `{ task, input }` plus the existing legacy `{ kind, input }` form.
- `packages/client/src/extension-contributions.ts` — add optional `agentTasks` manifest schema/types.
- `packages/client/src/types.ts` — add agent task contribution counts/details where extension registry projections expose them.
- `docs/extensions-api.md` — document `registerAgentTask`, contribution ids, prompt asset constraints, and resolver responsibilities.
- Existing extension registry tests that construct `NativeExtensionRegistry` or registration-count objects — add the new `agentTasks` field where type checking requires it.

## Verification

- [ ] `safeParseExtensionAgentTaskStartRequest({ task: { id: 'planning-draft' }, input: { topic: 'Demo' } })` returns success.
- [ ] `safeParseExtensionAgentTaskStartRequest({ task: { id: 'planning-draft', promptAsset: '../x.md' }, input: {} })` returns failure.
- [ ] A recorder test registers two task contributions with the same local id and emits one duplicate diagnostic.
- [ ] Manifest projection includes an `agentTasks` entry with `id`, `localId`, `extensionName`, `inputSchema`, and declared prompt source, and does not include raw prompt text.
- [ ] `docs/extensions-api.md` contains a `registerAgentTask` section naming asset path restrictions.
- [ ] `pnpm vitest run packages/client/src/__tests__/extension-agent-task-contributions.test.ts test/extension-agent-task-contribution-registration.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.