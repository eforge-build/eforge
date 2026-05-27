---
id: plan-02-client-surfaces-and-console
name: Client Surfaces and Console Stack Sync Visibility
branch: add-engine-owned-daemon-scoped-on-demand-stack-sync/plan-02-client-surfaces-and-console
agents:
  builder:
    effort: high
    rationale: Updates span CLI/MCP/Pi/console UX and must stay synchronized with
      shared route/event types without reintroducing unsafe local sync patterns.
  reviewer:
    effort: high
    rationale: Review must verify consumer-facing safety semantics, Pi/Claude
      parity, and console route discipline.
---

# Client Surfaces and Console Stack Sync Visibility

## Architecture Context

Plan 01 adds the daemon-owned stack sync contract and durable status. This plan updates first-party consumers to use the new contract consistently and gives the console a visible on-demand stack sync control plus status rendering.

Pi and Claude Code integrations must stay in sync. Do not bump the Pi package version. If plugin files change, bump `eforge-plugin/.claude-plugin/plugin.json` in the docs plan.

## Implementation

### Overview

Update CLI/MCP/Pi rendering and tool request bodies to pass trigger metadata, display `deferred` and conflict/failure diagnostics, and avoid presenting post-merge shell sync as the automatic workflow. Add console state, selectors, and components for durable stack sync status and manual trigger controls using the shared daemon API route constants.

### Key Decisions

1. Console is the primary UI target for this slice. Monitor UI may remain read-only for stack layers unless a small shared rendering update is low-risk.
2. Manual console sync calls `POST /api/stack/sync` with `trigger: "manual"`; retry buttons call the same route with `trigger: "retry-deferred"`.
3. Console state is seeded from `stream:hello.stackSync` and updated by stack sync lifecycle events from the shared event registry, not by ad hoc response-only state.
4. Workflow wizard "automatic stack sync" maps to daemon-owned `stacking.sync.afterBuild: true`, never to `build.postMergeCommands: ["eforge stack sync"]`.

## Scope

### In Scope

- Update CLI stack sync output for `syncId`, `trigger`, `activeBuildPolicy`, `startedAt`, `completedAt`, `deferred`, active-build skips, provider commands, and sanitized errors.
- Update MCP tool schema/description and handler to send `trigger: "manual"` by default and expose optional `activeBuildPolicy` if useful.
- Update Pi `eforge_stack_sync` tool and `/eforge:stack:sync` command rendering for `deferred`, retry guidance, status metadata, and provider command diagnostics.
- Update Pi workflow wizard and pure helpers so automatic stack sync config writes `stacking.sync.afterBuild: true` rather than `build.postMergeCommands: ["eforge stack sync"]`.
- Add console project state field(s) for stack sync status and update reducer snapshot/event handling.
- Add console selector model for last/current stack sync outcome, active-build skips, provider command summaries, conflict/failure reason, and retry availability.
- Add a console stack sync status/control component on the Now dashboard near existing stack layer summary.
- Add manual sync, dry-run, and retry-deferred buttons that call shared API route constants and render in-progress/error state.
- Add/adjust tests for CLI rendering, Pi formatter, workflow helper deltas, console reducer/selectors/components, and API route compliance.

### Out of Scope

- Periodic sync controls.
- Queue priority/back-burner UI.
- Auto-resolving restack conflicts.
- Changing plugin skill markdown; docs/plugin changes are in Plan 03.

## Files

### Create

- `packages/console-ui/src/components/now/stack-sync-status-card.tsx` — render last/current sync status, active-build skips, provider commands, and manual/dry-run/retry controls.
- `packages/console-ui/src/lib/stack-sync-api.ts` or equivalent colocated helper — browser POST helper using `API_ROUTES.stackSync` and shared request/response types.

### Modify

- `packages/eforge/src/cli/index.ts` — update report rendering and default body to include `trigger: "manual"`; keep the no-wet-local-fallback behavior from Plan 01.
- `packages/eforge/src/cli/mcp-proxy.ts` — update `eforge_stack_sync` tool schema/description and body fields.
- `packages/pi-eforge/extensions/eforge/stack-sync-command.ts` — render new fields and deferred/retry guidance.
- `packages/pi-eforge/extensions/eforge/index.ts` — update Pi tool schema/description and request body.
- `packages/pi-eforge/extensions/eforge/workflow-wizard-helpers.ts` — replace auto-sync preset delta with `stacking.sync.afterBuild: true`; update summary logic.
- `packages/pi-eforge/extensions/eforge/workflow-wizard.ts` — change auto-sync option text from shell post-merge command to daemon-owned after-build sync.
- `packages/console-ui/src/lib/project-state.ts` — add `stackSync` to state, snapshot seeding, event projection input/output, and initial state.
- `packages/console-ui/src/lib/selectors/now.ts` — add stack sync summary model and retry/manual action eligibility.
- `packages/console-ui/src/views/now-dashboard.tsx` — render the new status/control card.
- `packages/console-ui/src/components/now/stack-summary-card.tsx` — optionally link the layer summary to sync status if colocating controls there.
- `packages/console-ui/src/lib/types.ts` — add UI-specific stack sync view model types if needed.
- `packages/monitor-ui/src/lib/daemon-reducer.ts` — if Plan 01 added optional stack sync projection, mirror the state field for legacy monitor UI compatibility.
- `test/pi-workflow-wizard-helpers.test.ts` — update automatic preset assertions away from post-merge commands and toward `stacking.sync.afterBuild`.
- `packages/console-ui/src/__tests__/project-state.test.ts` — cover snapshot/event stack sync state updates.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — cover status summaries for complete, deferred, conflict, and failed outcomes.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — cover rendering status, active-build skips, provider commands, and trigger buttons.
- `packages/console-ui/src/__tests__/guards.test.ts` — keep route-compliance passing with no hard-coded `/api/` strings.
- Add or update CLI/Pi formatter tests if existing coverage is absent.

## Verification

- [ ] CLI renders `deferred` as retryable and exits 0 for active-build deferrals.
- [ ] CLI renders `failed` and `conflict` with non-zero exit behavior and sanitized provider command diagnostics.
- [ ] MCP `eforge_stack_sync` sends the shared daemon route request with trigger metadata.
- [ ] Pi `eforge_stack_sync` and `/eforge:stack:sync` display active-build skips, provider commands, failure/conflict reason, and retry guidance.
- [ ] Pi workflow helper for `stacked-pr-autosync` returns a delta containing `stacking.sync.afterBuild: true` and no `build.postMergeCommands` entry for `eforge stack sync`.
- [ ] Console snapshot seeding stores stack sync status from `stream:hello` data.
- [ ] Console event projection updates stack sync status after a stack sync lifecycle event.
- [ ] Console renders last sync outcome, active-build skips, provider command list, and conflict/failure reason from shared wire data.
- [ ] Console manual, dry-run, and retry buttons call `API_ROUTES.stackSync` with the expected JSON body.
- [ ] Console tests contain no hard-coded `/api/` route literals.
