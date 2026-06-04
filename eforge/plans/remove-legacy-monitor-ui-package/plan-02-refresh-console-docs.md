---
id: plan-02-refresh-console-docs
name: Refresh Console Documentation and Stale Monitor UI Comments
branch: remove-legacy-monitor-ui-package/plan-02-refresh-console-docs
---

# Refresh Console Documentation and Stale Monitor UI Comments

## Architecture Context

After the code removal, Console is the canonical local-first control surface served by the monitor daemon at `/console/`, with root UI requests redirected there. The engine remains headless and daemon HTTP/SSE terminology remains unchanged. This plan updates active documentation, generated docs, agent guidance, and source comments so they no longer describe `packages/monitor-ui/` as retained or active.

## Implementation

### Overview

Replace stale legacy-dashboard language with Console-first wording. Keep daemon/server terminology such as `monitor.db`, `MonitorServer`, monitor daemon, and monitor URL when those terms refer to the daemon or local HTTP server rather than the deleted UI package. Do not rewrite historical fixture strings in tests or long API version history comments unless they create active dependency or user-facing guidance.

### Key Decisions

1. User-facing docs name Console as the dashboard and keep `/console/` as the canonical URL. If docs mention the daemon root, they describe the root redirect to Console rather than a legacy dashboard at `/`.
2. Agent-facing guidance in `AGENTS.md` is updated because retaining instructions for a deleted package can mislead future changes.
3. `scripts/publish-all.mjs` keeps generic private-package wording and must not imply Console is published directly or that monitor-ui is still skipped.
4. Generated `web/public/docs/*` files are updated alongside `web/content/docs/*` when docs generation reports drift.

## Scope

### In Scope

- Update active docs that state monitor-ui is retained or served at `/`.
- Update Console README and source comments that describe dual reducer sync, monitor-ui ports, or legacy Monitor links.
- Update generated web docs if `pnpm docs:check` reports drift.
- Update script comments that list monitor-ui as a private package skipped during publishing.
- Keep historical test fixtures and daemon API version history comments when they are not active guidance.

### Out of Scope

- Renaming monitor daemon/server/database terminology.
- Changing Console routes or adding UI features.
- Changing publish lockstep behavior to publish Console directly.
- Removing historical `monitor-ui` text from PRD validation fixture bodies.
- Editing `packages/client/src/api-version-const.ts` version-history text unless a non-historical active reference is added there.

## Files

### Create

None.

### Modify

- `AGENTS.md` — remove guidance for `packages/monitor-ui`; list `packages/console-ui/` as the active dashboard package and remove it from any workspace package list wording that still includes monitor-ui.
- `README.md` — replace the statement that the legacy monitor dashboard remains at `/` with Console canonical URL and root redirect wording.
- `docs/architecture.md` — update the monitor/daemon section to describe a single Console SPA served at `/console/` with root UI redirects; update references that say monitor-ui dispatches route constants; update dashboard panel wording from legacy monitor UI to Console where applicable.
- `docs/llm-friendly-code.md` — remove `packages/monitor-ui/src/lib/api.ts` from browser bundle guidance and keep `packages/console-ui/src` as the browser bundle example.
- `packages/console-ui/README.md` — state that Console replaces the deleted legacy package; remove retained/transition wording; remove the dual-reducer section; remove the Monitor back-link example from control-surface guidance.
- `packages/console-ui/vitest.config.ts` — update the alias comment so it only describes the package-local Console alias.
- `packages/console-ui/src/lib/run-state/reducer.ts` — remove dual-reducer and future-deletion comments; describe this reducer as Console-owned.
- `packages/console-ui/src/lib/run-state/index.ts` — remove dual-reducer synchronization comments.
- `packages/console-ui/src/lib/run-state/format.ts` — remove comments that say helpers were left in monitor-ui.
- `packages/console-ui/src/lib/run-state/decision-format.ts` — remove comments that say helpers were left in monitor-ui.
- `packages/console-ui/src/lib/run-state/selectors/stack-layers.ts` — replace ported-from monitor-ui wording with Console-owned selector wording.
- `packages/console-ui/src/lib/run-state/selectors/summary-stats.ts` — replace monitor-ui reducer references with Console run-state references.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — remove dual-reducer sync comments and update the `build:terminal-failure` rendering note to Console terminology.
- `packages/console-ui/src/lib/run-state/handlers/handle-agent.ts` — replace wording that says the monitor UI expects camelCase with Console/run-state terminology.
- `packages/console-ui/src/components/console/plan-tab.tsx` — remove the comment that mirrors `monitor-ui/sidebar.tsx`.
- `packages/console-ui/src/components/ui/sheet-panel.tsx` — remove legacy monitor-ui API wording.
- `packages/console-ui/src/components/recovery/safe-markdown.tsx` — replace legacy Monitor sidecar wording with current Console recovery-dialog wording.
- `packages/client/src/event-registry.ts` — replace comments that inline logic from `packages/monitor-ui` or say `DaemonState` is satisfied by monitor-ui with Console/projector-neutral wording.
- `scripts/publish-all.mjs` — change private-package skip comments to generic wording or accurate private package names that exclude monitor-ui; do not add Console to lockstep publishing.
- `web/content/docs/integrations.md` — rename the `Monitor UI` section and copy to Console/dashboard terminology; keep daemon HTTP API descriptions intact.
- `web/content/docs/glossary.md` — update the dashboard glossary entry and link anchor from Monitor UI to Console dashboard.
- `web/public/docs/integrations.md` — update generated/tracked docs to match content docs or regenerate after source edits.
- `web/public/docs/glossary.md` — update generated/tracked docs to match content docs or regenerate after source edits.

## Verification

- [ ] `packages/console-ui/README.md` contains no retained-port or dual-reducer wording for `packages/monitor-ui`.
- [ ] `README.md` contains no statement that a legacy dashboard is served at `/`.
- [ ] `scripts/publish-all.mjs` contains zero `monitor-ui` matches.
- [ ] `rg -n "monitor-ui|packages/monitor-ui|@eforge-build/monitor-ui|legacy monitor|legacy dashboard|Monitor back-link|dual-reducer" README.md AGENTS.md docs scripts packages/console-ui packages/client/src/event-registry.ts web/content web/public --glob '!node_modules/**' --glob '!dist/**'` exits 1.
- [ ] `rg -n "@eforge-build/monitor-ui|packages/monitor-ui" package.json packages docs README.md scripts test tsconfig*.json vitest*.config.ts web/content web/public --glob '!node_modules/**' --glob '!dist/**'` has no matches outside historical test fixture text intentionally left in `test/prd-*` files.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
