---
id: plan-03-ai-first-workstation-ux
name: Replace Backlog Promotion UI with AI-first Workstation Flow
branch: make-eforge-plan-workstation-ai-first-for-session-plan-generation/plan-03-ai-first-workstation-ux
agents:
  builder:
    effort: high
    rationale: This plan refactors the workstation Backlog UX, mock bridge state,
      generated assets, and docs while preserving iframe/action boundaries.
  reviewer:
    effort: high
    rationale: Review must verify user-facing deterministic promotion is removed
      from the workstation and preview/confirm semantics remain intact.
---

# Replace Backlog Promotion UI with AI-first Workstation Flow

## Architecture Context

The workstation iframe can only call registered extension actions through `window.eforge.invokeAction`. After plan-02, the extension action layer exposes durable task listing, retry, redraft, and creation draft apply. This plan updates the Backlog tab to consume those actions and removes deterministic promotion from the user-facing workstation path.

## Implementation

### Overview

Refactor the Backlog tab so selected ready items expose a single `Promote to a build plan` action that starts AI session-plan generation without a prompt input. Replace the prompt-driven Plan with AI start box with a durable task monitor/result panel. Render running progress, failures with retry, needs-input questions with redraft, ready creation draft preview/apply, and refreshed plan artifacts after apply. Update mock fixtures, docs, static tests, and built assets.

### Key Decisions

1. Use the selected ready backlog item ids as the AI promotion context. If selected items include blocked/closed/non-ready items, the start request includes only ready items and the action is disabled when that ready subset is empty.
2. Keep deterministic `promote-selection` out of workstation source and allowed action usage for backlog-to-plan creation. The compatibility action remains registered for integration commands and deep links.
3. Keep generated output read-only until the user clicks an in-app confirmation button for creation draft apply, recommendation apply, or any retained patch/handoff category.
4. Store task discovery in extension-owned workflow metadata, not local React state or browser storage. React state may cache current renders but reload must call the list action.
5. Keep mock bridge fixtures stateful enough to exercise running progress, failure retry, needs-input redraft, and ready creation draft apply during local UI development.

## Scope

### In Scope

- Single selected-items `Promote to a build plan` action in the Backlog sticky selection bar.
- Recommendation card/group actions that start AI promotion tasks rather than deterministic promotion.
- Durable task monitor that lists indexed tasks after reload, polls running tasks, and displays running/completed/failed/cancelled states.
- Section-progress rendering with current, covered, and remaining sections when metadata is available.
- Failed-task retry controls using preserved workflow context.
- Needs-input clarification rendering, answer/steering inputs, and linked redraft task start.
- Ready creation draft preview and explicit confirmation before apply.
- Plans/artifact refresh after successful creation draft apply.
- Mock bridge fixtures and checked-in workstation assets.
- eforge-plan README updates for the AI-first flow.

### Out of Scope

- Open-ended chat UI.
- Auto-enqueueing builds.
- Removing compatibility integration commands or deep links for `promote-selection`.
- Direct daemon HTTP calls from the workstation iframe.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — shared React hook for list, poll, start, retry, redraft, cancel, and apply action calls through the bridge.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — task status/progress/result card components for running, completed, failed, and cancelled tasks.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx` — preview and confirmation controls for needs-input questions and ready creation drafts if keeping `plan-with-ai-panel.tsx` under size limits requires extraction.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` — remove deterministic `promote-selection` calls, compute selected ready item ids, render the single sticky `Promote to a build plan` action, clear selection after task start, and wire recommendation starts to the AI workflow.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` — refactor into a monitor/results panel with no required free-form prompt/goal input; list durable tasks; poll running tasks; render progress, retry, redraft, and apply controls.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.tsx` — replace deterministic promotion callback wording and event payloads with AI promotion task start requests by item ids or recommendation refs.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add workflow projection, decision, clarification question, section progress, creation draft, retry/redraft, and apply response types.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — add mock cases for `list-planning-agent-tasks`, `retry-planning-agent-task`, `redraft-planning-agent-task`, and creation draft apply.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add running progress, failed retry, needs-input, and ready creation draft fixtures plus created-plan mock artifact data after apply.
- `eforge/extensions/eforge-plan/index.ts` — after UI source no longer calls deterministic promotion, remove `promote-selection` from workstation `allowedActions` while leaving the action registration, integration command, and deep link intact.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — update static tests for the single AI promotion action, absence of the prompt-input start box, absence of `promote-selection` from Backlog source, new task workflow actions, mock fixtures, and explicit confirmation text.
- `test/eforge-plan-workstation.test.ts` — update workstation allowed action expectations for task list/retry/redraft and no workstation `promote-selection` allowance.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update final workstation allowed action assertions after `promote-selection` is removed from the workstation allowance.
- `eforge/extensions/eforge-plan/README.md` — document `Promote to a build plan`, durable task monitoring, section progress, failure retry, needs-input redraft, creation draft preview/apply, no prompt-input Plan with AI box, no deterministic workstation promotion path, and no enqueue/submitted side effects.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.html` — refresh generated asset if the workstation build changes it.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — regenerate from Vite build.
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css` — regenerate from Vite build.

## Verification

- [ ] Backlog source contains `Promote to a build plan` and does not contain `Promote as one plan`.
- [ ] Backlog source does not invoke `'promote-selection'` for selected item or recommendation promotion.
- [ ] The prompt-input Plan with AI start box is absent from workstation source; no state setter named `setUserGoal` remains in `plan-with-ai-panel.tsx`.
- [ ] Static workstation tests confirm the selected-items action is the only selected backlog session-plan generation action.
- [ ] Mock bridge returns one running task with current/covered/remaining section progress, one failed task with retry behavior, one needs-input task, and one ready creation draft task.
- [ ] Applying a ready creation draft through the mock bridge refreshes artifacts so the new session appears in the Plans list fixture.
- [ ] Production assets contain `Promote to a build plan`, `list-planning-agent-tasks`, `retry-planning-agent-task`, and `redraft-planning-agent-task`, and do not contain `Promote as one plan`.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm build:eforge-plan-workstation` exits 0 and updates checked-in workstation assets.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts test/eforge-plan-workstation.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
