---
title: Polish Console UI State, Branding, Density, Naming, and Theme Tokens
created: 2026-05-26
landing_auto_merge: true
---

# Polish Console UI State, Branding, Density, Naming, and Theme Tokens

## Problem / Motivation

The new `/console/` SPA in `packages/console-ui/`, shipped by `2026-05-25-console-ui-phase-1.md`, builds, type-checks, ships, and is reachable at `/console/`, but it falls short of the intended replacement bar for the legacy `/` monitor UI.

Evidence was gathered from a live UI tour at `http://localhost:4567/console/{,/queue,/runs,/system,/activity}` using browser automation against the running daemon, pid `24796`, plus direct source reads.

Key gaps and issues include:

- `packages/console-ui/src/lib/brand.ts:7` uses the wrong GitHub avatar, `https://avatars.githubusercontent.com/u/175493085?s=48&v=4`.
- The canonical eforge avatar used by `web/app/layout.tsx:21` and `.eforge/tmp/monitor-v2-wireframe-opus.html` is `https://avatars.githubusercontent.com/u/272340669?v=4`.
- `packages/console-ui/src/globals.css:71-82` references `'Inter'` and `'JetBrains Mono'` without bundling fonts or documenting fallback behavior.
- The UI violates phase-1 Design Decision #13 by favoring visual density over operational clarity.
- One failed PRD can appear in Attention multiple times, Queue snapshot, Recent Runs, and Stack summary.
- System eagerly renders 947 PI model rows as a flat `<li>` list.
- Activity renders raw JSON disclosure on every row.
- Connection, queue, active-build, and auto-build status appear redundantly in the sidebar, footer strip, and Now dashboard.
- Runs lacks filters, grouping, normalized PRD naming, and proper pluralization.
- Theme colors bypass CSS tokens through hex literals.
- Typography uses ad hoc sizes including `text-[10px]`, which is at the edge of legibility.
- Console must preserve existing guardrails from `AGENTS.md` and `CLAUDE.md`, including shadcn/ui usage, no inline `/api/...` literals, no `@eforge-build/engine` imports from UI, and daemon wire shapes owned by `@eforge-build/client`.

## Goal

Polish `packages/console-ui/` so Console is calmer, less redundant, more consistent, and closer to being the canonical UI, while preserving the `/console/` route, the legacy monitor at `/`, and existing daemon/client boundaries.

The outcome should fix the phase-1 logo and font gaps, deduplicate cross-page state, normalize PRD naming, reduce dense page surfaces, add progressive disclosure, and enforce theme-token and typography discipline.

## Approach

### Implementation profile

Recommended profile: **Excursion**.

Rationale: the work is cross-cutting across selectors, shell, five page views, theme tokens, and tests, but cohesive. A single planner session can enumerate every plan, every file change, and every dependency relationship from the design decisions.

Planned sequence:

- Plan A: assets, fonts, and tokens.
- Plan B: selectors and helpers.
- Plan C: shell and Now reorganization.
- Plan D: Runs filters and grouping.
- Plan E: System and Activity progressive disclosure.

Expedition is rejected because there are no genuinely independent modules requiring separate planners, and the shared selector foundation means one planner can sequence the work coherently.

Errand is rejected because the work edits roughly 25 files and adds roughly 10 selector/test files.

### Key technical decisions

- Vendor the eforge logo locally as `packages/console-ui/public/eforge-logo.svg` or `.png`, and point `EFORGE_LOGO_URL` at the bundled path, preferably `/console/eforge-logo.svg`.
- Bundle Inter and JetBrains Mono via `@fontsource/inter` and `@fontsource/jetbrains-mono` or `@fontsource-variable/jetbrains-mono`.
- Make `StatusStrip` the canonical always-visible status surface.
- Keep only a minimal sidebar connection dot, hiding the `Connected` label when connected.
- Remove the Now dashboard 9-card metric row.
- Move subscribers, uptime, and scheduler limit to `/console/system` under the Daemon section.
- Deduplicate `selectNowAttentionItems` at the selector layer using one item per underlying `prdId` or `sessionId`.
- Introduce `selectPrdDisplayLabel` in `lib/selectors/labels.ts`.
- Reject markdown-body-shaped title values in label selection.
- Normalize slug-derived PRD labels to title case, with acronym preservation for values like `PRD`, `UI`, `MCP`, `CLI`, and `API`.
- Coalesce enqueue and build runs into one PRD-level group in `selectRunGroups` when their planSet slugs match and started-at timestamps are within five minutes.
- Use `pluralize(n, singular, plural?)` from `lib/format.ts`.
- Keep Queue status groups and drop the Queue Attention section.
- Render recovery verdict and confidence as chips on failed queue rows.
- Add Runs filters, day grouping, PRD-level rows, and compact row metadata.
- Collapse System models into one `<details>` block per provider.
- Move Activity raw JSON to a slide-over panel or modal.
- Hide Activity `family:` and `scope:` labels by default.
- Consolidate Activity filters to one family-chip row and one search box.
- Replace literal color utilities with theme tokens.
- Add a source-grep vitest guard for hex color classes and `text-[Npx]`.
- Collapse typography to `text-base`, `text-sm`, and `text-xs`.
- Use parent `space-y-*` for vertical rhythm instead of child `mb-*`.
- Keep dedup, naming normalization, grouping, and label resolution inside `lib/selectors/`.

### Code impact

Changed or new files include:

- `packages/console-ui/src/lib/brand.ts`
- `packages/console-ui/public/eforge-logo.svg`
- `packages/console-ui/src/main.tsx`
- `packages/console-ui/package.json`
- `packages/console-ui/src/lib/selectors/labels.ts`
- `packages/console-ui/src/lib/selectors/now.ts`
- `packages/console-ui/src/lib/selectors/queue.ts`
- `packages/console-ui/src/lib/selectors/runs.ts`
- `packages/console-ui/src/lib/selectors/activity.ts`
- `packages/console-ui/src/lib/format.ts`
- `packages/console-ui/src/components/shell/status-strip.tsx`
- `packages/console-ui/src/components/shell/sidebar.tsx`
- `packages/console-ui/src/components/now/now-status-overview.tsx`
- `packages/console-ui/src/views/now-dashboard.tsx`
- `packages/console-ui/src/components/now/active-builds-grid.tsx`
- `packages/console-ui/src/components/now/recent-runs-card.tsx`
- `packages/console-ui/src/components/now/queue-snapshot-card.tsx`
- `packages/console-ui/src/components/now/attention-panel.tsx`
- `packages/console-ui/src/components/now/recent-activity-card.tsx`
- `packages/console-ui/src/components/now/stack-summary-card.tsx`
- `packages/console-ui/src/components/now/active-build-card.tsx`
- `packages/console-ui/src/components/now/now-state-banner.tsx`
- `packages/console-ui/src/views/queue/queue-view.tsx`
- `packages/console-ui/src/views/queue/queue-summary-cards.tsx`
- `packages/console-ui/src/views/queue/queue-item-row.tsx`
- `packages/console-ui/src/views/runs/runs-view.tsx`
- `packages/console-ui/src/views/runs/runs-filter-bar.tsx`
- `packages/console-ui/src/views/runs/runs-day-groups.tsx`
- `packages/console-ui/src/views/runs/run-history-table.tsx`
- `packages/console-ui/src/views/runs/run-detail-panel.tsx`
- `packages/console-ui/src/views/system/models-section.tsx`
- `packages/console-ui/src/views/system/daemon-section.tsx`
- `packages/console-ui/src/views/activity/activity-toolbar.tsx`
- `packages/console-ui/src/views/activity/activity-event-row.tsx`
- `packages/console-ui/src/views/activity/activity-event-list.tsx`
- `packages/console-ui/src/views/activity/raw-event-panel.tsx`
- `packages/console-ui/src/views/activity/activity-view.tsx`
- `packages/console-ui/src/components/ui/sheet.tsx`
- `packages/console-ui/src/globals.css`
- `packages/console-ui/src/__tests__/now-selectors.test.ts`
- `packages/console-ui/src/__tests__/runs-selectors.test.ts`
- `packages/console-ui/src/__tests__/labels.test.ts`
- `packages/console-ui/src/__tests__/queue-view.test.tsx`
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx`
- `packages/console-ui/src/__tests__/runs-view.test.tsx`
- `packages/console-ui/src/__tests__/activity-view.test.tsx`
- `packages/console-ui/src/__tests__/theme-token-discipline.test.ts`
- `packages/console-ui/src/__tests__/console-shell.test.tsx`
- `packages/console-ui/src/__tests__/system-view.test.tsx`

### Dependency relationships

- `selectPrdDisplayLabel` must be implemented before updating `now.ts`, `queue.ts`, `runs.ts`, and `activity.ts`.
- `selectNowStatusSummary` already exists and should be consumed by `status-strip.tsx`.
- Removing `now-status-overview.tsx` requires updating `now-dashboard.tsx` imports.
- `sheet.tsx` is needed only if the shadcn Sheet primitive is not already present.
- Vite `base: '/console/'` must continue to scope assets correctly.
- `public/eforge-logo.svg` should resolve to `/console/eforge-logo.svg` after build.

### Risks and mitigations

- Selector dedup may mask upstream daemon bugs; mitigate with tests and developer notes, and open a follow-up PRD for the daemon-side planSet/title source fix.
- Removing the Now metric row may surprise users; mitigate by preserving at-a-glance status in the footer and moving telemetry to System.
- Adding shadcn Sheet may add Radix Dialog and increase bundle size; mitigate by checking existing dependencies and documenting bundle-size delta.
- Bundled fonts add `woff2` assets to `dist/`; mitigate by importing only used weights.
- Day grouping in Runs depends on local timestamps; mitigate with a pure `bucketByDay(groups, now)` helper and fixed timestamps in tests.
- Enqueue/build coalescing could produce wrong rollup status; mitigate with deterministic rules and unit tests.
- Coalescing depends on planSet equality; mitigate by slugifying both sides and testing title-vs-slug pairs.
- Theme-token guard may be too strict; mitigate with an explicit allowlist that starts empty.
- Hiding the sidebar `Connected` label may reduce discoverability; mitigate with `aria-label` on the dot and text in the footer strip.
- Removing Activity `Attention only` may affect a user; mitigation is that family chips plus search reproduce the behavior, with follow-up restoration possible.
- PRD scope is large; mitigate with sequenced plans that leave Console visually working after each step.
- New label lookups add string operations; mitigate by relying on existing selector memoization patterns.
- Vendor logo asset licensing must be confirmed; fallback is correcting the URL only.
- Removing exports may break consumers; mitigate by grepping before deletion and deprecating `selectQueueAttentionItems` if needed.

### Assumptions and validation

- The canonical eforge avatar is `https://avatars.githubusercontent.com/u/272340669?v=4`.
- Avatar `175493085` is wrong.
- This was validated by grepping `avatars.githubusercontent` across `packages/` and `web/`.
- A suitable eforge SVG or PNG can be vendored under `packages/console-ui/public/eforge-logo.svg`.
- If no usable asset is available, the fallback is fixing only the URL.
- `@fontsource/inter` and JetBrains Mono packages work cleanly with Vite and emit self-hosted `woff2` files.
- Selector-layer dedup is the right architectural boundary.
- `selectQueueAttentionItems` should be revalidated by grep before deletion or deprecation.
- Enqueue and build runs for the same PRD share a planSet.
- The two runs for a single PRD normally start within five minutes.
- Markdown-shaped title detection should catch values starting with `#`, containing newlines, or exceeding the length threshold without rejecting legitimate titles.
- Subscribers, uptime, and scheduler-limit fields can move to `/console/system`.
- Removing the Now metric row does not violate phase-1 acceptance criteria.
- Day grouping must accept a `now` parameter to avoid test flakiness.
- shadcn Sheet is currently absent from `components/ui/`.
- Adding Sheet and Radix Dialog is acceptable unless bundle-size inspection proves otherwise.
- A single `RunDetailPanel` instance with responsive Tailwind classes can replace the current dual-instance pattern.
- PRD-level coalescing in `selectRunGroups` should not affect `selectActiveSessionIds`.
- Removing Activity `Attention only` was user-confirmed during planning.
- Bundled font size is acceptable for a developer console served on localhost.
- The eforge organization owns the logo image and intends to bundle it.
- Plan boundaries A through E are expected to leave Console visually working after each plan.

## Scope

### In scope

- All cleanup is scoped to `packages/console-ui/` and directly coupled assets.
- Replace the wrong GitHub avatar with the canonical avatar or a vendored local logo asset.
- Prefer vendoring `packages/console-ui/public/eforge-logo.svg` or `.png`.
- Add bundled Inter and JetBrains Mono fonts through `@fontsource/*`.
- Deduplicate `selectNowAttentionItems`.
- Normalize PRD display labels across Now, Queue, Runs, and Activity selectors.
- Coalesce enqueue and build runs in `selectRunGroups`.
- Fix runs pluralization.
- Make the footer `StatusStrip` the single always-visible status surface.
- Hide the sidebar `Connected` text when connected.
- Remove the Now dashboard 9-card metric row.
- Move daemon telemetry to `/console/system`.
- Replace hex color utilities with theme-token utilities.
- Move Activity family colors to CSS variables or shadcn Badge variants.
- Add a vitest source-grep guard for theme-token discipline.
- Document and enforce a typography ladder.
- Remove `text-[10px]`.
- Drop the Now metric row.
- Hide the Active Builds heading when there are zero active builds.
- Use `space-y-4` vertical rhythm at page roots.
- Remove the Queue Attention section.
- Keep Queue status groups.
- Reduce Queue summary cards to Total, Running, Pending, and Failed.
- Add Runs status filters, command filters, text search, and day grouping.
- Hide repeated `cwd` on Runs rows.
- Move profile to the Runs detail panel.
- Truncate session UUIDs via `truncateId`.
- Remove extra `p-4` from Runs.
- Remove the RunsHeader Card wrapper.
- Replace dual `RunDetailPanel` rendering with one responsive instance.
- Collapse System models by provider using `<details>`.
- Add model search.
- Simplify Activity filters.
- Move Activity raw JSON to a side panel or modal.
- Hide Activity `family:` and `scope:` labels by default.
- Preserve shadcn/ui usage.
- Preserve `@eforge-build/client/browser` as the source for daemon/client data.
- Preserve no inline `/api/...` literals.
- Preserve no `@eforge-build/engine` imports from UI.

### Out of scope

- Migrating Console to `/` as the default.
- Removing `packages/monitor-ui`.
- Adding queue editing or priority controls.
- Adding stack-sync controls.
- Adding Overseer-style multi-project navigation.
- Fixing the upstream daemon bug where markdown body leaks into the `planSet` field.
- Full Runs detail parity with the legacy monitor.
- Re-skinning shadcn primitives in `components/ui/{badge,button,card}.tsx`.
- Adding new daemon routes.
- Adding new client wire types.
- Internationalization.
- Accessibility audits beyond avoiding regressions and explicitly fixing the duplicate RunDetailPanel tree issue.
- RTL support.
- Migrating `@eforge-build/monitor-ui` to the same token, font, or lint hygiene.

### Roadmap relation

- This aligns with the implicit trajectory that Console becomes the canonical UI.
- This closes acceptance-criteria gaps and visual debt before any cutover decision.
- This does not touch Overseer, multi-project observability, or stack-sync roadmap items.
- `docs/roadmap.md` has no Console-specific item.
- Queue-reorder controls remain a future web UI capability and are not part of this cleanup.
- The legacy monitor link to Console at `packages/monitor-ui/src/components/layout/header.tsx:99-102` must remain.

## Acceptance Criteria

- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- `pnpm --filter @eforge-build/console-ui build` exits 0.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- `pnpm --filter @eforge-build/monitor type-check` exits 0 after the Console build artifacts change.
- `packages/console-ui/public/eforge-logo.svg` exists in the repository and is referenced by `EFORGE_LOGO_URL` in `packages/console-ui/src/lib/brand.ts`.
- `EFORGE_LOGO_URL` in `packages/console-ui/src/lib/brand.ts` does not contain the string `avatars.githubusercontent.com`.
- Running the Console at `/console/` renders the vendored eforge logo at the sidebar branding location without making a network request to `avatars.githubusercontent.com`.
- `packages/console-ui/package.json` declares `@fontsource/inter` as a dependency.
- `packages/console-ui/package.json` declares a JetBrains Mono package as a dependency, using either `@fontsource/jetbrains-mono` or `@fontsource-variable/jetbrains-mono`.
- `packages/console-ui/src/main.tsx` imports at least one Inter weight via `@fontsource/inter/*.css`.
- `packages/console-ui/src/main.tsx` imports at least one JetBrains Mono weight via the chosen JetBrains Mono package.
- `packages/console-ui/dist/` after build contains self-hosted Inter `.woff2` files emitted by the Vite bundler.
- `packages/console-ui/src/lib/selectors/labels.ts` exports a function named `selectPrdDisplayLabel` that returns a string.
- A unit test in `packages/console-ui/src/__tests__/labels.test.ts` asserts that `selectPrdDisplayLabel({ title: 'Explicit Title', slug: 'explicit-title' })` returns `'Explicit Title'`.
- A unit test in `packages/console-ui/src/__tests__/labels.test.ts` asserts that `selectPrdDisplayLabel({ slug: 'add-foo-bar' })` returns `'Add Foo Bar'`.
- A unit test in `packages/console-ui/src/__tests__/labels.test.ts` asserts that `selectPrdDisplayLabel({ title: '# console-ui phase 1: create the new UI', slug: 'console-ui-phase-1' })` returns `'Console Ui Phase 1'` or `'Console UI Phase 1'`.
- A unit test in `packages/console-ui/src/__tests__/labels.test.ts` asserts that `selectPrdDisplayLabel({ slug: 'add-cli-feature' })` preserves `CLI` as uppercase in the result.
- `selectNowAttentionItems` in `packages/console-ui/src/lib/selectors/now.ts` produces at most one entry per `prdId` when its input state contains a failed queue item with a recovery verdict, the same failed queue item appearing again via the without-verdict rule, and a failed run for the same PRD.
- A unit test in `packages/console-ui/src/__tests__/now-selectors.test.ts` asserts that a state fixture containing a failed queue item with a recovery verdict, the same failed queue item through the without-verdict rule, and a failed run for the same PRD produces one attention item.
- A unit test in `packages/console-ui/src/__tests__/now-selectors.test.ts` asserts that when a dedupped attention item merges severities, the resulting severity is the worst contributing severity using `critical > warning > info`.
- `selectRunGroups` in `packages/console-ui/src/lib/selectors/runs.ts` merges an `enqueue` run and a `build` run into a single group when their `planSet` slugs match and their `startedAt` timestamps are within five minutes of each other.
- A unit test in `packages/console-ui/src/__tests__/runs-selectors.test.ts` asserts that two runs sharing a planSet and starting within five minutes are coalesced.
- A unit test in `packages/console-ui/src/__tests__/runs-selectors.test.ts` asserts that two runs sharing a planSet but starting more than five minutes apart are not merged.
- A unit test in `packages/console-ui/src/__tests__/runs-selectors.test.ts` asserts that a coalesced group whose enqueue run failed has rollup status `failed`.
- `selectRunGroups` returns a `planCountLabel` of `"1 plan"` when `metadata.planCount === 1`.
- `selectRunGroups` returns a `planCountLabel` of `"2 plans"` when `metadata.planCount === 2`.
- A unit test in `packages/console-ui/src/__tests__/runs-selectors.test.ts` asserts that `metadata.planCount === 1` produces `"1 plan"`.
- A unit test in `packages/console-ui/src/__tests__/runs-selectors.test.ts` asserts that `metadata.planCount === 2` produces `"2 plans"`.
- `packages/console-ui/src/components/now/now-status-overview.tsx` does not exist after the cleanup.
- `packages/console-ui/src/views/now-dashboard.tsx` does not import any component named `NowStatusOverview`.
- The `/console/` route response HTML, rendered at runtime with a connected daemon and zero active builds, does not contain a card labeled `Active builds` and a separate card labeled `Running builds` on the same view.
- The `ActiveBuildsGrid` component returns `null` when its `cards` prop is an empty array.
- The `ActiveBuildsGrid` component renders no `<section>` when its `cards` prop is an empty array.
- The `ActiveBuildsGrid` component renders no heading when its `cards` prop is an empty array.
- A test in `packages/console-ui/src/__tests__/now-dashboard.test.tsx` asserts that `<ActiveBuildsGrid cards={[]} />` renders nothing.
- The Console sidebar renders the text `Connected` only when `connectionStatus` is not `connected`.
- A test in `packages/console-ui/src/__tests__/console-shell.test.tsx` asserts that `Sidebar` with `connectionStatus="connected"` does not contain the visible text `Connected`.
- A test in `packages/console-ui/src/__tests__/console-shell.test.tsx` asserts that `Sidebar` with `connectionStatus="disconnected"` contains the visible text `Disconnected`.
- The Console footer status strip displays last-update relative time alongside the absolute timestamp.
- `packages/console-ui/src/components/shell/status-strip.tsx` imports `selectNowStatusSummary` from `lib/selectors/now`.
- `packages/console-ui/src/components/shell/status-strip.tsx` consumes `selectNowStatusSummary` from `lib/selectors/now`.
- The Daemon section of `/console/system` renders a row for Subscribers when that value is present in daemon state.
- The Daemon section of `/console/system` renders a row for Uptime when that value is present in daemon state.
- The Daemon section of `/console/system` renders a row for Scheduler limit when that value is present in daemon state.
- The Queue view does not render a `<section>` with the heading `Needs Attention`.
- The Queue view does not render a `<section>` with the heading `Attention`.
- A test in `packages/console-ui/src/__tests__/queue-view.test.tsx` asserts the Queue view never renders the heading `Needs Attention`.
- A failed queue item row in the Queue view renders the existing `RecoveryVerdictChip` inline when the item has a recovery verdict.
- The Queue view renders exactly four summary cards.
- The Queue view renders a summary card labeled `Total`.
- The Queue view renders a summary card labeled `Running`.
- The Queue view renders a summary card labeled `Pending`.
- The Queue view renders a summary card labeled `Failed`.
- A test in `packages/console-ui/src/__tests__/queue-view.test.tsx` asserts that summary cards labeled `Total`, `Running`, `Pending`, and `Failed` are present.
- A test in `packages/console-ui/src/__tests__/queue-view.test.tsx` asserts that a summary card labeled `Waiting` is not present.
- A test in `packages/console-ui/src/__tests__/queue-view.test.tsx` asserts that a summary card labeled `With deps` is not present.
- A test in `packages/console-ui/src/__tests__/queue-view.test.tsx` asserts that a summary card labeled `Recovery verdict` is not present.
- A test in `packages/console-ui/src/__tests__/queue-view.test.tsx` asserts that a summary card labeled `Recovery pending` is not present.
- The Queue view header does not render the chip with the text `read-only view`.
- The Queue view continues to render the read-only boundary alert text `This is a read-only view. Queue operations are not available in the Console.`.
- The Runs view renders a filter bar containing a status-chip group with an `all` option.
- The Runs view renders a filter bar containing a status-chip group with a `running` option.
- The Runs view renders a filter bar containing a status-chip group with a `failed` option.
- The Runs view renders a filter bar containing a status-chip group with a `completed` option.
- The Runs view renders a filter bar containing a command-chip group with an `all` option.
- The Runs view renders a filter bar containing a command-chip group with an `enqueue` option.
- The Runs view renders a filter bar containing a command-chip group with a `compile` option.
- The Runs view renders a filter bar containing a command-chip group with a `build` option.
- The Runs view renders a text input element whose accessible name indicates run search.
- The Runs view groups history rows under a day header labeled `Today`.
- The Runs view groups history rows under a day header labeled `Yesterday`.
- The Runs view groups history rows under a day header labeled `Older`.
- A test in `packages/console-ui/src/__tests__/runs-view.test.tsx` asserts that two runs from today are grouped under a `Today` header.
- A test in `packages/console-ui/src/__tests__/runs-view.test.tsx` asserts that selecting the `failed` status chip filters the run list to only rows whose rollup status is `failed`.
- The Runs history rows do not render the project `cwd` string on every row.
- The Runs view header renders a single project chip showing the basename of `cwd` once.
- The Runs history rows render a session identifier via the `truncateId` helper when a session identifier is present.
- The Runs history rows render a truncated session identifier with a value of at most 12 characters when a session identifier is present.
- The Runs view top-level container does not declare a `p-4` Tailwind class.
- The Runs view does not render two instances of `RunDetailPanel` in the same DOM tree at any viewport.
- A test in `packages/console-ui/src/__tests__/runs-view.test.tsx` asserts that the rendered DOM contains exactly one `RunDetailPanel` regardless of viewport width.
- The Runs view does not wrap its `<h1>` title in a shadcn `Card`.
- The System view Models section renders one `<details>` element per provider.
- Each System view Models section provider `<details>` element is closed by default.
- The System view Models section does not render more than 50 `<li>` elements before any `<details>` is expanded.
- A test in `packages/console-ui/src/__tests__/system-view.test.tsx` asserts that the initial DOM at `/console/system` contains zero `<li>` descendants of the Models section while all `<details>` elements are closed.
- The System view Models section renders a text input above the provider list whose accessible name indicates model search.
- The Activity view does not render a `<details>` element labeled `Raw event JSON` inside any event row by default.
- A test in `packages/console-ui/src/__tests__/activity-view.test.tsx` asserts that no event row in the rendered output contains a `<details>` element with the text `Raw event JSON`.
- Clicking an event row in the Activity view opens a slide-over panel that contains the pretty-printed JSON for that event.
- A test in `packages/console-ui/src/__tests__/activity-view.test.tsx` asserts that clicking an event row sets selection state and renders a panel containing JSON output.
- The Activity view event row does not render the visible text `family:`.
- The Activity view event row does not render the visible text `scope:`.
- The Activity view event row renders a colored dot whose `aria-label` includes the family name.
- The Activity view toolbar does not render a checkbox labeled `Attention only`.
- The Activity view toolbar renders exactly one text input element.
- A test in `packages/console-ui/src/__tests__/activity-view.test.tsx` asserts the absence of the `Attention only` checkbox.
- A new test file `packages/console-ui/src/__tests__/theme-token-discipline.test.ts` exists.
- `packages/console-ui/src/__tests__/theme-token-discipline.test.ts` is included in the vitest config.
- `pnpm --filter @eforge-build/console-ui test theme-token-discipline` exits 0.
- The theme-token-discipline test fails when a `.ts` or `.tsx` file under `packages/console-ui/src/`, excluding test files, contains the regex `class[Nn]ame[^"']*"[^"']*\\b(?:bg|text|border)-\\[#[0-9a-fA-F]`.
- The theme-token-discipline test fails when a `.ts` or `.tsx` file under `packages/console-ui/src/`, excluding test files, contains the regex `class[Nn]ame[^"']*"[^"']*\\btext-\\[[0-9]+px\\]`.
- `packages/console-ui/src/components/shell/sidebar.tsx` does not contain the string `#67f553`.
- `packages/console-ui/src/components/shell/status-strip.tsx` does not contain the string `#67f553`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-blue-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-purple-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-cyan-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-emerald-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-orange-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-yellow-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-indigo-100`.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` does not contain the substring `bg-gray-100`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-daemon`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-scheduler`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-queue`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-session`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-agent`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-extension`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-stack`.
- `packages/console-ui/src/globals.css` declares the CSS variable `--color-event-family-other`.
- No `.ts` or `.tsx` file under `packages/console-ui/src/` contains the substring `text-[10px]`.
- The Console UI renders without console errors during initial load of `/console/`.
- The Console UI renders without console errors during initial load of `/console/queue`.
- The Console UI renders without console errors during initial load of `/console/runs`.
- The Console UI renders without console errors during initial load of `/console/system`.
- The Console UI renders without console errors during initial load of `/console/activity`.
- The Console UI renders without unhandled promise rejections during initial load of `/console/`.
- The Console UI renders without unhandled promise rejections during initial load of `/console/queue`.
- The Console UI renders without unhandled promise rejections during initial load of `/console/runs`.
- The Console UI renders without unhandled promise rejections during initial load of `/console/system`.
- The Console UI renders without unhandled promise rejections during initial load of `/console/activity`.
- No source file under `packages/console-ui/src/` imports from `@eforge-build/engine`.
- No source file under `packages/console-ui/src/`, excluding tests, contains the literal substring `/api/`.
- The legacy monitor UI at `/` continues to render its existing `Console` link to `/console/`.
- `/console/` continues to return Console SPA HTML.
- `/console/index.html` continues to return Console SPA HTML.
- `/` continues to return the legacy monitor SPA HTML.
