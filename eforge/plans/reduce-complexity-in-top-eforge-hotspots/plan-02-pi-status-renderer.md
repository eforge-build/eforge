---
id: plan-02-pi-status-renderer
name: Decompose Pi Status Tool Rendering
branch: reduce-complexity-in-top-eforge-hotspots/plan-02-pi-status-renderer
agents:
  builder:
    effort: high
    rationale: The target is a dense user-facing renderer inside an oversized
      extension entrypoint; output text, icons, colors, and fallback behavior
      must be preserved.
  reviewer:
    effort: high
    rationale: Review must verify the status render text semantics and
      daemon-not-running/version metadata behavior remain unchanged.
---

# Decompose Pi Status Tool Rendering

## Architecture Context

`packages/pi-eforge/extensions/eforge/index.ts` registers native Pi tools that talk to the daemon through `@eforge-build/client`. The `eforge_status` tool must stay passive: it checks an already-running daemon, reports version metadata, returns idle JSON when no active sessions exist, and renders tool results with Pi `Text` nodes.

This plan is limited to the `eforge_status` tool `renderResult` hotspot. Tool registration, API routes, request helpers, daemon-not-running guidance, and version-mismatch metadata remain unchanged.

## Implementation

### Overview

Extract typed, local status-rendering helpers from the `eforge_status` `renderResult` callback. Keep `renderResult` as a thin parse/fallback wrapper that delegates to helpers for idle, single-build, multi-build, expanded-runs, plans, activity, and event-count rendering.

### Key Decisions

1. Keep the registered tool name `eforge_status` and `parameters: Type.Object({})` unchanged.
2. Keep the `execute` implementation's `API_ROUTES.version`, `apiGetRunningSessionSummariesIfRunning`, daemon-not-running behavior, and version object construction unchanged.
3. Preserve parse fallback semantics: JSON parse failures return muted raw text when the first content item is text, otherwise muted `Parse error`.
4. Define local renderer-only types for the parsed status payload. Do not introduce daemon wire-shape interfaces outside `@eforge-build/client` for API contracts.
5. Use table-driven status style helpers for icon/color mapping rather than nested ternaries.

### Refactor Shape

Add private helpers near the status tool registration or in the existing helper section:

- `type StatusToolPayload` for parsed JSON fields used by the renderer.
- `type StatusBuild`, `type StatusPlan`, and `type StatusRun` for local renderer payload fields.
- `statusStyle(status)` returning the existing icon/color pairs:
  - `completed` → `✓` / `success`
  - `running` → `⟳` / `warning`
  - `failed` → `✗` / `error`
  - unknown build status → `?` / `muted`
  - unknown plan/run status → `○` / `muted` where the current renderer uses `○`.
- `renderStatusPayload(data, expanded, theme): Text` for idle/no-build routing.
- `renderSingleBuildStatus(build, expanded, theme): string[]`.
- `renderMultiBuildStatus(builds, theme): string[]`.
- `appendActivityLine`, `appendPlansProgress`, `appendPlanRows`, `appendEventCounts`, and `appendExpandedRuns` as small focused helpers.
- `renderStatusParseFallback(result, theme): Text` to preserve the catch block behavior.

`renderResult` must retain the same control flow shape at the boundary:

```ts
renderResult(result, { expanded }, theme) {
  try {
    const text = result.content[0];
    if (!text || text.type !== "text") return new Text(theme.fg("muted", "No data"), 0, 0);
    return renderStatusPayload(JSON.parse(text.text) as StatusToolPayload, expanded, theme);
  } catch {
    return renderStatusParseFallback(result, theme);
  }
}
```

The exact helper names may vary, but no named helper extracted from `renderResult` may exceed Cognitive Complexity 30.

## Scope

### In Scope

- Modify `packages/pi-eforge/extensions/eforge/index.ts`.
- Refactor only the `eforge_status` rendering block around `renderResult` plus private renderer helpers.
- Keep idle, no-build, single-build, multi-build, expanded-runs, event-count, and parse-fallback output structures unchanged.
- Reuse existing `Text` and `formatDuration` imports.

### Out of Scope

- Tool name changes.
- Parameter schema changes.
- Daemon startup changes.
- Version metadata changes.
- API route changes.
- New dependencies.
- Changes to `eforge-plugin/`; this is a no-behavior Pi renderer refactor.

## Files

### Create

- None.

### Modify

- `packages/pi-eforge/extensions/eforge/index.ts` — extract local typed helpers from the `eforge_status` `renderResult` callback.

## Verification

- [ ] The `eforge_status` tool registration still uses `name: "eforge_status"`.
- [ ] The `eforge_status` parameter schema remains `Type.Object({})`.
- [ ] `renderResult` has Cognitive Complexity ≤30.
- [ ] Every named helper extracted from `renderResult` has Cognitive Complexity ≤30.
- [ ] Idle and empty-build render paths still return muted `⊘ No active sessions`.
- [ ] The single-build renderer keeps the same header, running activity line, plan progress, plan rows, event counts, and expanded runs sections.
- [ ] The multi-build renderer keeps the same summary header, per-build command/session/activity/plans/errors lines, and blank-line layout.
- [ ] The parse fallback still returns muted raw text for text content and muted `Parse error` otherwise.
- [ ] `API_ROUTES.version`, `apiGetRunningSessionSummariesIfRunning`, `DAEMON_NOT_RUNNING_GUIDANCE`, and version mismatch text are unchanged.
- [ ] `test/pi-ambient-status-no-start.test.ts` passes as part of `pnpm test`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm complexity:scan` no longer reports the original high-CC `packages/pi-eforge/extensions/eforge/index.ts:443` `eforge_status` `renderResult` entry.