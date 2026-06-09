---
id: plan-03-workstation-docs-lifecycle-ui
name: Workstation Lifecycle UI and Documentation
branch: link-eforge-plan-backlog-items-session-plans-queue-runs-and-landed-builds/plan-03-workstation-docs-lifecycle-ui
agents:
  builder:
    effort: medium
    rationale: UI changes are bounded to the eforge-plan workstation and consume
      backend projections from plan-02.
  doc-author:
    effort: medium
    rationale: The README needs first-party lifecycle-linkage semantics and storage
      documentation.
  reviewer:
    effort: medium
    rationale: Review focus is UI data handling, generated asset sync, and docs accuracy.
---

# Workstation Lifecycle UI and Documentation

## Architecture Context

The eforge-plan workstation is the supported read surface for extension-owned lifecycle data. It must call extension actions through `window.eforge.invokeAction` and render compact, readable lifecycle evidence without reading private storage or daemon routes directly.

## Implementation

### Overview

Add frontend types and components for lifecycle link rows, item/plan/epic progress, PR/landing display, and source refs. Render lifecycle chips/timeline rows on backlog cards and source/evidence panels in plan detail. Extend mock fixtures and rebuild checked-in workstation assets. Update README documentation for linkage, AI creation-draft linking, partial completion, and recommendation freshness.

### Key Decisions

1. UI consumes only action output projections from plan-02.
2. Backlog cards use compact chips plus an expandable lifecycle panel to avoid noisy cards.
3. Plan detail surfaces source refs and lifecycle evidence near the top of the detail view before readiness editing.
4. Mock bridge examples cover active, PR-open, merged, failed, multi-item partial, and epic partial states.

## Scope

### In Scope

- Frontend TypeScript types for lifecycle link rows, epic progress, plan source refs, PR refs, landing refs, and item rows.
- Backlog item lifecycle chips and expandable panel for active, PR-open, merged, and failed linked work.
- Session plan source backlog/epic refs and lifecycle evidence panels near readiness/handoff controls.
- Mock fixtures and bridge support for multi-item partial, PR-open, merged, and failed lifecycle examples.
- Rebuilt workstation assets under `workstation-assets/plans`.
- README documentation for lifecycle linkage storage, creation-draft trust rules, partial completion, and recommendation freshness interaction.

### Out of Scope

- Parent Console route changes.
- Private frame-to-daemon calls or direct private storage reads.
- Pi/Claude hardcoded command behavior changes.
- Scheduler, auto-mode, unattended enqueue, or background refresh behavior.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/lifecycle-panel.tsx` — compact chips and expandable lifecycle rows for backlog cards.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/lifecycle-evidence-panel.tsx` — source refs and lifecycle evidence sections for flat session-plan details.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add lifecycle/source/epic progress frontend interfaces and wire optional fields into `BoardItem`, `Board`, `Artifact`, and `PlanData`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-card.tsx` — render lifecycle chips and expandable timeline rows after tags/dependencies and before notes.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.ts` — include lifecycle labels, PR URLs, session ids, and affected ids in card search text.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — render source backlog refs, source epic refs, queue/run/PR/landing evidence, and partial item rows before the readiness checklist.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add linked lifecycle fixture cards and plan details for active, PR-open, merged, failed, multi-item partial, and epic partial examples.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — return lifecycle-enhanced mock board/artifact/detail data.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — assert source and built assets include lifecycle panel strings, fixture states, and no private Console/HTTP calls.
- `test/eforge-plan-workstation.test.ts` — update dogfood coverage if the workstation action allowlist or expected rendered strings change.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — rebuild from `pnpm build:eforge-plan-workstation`.
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css` — rebuild if Vite emits CSS changes.
- `eforge/extensions/eforge-plan/README.md` — document the complete backlog → session plan → handoff → queue/run → PR/landing → item/epic progress chain, private storage locations, trusted AI creation-draft source linking, partial-completion rules, and recommendation freshness interaction.

## UI Rendering Guidance

- Backlog card chips: render a small row such as `Plan`, `Queue`, `Run`, `PR open`, `Merged`, `Failed`, or `Partial` based on lifecycle rows. Use existing CSS variables and badge/tag patterns.
- Backlog card details: include row kind, status, session/PRD/run/session id, PR URL, commit/branch, timestamp, and affected item ids when present.
- Plan detail source panel: render source item ids and epic ids as compact code chips; show missing/empty source metadata as an explicit muted message.
- Plan detail evidence panel: group rows by kind or stage and include per-item rows when the plan lifecycle state is `partial`.
- External PR URLs can render as normal anchor tags with `target="_blank"` and `rel="noreferrer"`; no fetch calls are introduced.

## Documentation Notes

- Document trace sidecars under `.eforge/storage/extensions/eforge-plan/traces/`, recommendations under `.eforge/storage/extensions/eforge-plan/recommendations/`, planning task workflow index under `.eforge/storage/extensions/eforge-plan/planning-tasks/index.json`, and session plans under `.eforge/session-plans/`.
- State that AI creation-draft source ids come from the preserved workflow selection, not agent output.
- State that PR-open, failed, skipped, cancelled, and ambiguous evidence updates traces/UI but does not close backlog items.
- State that confirmed merge or auto-merge evidence can mark only correlated item ids shipped.
- State that mixed multi-item or epic evidence projects `partial` with per-item rows.
- State that recommendation freshness is invalidated by correlated lifecycle updates and refreshed only through explicit recommendation apply/refresh actions.

## Verification

- [ ] Backlog item cards render lifecycle chips for active, PR-open, merged, and failed fixture items.
- [ ] Backlog item cards expose an expandable lifecycle panel with session/queue/run/PR/landing rows.
- [ ] Plan detail renders source backlog refs and source epic refs before the readiness checklist.
- [ ] Plan detail renders queue, run, PR, landing, and partial per-item evidence for linked plans.
- [ ] Mock data contains multi-item partial, PR-open, merged, and failed lifecycle examples.
- [ ] Mock bridge returns lifecycle-enhanced data for `list-board`, `list-planning-artifacts`, and `show-session-plan`.
- [ ] Built workstation assets contain lifecycle panel UI strings after `pnpm build:eforge-plan-workstation`.
- [ ] Workstation source and built assets contain no `fetch(`, `XMLHttpRequest`, private Console imports, or direct private storage reads.
- [ ] README contains sections or paragraphs for lifecycle linkage, AI creation-draft source linking, partial completion, and recommendation freshness interaction.
