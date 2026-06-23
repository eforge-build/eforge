---
title: Agent-First Backlog Discovery and Session Plan Auto-Creation
created: 2026-06-22
---

# Agent-First Backlog Discovery and Session Plan Auto-Creation

## Problem / Motivation

The AI-first planning loop still has two high-friction, context-heavy seams:

- Coding agents can discover eforge-plan backlog capabilities only by using the generic `eforge_extension_contribution` listing, whose current default returns large manifest-style payloads with full input schemas and diagnostics. This burns context before the agent reaches the compact backlog actions it actually needs.
- Recommendation lane `Plan` already starts a daemon-owned planning task that can return a `sessionPlanCreationDraft`, but the workstation currently makes the user reopen the completed task, click `Create session plan`, and confirm. Readiness/sign-off still happens after plan creation, so the extra completed-task confirmation is mostly redundant.

## Goal

Make the end-to-end planning loop agent-first by providing compact discovery for known backlog operations, then automatically creating and opening a ready session plan when a recommendation planning task completes successfully.

## Approach

Implement two coordinated feature slices.

### Compact agent-first contribution and backlog listing ergonomics

- Make contribution listings compact by default for coding-agent hosts, avoiding full input schemas and diagnostics unless requested.
- Add a focused detail/show path for one contribution that can include full schema and diagnostics on demand.
- Support practical list narrowing by contribution kind, extension name, search/id prefix, output profile, limit, and offset.
- Ensure MCP and Pi tool/command responses use host-safe formatting and summarization for list responses, comparable to existing invocation output formatting.
- Tighten failed invocation envelopes so they preserve target/action identity and useful error details without echoing large raw `target.input` payloads.
- Document and direct agents toward eforge-plan backlog operations: `search-items`, `get-item`, `get-epic`, `capture-item`, and `update-item`.
- Add projection controls to compact eforge-plan backlog reads where needed, such as optional epics, lane counts, sections, lifecycle rows, dependencies, and body text.

### Auto-create session plans from completed recommendation planning tasks

- Keep recommendation lane `Plan` starting the existing `sessionPlanCreationDraft` planning task.
- In the workstation planning-task polling/workflow layer, detect completed tasks that contain a valid ready `sessionPlanCreationDraft`.
- Automatically call `apply-planning-agent-task-result` with `applySessionPlanCreationDraft: {}` for eligible completed tasks.
- On successful apply, mark or remove the consumed task, refresh artifacts and board state, and navigate to the created session plan in the Plans focus.
- Keep `needs-input`, failed, cancelled, unavailable, and apply-error/collision cases visible in Planning activity with actionable review/retry messaging.

### Technical decisions and constraints

- Prefer compact-by-default only for coding-agent host pathways, with explicit full/detail modes for debugging and human inspection.
- Avoid breaking rich UI needs while fixing agent context pressure.
- Put contribution projection/detail logic in shared client code rather than duplicating compaction in MCP, Pi, and CLI wrappers.
- Treat diagnostics and full input schemas as opt-in detail data.
- List entries should carry enough identity, availability, side-effect, and output-profile metadata for safe selection.
- Keep eforge-plan backlog access action-oriented so agents are guided to direct compact operations instead of browsing the whole contribution manifest first.
- Auto-apply only when the completed task result is ready and contains a valid `sessionPlanCreationDraft`.
- Do not auto-apply `needs-input`, failed/cancelled, unavailable, backlog curation, recommendations, handoff drafts, or ambiguous multi-output tasks unless future product work explicitly allows it.
- Implement duplicate-apply protection in the workflow hook using in-flight/attempted tracking similar to the plan-revision auto-apply pattern.
- Prevent polling/reload cycles from creating duplicate session-plan apply requests.
- Preserve existing apply validation as the authority for collisions and non-abandoned plan overwrite protection.
- Surface apply validation errors rather than bypassing them.
- After successful automatic creation, continue the workflow in Plans focus rather than Planning activity because readiness review/sign-off is the next human gate.
- Keep extension manifest and invocation wire contracts daemon/client-owned and projected through `@eforge-build/client` helpers.
- Keep host integrations as thin renderers over shared client projection/formatting rather than independent manifest shapers.
- Keep planning workflow UX owned by the workstation.
- Do not add session-plan authoring, scheduling, or richer workflow responsibilities to the build engine/kernel.
- Update MCP/Pi/CLI reference docs and eforge-plan agent workflow docs when behavior changes.

### Likely implementation areas

- Update `packages/client/src/api/extension-contribution-dispatch.ts`, where `summarizeExtensionContributionManifest` currently maps actions/commands/deep links and includes `inputSchema` plus manifest diagnostics, to add compact/detail projection options shared by CLI, MCP, Pi, and other clients.
- Reuse or extend `packages/client/src/extension-contribution-output-formatting.ts` for host-safe formatting of list output as well as invocation output.
- Update `packages/eforge/src/cli/mcp-extension-contributions.ts` to support list/detail/projection options in the tool schema.
- Format MCP list responses through the shared compact formatter.
- Ensure MCP failed invocations use the smaller envelope.
- Update `packages/pi-eforge/extensions/eforge/extension-contributions.ts` and related Pi UX helpers to mirror MCP options.
- Apply safe list/detail rendering in Pi.
- Keep Pi and Claude/MCP integration behavior in sync.
- Update daemon/client route schema code that owns extension contribution manifest and invocation response types if new request parameters or response projections are needed.
- Update `eforge/extensions/eforge-plan/backlog-query-actions.ts`, where `search-items`, `get-item`, `get-epic`, and `list-board-compact` already exist with agent-paginated output, to add missing projection switches carefully instead of expanding default payloads.
- Update `eforge/extensions/eforge-plan/index.ts` and extension registration tests for descriptions, output profiles, and any direct/aliased agent operation registration.
- Update eforge-plan README/docs/tests that define agent workflow guidance.
- Extend polling/reload behavior in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` to auto-apply eligible completed creation tasks while preventing duplicate apply attempts.
- Preserve or reuse existing `applyAndOpenPlan` behavior in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/workstation-view.tsx`.
- Keep review/confirmation controls for non-auto-applied cases and apply errors in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx`.
- Avoid surfacing unnecessary success confirmations for auto-consumed creation tasks.
- Reuse existing `applySessionPlanCreationDraft` validation/collision handling in `eforge/extensions/eforge-plan/planner-orchestration.ts` and `planning-agent-task-schemas.ts`.
- Adjust planner orchestration or planning agent task schemas only if the workflow needs an explicit consumed/error marker.
- Add or adjust tests under `eforge/extensions/eforge-plan/__tests__/` and `workstation-src/plans/src/views/**` for action contract, workflow hook polling, result preview visibility, and registration/readme contracts.

### Repository guardrails

- Do not inline daemon route constants or wire shapes outside `@eforge-build/client`.
- Keep `eforge-plugin/` and `packages/pi-eforge/` in sync for user-facing host behavior.
- Bump the Claude plugin version if plugin files change.
- Do not bump the Pi package version.

### Assumptions

- The large context payload comes primarily from generic contribution listing, not from direct compact eforge-plan actions.
- Completed recommendation planning tasks include enough result metadata for the workstation to identify a ready `sessionPlanCreationDraft` without opening the manual preview first.
- Existing `apply-planning-agent-task-result` behavior already marks workflow-indexed creation drafts applied and hides consumed tasks from normal task lists after success.
- Existing collision safeguards should remain the source of truth for whether the target session can be created.

### Risks and guardrails

- Existing scripts may expect full schemas/diagnostics from contribution list.
- Explicit full/detail modes and clear docs mitigate compatibility risk for existing scripts that expect full schemas/diagnostics.
- Suppressing diagnostics by default could hide debugging context.
- Compact availability summaries and diagnostics opt-in mitigate the risk of hidden debugging context.
- MCP, Pi, and CLI could drift.
- Shared client projection/formatting and tests for both consumer-facing integration packages mitigate host integration drift.
- Polling/reload can observe the same completed task multiple times.
- In-flight/attempted/applied tracking and server-side applied markers mitigate duplicate apply risk.
- A session collision could repeatedly fail auto-apply.
- An actionable non-looping error state and leaving the task visible mitigate repeated collision failure.

## Scope

In scope:

- Compact agent-first contribution/backlog listing ergonomics.
- Compact-by-default contribution listing for coding-agent hosts.
- Full single-contribution detail/show retrieval with schema and diagnostics on demand.
- List narrowing by contribution kind, extension name, search/id prefix, output profile, limit, and offset.
- Host-safe and summarized contribution-list responses for MCP and Pi.
- Smaller failed invocation envelopes that preserve action identity, target identity, useful error details, and summarized input keys/size.
- Direct backlog workflow guidance for `search-items`, `get-item`, `get-epic`, `capture-item`, and `update-item`.
- Projection controls for optional epics, lane counts, sections, lifecycle rows, dependencies, and body/body-text inclusion where useful.
- Auto-create session plans from completed recommendation planning tasks.
- Keeping recommendation lane `Plan` on the existing planning task path.
- Automatic application of valid ready `sessionPlanCreationDraft` results from the workstation workflow layer.
- Consuming/removing or marking applied tasks after successful apply.
- Refreshing workstation artifacts and board state after successful apply.
- Opening the created session plan in the Plans focus after successful apply.
- Keeping `needs-input`, failed, cancelled, unavailable, and apply-error cases visible in Planning activity with review/retry messaging.
- Preserving collision safeguards that prevent overwriting non-abandoned session plans.
- Surfacing collisions clearly.

Out of scope:

- Removing readiness/sign-off gates after session-plan creation.
- Auto-handing off created session plans to eforge builds.
- Replacing the extension contribution system with eforge-plan-specific host tools outside the existing extension mechanism unless an alias is a thin documented convenience over current actions.

## Acceptance Criteria

- `eforge_extension_contribution` list output for coding-agent hosts defaults to a compact projection.
- `eforge_extension_contribution` compact list output omits full input schemas unless explicitly requested.
- `eforge_extension_contribution` compact list output omits diagnostics unless explicitly requested.
- A single-contribution detail/show path exists.
- The single-contribution detail/show path can include the full input schema when requested.
- The single-contribution detail/show path can include diagnostics when requested.
- Contribution list requests support narrowing by contribution kind.
- Contribution list requests support narrowing by extension name.
- Contribution list requests support narrowing by search/id prefix.
- Contribution list requests support narrowing by output profile.
- Contribution list requests support `limit`.
- Contribution list requests support `offset`.
- Pi contribution-list responses are host-safe and summarized/budgeted.
- MCP contribution-list responses are host-safe and summarized/budgeted.
- Broad Pi contribution-list responses no longer dump raw full manifests by default.
- Broad MCP contribution-list responses no longer dump raw full manifests by default.
- Failed contribution invocations include action identity.
- Failed contribution invocations include target identity.
- Failed contribution invocations include useful error details.
- Failed contribution invocations do not echo large raw `target.input` payloads.
- Failed contribution invocations include summarized input keys/size.
- Agent documentation directs backlog workflows to `search-items`.
- Agent documentation directs backlog workflows to `get-item`.
- Agent documentation directs backlog workflows to `get-epic`.
- Agent documentation directs backlog workflows to `capture-item`.
- Agent documentation directs backlog workflows to `update-item`.
- Compact backlog reads expose projection controls for optional epics where useful.
- Compact backlog reads expose projection controls for lane counts where useful.
- Compact backlog reads expose projection controls for sections where useful.
- Compact backlog reads expose projection controls for lifecycle rows where useful.
- Compact backlog reads expose projection controls for dependencies where useful.
- Compact backlog reads expose projection controls for body/body-text inclusion where useful.
- Clicking `Plan` in a recommendation lane still starts the existing planning task path.
- A completed task with a valid `sessionPlanCreationDraft` is automatically applied from the workstation workflow layer without task-result review clicks.
- Automatic application uses `apply-planning-agent-task-result` with `applySessionPlanCreationDraft: {}`.
- Successful automatic apply consumes/removes or marks the task applied.
- Successful automatic apply refreshes workstation data.
- Successful automatic apply opens the created plan in the Plans focus.
- `needs-input` planning tasks remain visible in Planning activity.
- Failed planning tasks remain visible in Planning activity.
- Cancelled planning tasks remain visible in Planning activity.
- Unavailable planning tasks remain visible in Planning activity.
- Apply-error planning tasks remain visible in Planning activity.
- Collision cases remain visible in Planning activity.
- Visible non-success planning task states include actionable review/retry messaging.
- Existing safeguards still prevent overwriting non-abandoned session plans.
- Existing safeguards surface session-plan creation collisions clearly.
- Tests verify compact contribution-list entries omit schemas by default.
- Tests verify compact contribution-list entries omit diagnostics by default.
- Tests verify full input schemas are included in detail/full mode when requested.
- Tests verify diagnostics are included in detail/full mode when requested.
- Tests verify contribution list filtering honors contribution kind.
- Tests verify contribution list filtering honors extension name.
- Tests verify contribution list filtering honors search/id prefix.
- Tests verify contribution list filtering honors output profile.
- Tests verify contribution list pagination honors `limit`.
- Tests verify contribution list pagination honors `offset`.
- Tests verify failed invocation envelopes elide large raw inputs.
- Tests verify failed invocation envelopes include summarized input keys/size.
- Tests verify direct backlog workflow guidance is present for `search-items`.
- Tests verify direct backlog workflow guidance is present for `get-item`.
- Tests verify direct backlog workflow guidance is present for `get-epic`.
- Tests verify direct backlog workflow guidance is present for `capture-item`.
- Tests verify direct backlog workflow guidance is present for `update-item`.
- Tests verify any new eforge-plan query/action projection switches.
- Tests verify default compact eforge-plan payloads do not grow unexpectedly.
- Tests verify auto-apply succeeds for eligible completed session-plan creation tasks.
- Tests verify duplicate auto-apply requests are prevented across polling/reload cycles.
- Tests verify `needs-input` tasks are not auto-applied.
- Tests verify failed tasks are not auto-applied.
- Tests verify cancelled tasks are not auto-applied.
- Tests verify unavailable tasks are not auto-applied.
- Tests verify apply failures remain visible.
- Tests verify collision errors remain visible.
- Tests verify retry behavior after transient apply failure if appropriate.
- MCP formatting tests or existing host-surface tests verify list responses are budgeted/summarized.
- Pi formatting tests or existing host-surface tests verify list responses are budgeted/summarized.
- Integration-style action tests cover `apply-planning-agent-task-result` when contract changes are needed.
- Existing application/collision tests continue covering `apply-planning-agent-task-result` when no contract changes are needed.
- MCP/Pi/CLI reference docs are updated when behavior changes.
- Eforge-plan agent workflow docs are updated when behavior changes.
- `pnpm test` exits 0 before handoff/commit.
- `pnpm type-check` exits 0 before handoff/commit.
- `pnpm maintainability:check` exits 0 before handoff/commit.
- `pnpm docs:check` exits 0 if docs/reference output changes.