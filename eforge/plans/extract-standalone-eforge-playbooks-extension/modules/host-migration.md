# Host Migration

## Architecture Reference

This module implements the architecture sections **Integration contracts by subsystem > Host compatibility commands/tools**, **Shared data model and contracts > Action IDs**, **Shared data model and contracts > Planning-mode handoff**, and the host portions of **Quality attributes > Cross-host parity** and **Extension-unavailable behavior**.

Key constraints from architecture:
- CLI, MCP/Claude, Pi commands/tools, and playbook skills must preserve user-facing playbook workflows by invoking `eforge-playbooks:*` through generic extension contribution/action dispatch.
- Host compatibility surfaces must not call `/api/playbook/*`, `apiPlaybook*`, `API_ROUTES.playbook*`, `sessionPlanCreateFromPlaybook`, or monitor playbook services.
- Compatibility `eforge_playbook` tools may remain, but every branch must delegate to the extension-owned actions. Add `copy` support because the skills use the compatibility tool as their primary playbook path.
- Planning-mode playbook runs must use `eforge-playbooks:run-playbook` and surface the returned eforge-plan contribution/workstation metadata or diagnostics. Hosts must not create session plans directly and must not enqueue planning-mode PRDs.
- Keep `eforge-plugin/` and `packages/pi-eforge/` playbook behavior in sync. Bump `eforge-plugin/.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.
- Use bounded exact edits in oversized legacy files, especially `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts`.

Dependency note:
- This plan set declares `boundary-removal` as a dependency even though the architecture graph places boundary deletion after host migration. Implement this module against the post-boundary surface: direct playbook client helpers and route keys may already be gone. If an implementation worktree still contains those helpers, replace the host callers anyway and do not add compatibility wrappers under the old names.

Shared-file ownership note:
- The architecture registry assigns the core host files to `host-migration`. It assigns broad regression tests to `docs-and-regression-guards`; this module takes a narrow ownership override for existing host behavior tests that compile against deleted direct helpers. Those test edits are marked with `[region: host-migration, ...]` below so the final regression-guard module can add broader audits without overlapping assertions.

## Scope

### In Scope
- Add small host-local playbook contribution helpers for the CLI package and Pi extension package.
- Replace CLI `eforge playbook ...` and `eforge play ...` direct playbook helper calls with `eforge-playbooks:*` generic contribution invocation.
- Replace Claude MCP `eforge_playbook` compatibility tool direct route calls with `eforge-playbooks:*` generic contribution invocation.
- Add `copy` to the Claude MCP `eforge_playbook` compatibility tool.
- Remove the playbook-specific `create-from-playbook` branch from the Claude MCP `eforge_session_plan` tool.
- Replace Pi native `/eforge:playbook` command direct helper calls with `eforge-playbooks:*` generic contribution invocation.
- Replace Pi native `eforge_playbook` tool direct route calls with `eforge-playbooks:*` generic contribution invocation.
- Add `copy` to the Pi native `eforge_playbook` tool.
- Remove the playbook-specific `create-from-playbook` branch from the Pi native `eforge_session_plan` tool.
- Update Claude and Pi playbook skills so they describe playbooks as owned by `eforge-playbooks`, keep compatibility tool usage behind extension delegation, and use `copy-playbook`/`eforge_playbook { action: "copy" }` instead of direct daemon routes.
- Update host tests to assert generic contribution IDs, unavailable-extension diagnostics, planning metadata display, and absence of direct playbook route/helper references in host files.
- Bump the Claude plugin patch version in `eforge-plugin/.claude-plugin/plugin.json`.

### Out of Scope
- Implementing `eforge-playbooks` actions, schemas, capabilities, package registration, or package-local tests.
- Removing daemon/client playbook routes or client helper files.
- Removing core Console Playbooks UI.
- Updating public web/docs reference pages or generated docs.
- Reintroducing session-plan creation from a playbook through any host compatibility tool.
- Bumping `packages/pi-eforge/package.json`.

## Implementation Approach

### Overview

Migrate hosts by creating thin, host-local adapters over the generic extension contribution dispatch helpers that already exist in `@eforge-build/client`. The adapters map stable compatibility action names (`list`, `show`, `save`, `validate`, `copy`, `promote`, `demote`, `run`) to effective extension integration command IDs (`eforge-playbooks:list-playbooks`, etc.) and always pass `kind: 'command'` to avoid ambiguity with same-id action registrations.

The CLI adapter returns unwrapped action outputs and throws user-facing errors with install/trust/reload guidance when the contribution cannot be resolved or returns an unavailable/failure response. The Pi adapter mirrors the old `IfRunning` ergonomics by returning `null` when the daemon is unavailable and throwing a displayable error for extension action failures. MCP tools use the same CLI adapter and convert extension action failure responses into `McpUserError` payloads when needed.

After the adapters exist, update each host surface:

1. CLI commands call the CLI adapter and keep current rendering, editor, git-staging, profile, landing, and `afterQueueId` behavior.
2. MCP `eforge_playbook` becomes a compatibility facade over `eforge-playbooks:*` actions and gains `copy` inputs.
3. MCP `eforge_session_plan` drops `create-from-playbook` entirely; planning playbooks now flow through `eforge_playbook { action: 'run' }` and eforge-plan metadata.
4. Pi command and tool surfaces use the Pi adapter, keep interactive landing/dependency prompts for autonomous playbooks, and keep planning-mode early return before landing/queue prompts.
5. Skills retain the conversational workflow but describe the extension boundary and replace direct route instructions with compatibility tool or generic contribution examples.
6. Tests assert both behavior and boundary removal from host sources.

### Key Decisions

1. **Invoke integration commands, not bare actions, from compatibility hosts.**
   - `eforge-playbooks` registers matching action and integration command IDs. Passing `kind: 'command'` records the host command context, avoids ambiguous generic resolution, and keeps compatibility surfaces aligned with extension-owned contribution semantics.

2. **Keep compatibility tools but remove playbook-specific session-plan actions.**
   - Users and skills already call `eforge_playbook`; keeping it preserves workflows while changing the implementation boundary. The session-plan `create-from-playbook` branch directly contradicts the new planning-mode handoff contract, so it is removed rather than reinterpreted as session-plan creation.

3. **Use local structural playbook types in host packages.**
   - `@eforge-build/client` no longer owns playbook wire types after boundary removal. CLI/Pi rendering code uses local JSON-shape guards and structural TypeScript types for action outputs instead of re-exported client playbook contracts.

4. **Preserve existing human workflow behavior around landing and queue dependencies.**
   - The extension action handles compilation/enqueue. The host still owns interactive prompts, `landingAction`/`landingAutoMerge` omission rules, fallback from stale `afterQueueId`, and user-facing confirmation messages.

5. **Render planning metadata defensively.**
   - Prefer `planningEntry.contributionId` from `eforge-playbooks`, accept `planningEntry.integrationCommandId` if present in older metadata, and always display the eforge-plan workstation URL when returned. Hosts never call session-plan creation helpers for planning playbooks.

6. **Make extension-unavailable errors actionable at the compatibility boundary.**
   - Unknown contribution, unavailable contribution, failed action invocation, and daemon-not-running states produce distinct messages. Unknown/unavailable extension messages include `eforge-playbooks`, install/trust/reload guidance, and the original generic contribution error text.

## Files

### Create
- `packages/eforge/src/cli/playbook-contributions.ts` — CLI/MCP helper with action ID constants, local structural playbook result types, `invokePlaybookContributionForHost()`, output unwrapping, undefined-field pruning, planning metadata helpers, and extension-unavailable error formatting.
- `packages/pi-eforge/extensions/eforge/playbook-contributions.ts` — Pi helper mirroring the CLI action ID constants and local structural types, with `invokePlaybookContributionIfRunning()` and output unwrapping for Pi command/tool callers.
- `test/playbook-host-contribution-migration.test.ts` — source/boundary regression tests for CLI/MCP/Pi host files: no direct playbook route/helper references, `eforge_playbook` tools include `copy`, session-plan tools omit `create-from-playbook`, and skills mention `eforge-playbooks` plus generic contribution fallback.

### Modify
- `packages/eforge/src/cli/playbook.ts` — replace `apiPlaybook*` imports/calls with `invokePlaybookContributionForHost(..., { host: 'cli' })`; pass extension action inputs for list/show/save/validate/run/promote/demote; preserve editor round trip, profile/postMerge preservation, git add after promote, `eforge play` alias, and current output text `[region: host-migration, replace direct client helper calls with playbook contribution helper]`.
- `packages/eforge/src/cli/display.ts` — replace the `PlaybookListEntry` client type import with the structural type exported by `playbook-contributions.ts`; keep table rendering unchanged.
- `packages/eforge/src/cli/mcp-proxy.ts` — bounded edit in the `eforge_playbook` tool to call the playbook contribution helper, add `copy` action plus `sourceScope`, `targetScope`, `overwrite`, `mode`, `profile`, and `includeShadowed` inputs, route action failures through `McpUserError`, and remove all `API_ROUTES.playbook*` references. Bounded edit in the `eforge_session_plan` tool to remove `create-from-playbook`, `playbook_name`, and direct `API_ROUTES.sessionPlanCreateFromPlaybook` usage while keeping other session-plan actions unchanged `[region: host-migration, bounded eforge_playbook facade and playbook-specific session-plan removal]`.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — replace `apiPlaybookListIfRunning`, `apiPlaybookRunIfRunning`, `apiPlaybookPromoteIfRunning`, and `apiPlaybookDemoteIfRunning` with the Pi playbook contribution helper; keep native menu, planning-mode early return, landing gate, queue dependency selection, stale-upstream fallback, promote/demote confirmation, and daemon-not-running overlays `[region: host-migration, replace direct playbook helpers with Pi contribution helper]`.
- `packages/pi-eforge/extensions/eforge/index.ts` — bounded edit in the `eforge_playbook` tool to call the Pi playbook contribution helper, add `copy` and action-specific inputs, update planning metadata rendering for `contributionId`, and remove `API_ROUTES.playbook*` references. Bounded edit in the `eforge_session_plan` tool to remove `create-from-playbook`, `playbook_name`, and direct `API_ROUTES.sessionPlanCreateFromPlaybook` usage while keeping other session-plan actions unchanged `[region: host-migration, bounded eforge_playbook tool facade and playbook-specific session-plan removal]`.
- `eforge-plugin/skills/playbook/playbook.md` — state that `eforge-playbooks` owns playbook management/run behavior; keep `mcp__eforge__eforge_playbook` as a compatibility tool that delegates to extension contributions; add generic contribution invocation examples for `eforge-playbooks:*`; replace direct `POST /api/playbook/copy` text with `mcp__eforge__eforge_playbook { action: "copy", ... }`; update planning metadata field names and extension-unavailable guidance `[region: host-migration, Claude playbook skill extension-owned tool guidance]`.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — mirror the Claude skill wording with Pi tool names (`eforge_playbook`, `eforge_extension_contribution`), replace direct copy route text with `eforge_playbook { action: "copy", ... }`, and keep planning-mode guidance in sync with Claude `[region: host-migration, Pi playbook skill parity guidance]`.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the patch version by one from the version present at implementation time because the Claude playbook skill changes `[region: host-migration, plugin patch version bump]`.
- `test/cli-playbook.test.ts` — replace `apiPlaybook*` mocks/assertions with `invokeEforgeExtensionContribution` mocks/assertions; assert every CLI subcommand invokes `kind: 'command'` with the expected `eforge-playbooks:*` id and input; keep existing editor, profile, planning-output, promote git-add, demote no-git-add, and `eforge play` alias assertions `[region: host-migration, update CLI compatibility tests to generic contribution invocation]`.
- `test/pi-playbook-commands.test.ts` — replace `apiPlaybook*IfRunning` mocks/assertions with `invokeEforgeExtensionContributionIfRunning` mocks/assertions; define local test playbook types; assert planning-mode run invokes `eforge-playbooks:run-playbook` before any landing/queue prompt and autonomous runs pass landing/afterQueueId fields through generic contribution input `[region: host-migration, update Pi command tests to generic contribution invocation]`.
- `test/skills-docs-wiring.test.ts` — add playbook skill parity assertions for `eforge-playbooks`, `copy` action usage, no direct `/api/playbook` text, no `create-from-playbook`, and unchanged Pi package version `[region: host-migration, playbook skill parity assertions]`.

## Implementation Details

### CLI/MCP helper contract

`packages/eforge/src/cli/playbook-contributions.ts` must define:

- `PLAYBOOK_EXTENSION_NAME = 'eforge-playbooks'`.
- `PLAYBOOK_CONTRIBUTION_IDS` mapping:
  - `list` → `eforge-playbooks:list-playbooks`
  - `show` → `eforge-playbooks:show-playbook`
  - `save` → `eforge-playbooks:save-playbook`
  - `validate` → `eforge-playbooks:validate-playbook`
  - `copy` → `eforge-playbooks:copy-playbook`
  - `promote` → `eforge-playbooks:promote-playbook`
  - `demote` → `eforge-playbooks:demote-playbook`
  - `run` → `eforge-playbooks:run-playbook`
- Local structural types for `PlaybookScope`, `PlaybookMode`, `PlaybookData`, `PlaybookListEntry`, `ListPlaybooksResult`, `ShowPlaybookResult`, `SavePlaybookResult`, `CopyPlaybookResult`, `PathResult`, and `RunPlaybookResult`.
- `invokePlaybookContributionForHost<T>(opts)` that calls `invokeEforgeExtensionContribution({ cwd, kind: 'command', id, input, requestedBy })`.
- `unwrapPlaybookContributionOutput<T>(result)` that returns `result.response.output as T` when `ok: true`, otherwise throws an error that includes `result.response.error.code`, `result.response.error.message`, and JSON details when present.
- `formatPlaybookContributionResolutionError(err)` that turns unknown contribution/unavailable extension errors into: `eforge-playbooks extension is unavailable. Install, trust, and reload eforge-playbooks, then retry. Original error: ...`.
- `planningContributionId(entry)` that returns `entry.contributionId`, `entry.integrationCommandId`, or `eforge-plan:open-planning-entry`.

### Pi helper contract

`packages/pi-eforge/extensions/eforge/playbook-contributions.ts` must define the same IDs and structural types. Its `invokePlaybookContributionIfRunning<T>(opts)` must:

- Call `invokeEforgeExtensionContributionIfRunning({ cwd, kind: 'command', id, input, requestedBy: { host: 'pi' } })`.
- Return `null` when the daemon is not running.
- Return the unwrapped output when `response.ok === true`.
- Throw an error with extension-unavailable guidance when the generic contribution cannot be resolved or returns a failure response.

### Action input mapping

Host compatibility layers must use these action inputs:

- `list`: `{ scope?, mode?, includeShadowed? }`.
- `show`: `{ name, scope? }`.
- `save`: `{ name, scope, playbook }` for nested structured saves; raw save variants are passed through only when the caller explicitly provides `raw`.
- `validate`: `{ raw, scope? }`.
- `copy`: `{ name, sourceScope?, targetScope, overwrite? }`.
- `promote`: `{ name }`.
- `demote`: `{ name }`.
- `run`: `{ name, scope?, mode?, profile?, afterQueueId?, landingAction?, landingAutoMerge? }`.

Before invocation, omit keys whose value is `undefined`. Do not rename `afterQueueId`, `landingAction`, or `landingAutoMerge`.

### MCP tool changes

For `eforge_playbook` in `packages/eforge/src/cli/mcp-proxy.ts`:

- Extend action enum to include `copy`.
- Keep existing action names for list/show/save/run/promote/demote/validate.
- Add optional fields: `sourceScope`, `targetScope`, `overwrite`, `mode`, `profile`, and `includeShadowed`.
- For each branch, validate required fields locally before invoking the extension.
- Convert extension action failure results to `McpUserError` so Claude receives a structured `isError` response.
- Keep landing flag validation for `run` and pass the resolved landing action into the extension input.
- Do not reference `API_ROUTES.playbook*`, direct route strings, or deleted client helper names.

For `eforge_session_plan` in `packages/eforge/src/cli/mcp-proxy.ts`:

- Remove `create-from-playbook` from the action enum and description.
- Remove `playbook_name` from the schema and handler destructuring.
- Keep `agent_profile` only as a generic optional field for `create`.
- Delete the final branch that posts to `API_ROUTES.sessionPlanCreateFromPlaybook`.
- Update the description to direct playbook users to `eforge_playbook { action: 'run' }` for planning playbook handoff metadata.

### Pi command/tool changes

For `packages/pi-eforge/extensions/eforge/playbook-commands.ts`:

- Replace all playbook list/run/promote/demote calls with the Pi helper.
- Keep `apiGetQueueIfRunning` for generic queue listing.
- Preserve planning-mode behavior: when list output marks the selected playbook as `planning`, call `run` immediately, show planning metadata/diagnostics, and return before landing or queue prompts.
- Preserve stale-upstream fallback by detecting `not found`/`404` in the helper-thrown error message and retrying `run` without `afterQueueId`.
- Render planning metadata using `planningEntry.contributionId` with fallback to `planningEntry.integrationCommandId`.

For `packages/pi-eforge/extensions/eforge/index.ts`:

- Register the `eforge_playbook` tool as the native Pi compatibility facade over `eforge-playbooks:*`.
- Add `copy`, `sourceScope`, `targetScope`, `overwrite`, `mode`, `profile`, and `includeShadowed` to the TypeBox schema.
- Return `jsonResult(output)` from the unwrapped extension action output.
- Update `renderResult` to handle copy output (`sourcePath`, `targetPath`, `targetScope`) and planning metadata with `contributionId`.
- Remove `create-from-playbook` from the native `eforge_session_plan` tool as described for MCP.

### Skill changes

Both playbook skills must:

- Add an early **Tool boundary** section stating that `eforge-playbooks` owns playbook behavior.
- State that `eforge_playbook`/`mcp__eforge__eforge_playbook` is a compatibility tool that delegates to `eforge-playbooks:*` generic extension contributions.
- Include a generic contribution example for at least `list-playbooks` and `run-playbook`.
- Replace `POST /api/playbook/copy` instructions with the compatibility `copy` action.
- Replace phrases like "returned by the daemon" for playbook action results with "returned by the extension action" or "returned by the playbook tool".
- Keep planning-mode instructions that use `eforge.plan.planning-mode-playbook`, `eforge-plan:open-planning-entry`, `eforge-plan:planning-workstation`, and `/console/workstations/eforge-plan%3Aplanning-workstation`.
- Avoid documenting direct `/api/playbook/*`, `apiPlaybook*`, or `create-from-playbook` paths.

## Testing Strategy

### Unit Tests
- CLI playbook tests:
  - Mock `invokeEforgeExtensionContribution` and assert `list`, `new`, `edit`, `run`, `promote`, `demote`, and `play` alias use `kind: 'command'`, `requestedBy: { host: 'cli' }`, and the expected `eforge-playbooks:*` id.
  - Assert `new` and `edit` send `save-playbook` input with `name`, `scope`, and nested `playbook` payload.
  - Assert `edit` calls `show-playbook`, `validate-playbook`, and `save-playbook` in that order and still exits without saving when validation output is `{ ok: false }`.
  - Assert `run` and `play` pass `afterQueueId` only when `--after` is supplied.
  - Assert planning `requires-agent` output prints `eforge-plan:open-planning-entry` and `/console/workstations/eforge-plan%3Aplanning-workstation`.
  - Assert an unavailable contribution response exits nonzero and prints `eforge-playbooks extension is unavailable`.

- Pi playbook command tests:
  - Mock `invokeEforgeExtensionContributionIfRunning` and assert menu/list/run/promote/demote flows call `eforge-playbooks:list-playbooks`, `run-playbook`, `promote-playbook`, and `demote-playbook` with `kind: 'command'` and `requestedBy: { host: 'pi' }`.
  - Assert planning-mode run invokes `run-playbook` before any landing gate or queue call.
  - Assert autonomous run preserves landing action, landing auto-merge, immediate enqueue, delayed enqueue, and stale-upstream fallback inputs.
  - Assert daemon-not-running (`null`) still displays `DAEMON_NOT_RUNNING_GUIDANCE`.
  - Assert extension failure responses display an overlay containing `eforge-playbooks` and the original contribution error message.

- Source boundary tests:
  - Assert host files contain no `apiPlaybook`, `API_ROUTES.playbook`, `/api/playbook`, `sessionPlanCreateFromPlaybook`, or `create-from-playbook` tokens.
  - Assert `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` contain `copy` in the `eforge_playbook` tool action schema.
  - Assert both session-plan tool descriptions no longer describe playbook seeding.
  - Assert both playbook skills mention `eforge-playbooks`, `eforge-playbooks:run-playbook`, `eforge-playbooks:copy-playbook`, and the host-specific generic contribution tool.

### Integration Tests
- Existing `eforge_playbook` MCP/Pi compatibility tests continue to exercise host input mapping without a live daemon by mocking generic contribution helpers.
- Existing extension contribution host-surface tests continue to pass, proving generic contribution listing/invocation remains available for fallback usage.
- The full type check validates that host files compile after `@eforge-build/client` no longer exports playbook-specific route types/helpers.

## Verification

- [ ] `rg -n "apiPlaybook|API_ROUTES\.playbook|/api/playbook|sessionPlanCreateFromPlaybook|create-from-playbook" packages/eforge/src/cli packages/pi-eforge/extensions/eforge eforge-plugin/skills/playbook packages/pi-eforge/skills/eforge-playbook --glob '!node_modules/**' --glob '!dist/**'` returns zero matches.
- [ ] `packages/eforge/src/cli/playbook.ts` imports `invokePlaybookContributionForHost` and does not import playbook-specific symbols from `@eforge-build/client`.
- [ ] `packages/eforge/src/cli/mcp-proxy.ts` registers `eforge_playbook` with a `copy` action and contains `eforge-playbooks:copy-playbook` or the shared contribution ID constant.
- [ ] `packages/pi-eforge/extensions/eforge/index.ts` registers `eforge_playbook` with a `copy` action and contains `eforge-playbooks:copy-playbook` or the shared contribution ID constant.
- [ ] `eforge_session_plan` in both MCP and Pi host files has no `create-from-playbook` action and no `playbook_name` parameter.
- [ ] CLI tests assert `eforge playbook run docs-sync --after q-abc` invokes `eforge-playbooks:run-playbook` with input `{ name: 'docs-sync', afterQueueId: 'q-abc' }`.
- [ ] Pi command tests assert a planning-mode playbook calls `eforge-playbooks:run-playbook` and makes zero queue-list calls.
- [ ] Pi command tests assert an autonomous playbook with explicit `landingAction` and `landingAutoMerge` sends both fields in the `run-playbook` contribution input.
- [ ] Claude and Pi playbook skills both contain `eforge-playbooks`, `eforge-playbooks:run-playbook`, `eforge-playbooks:copy-playbook`, and the eforge-plan workstation URL.
- [ ] Claude plugin version in `eforge-plugin/.claude-plugin/plugin.json` is greater than the pre-change version.
- [ ] `packages/pi-eforge/package.json` version equals its pre-change version.
- [ ] Targeted tests pass: `pnpm vitest run test/cli-playbook.test.ts test/pi-playbook-commands.test.ts test/playbook-host-contribution-migration.test.ts test/skills-docs-wiring.test.ts`.
- [ ] Host packages type-check: `pnpm --filter @eforge-build/eforge type-check` and `pnpm --filter @eforge-build/pi-eforge type-check` exit 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "docs"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
