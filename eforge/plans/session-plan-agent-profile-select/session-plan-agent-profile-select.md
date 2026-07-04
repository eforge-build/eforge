---
id: session-plan-agent-profile-select
name: Session plan agent profile select UI and persistence
branch: session-plan-agent-profile-select/session-plan-agent-profile-select
---

# Session plan agent profile select UI and persistence

Update session plan metadata editing to render the build agent profile as a select/dropdown instead of free text. The UI consumes the profile-options action/bridge from `eforge-plan-profile-options-action` and continues saving through the existing `update-session-plan-metadata` path with the existing `agentProfile` field.

## Implementation scope

Primary owned paths:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/metadata-editor.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` or the adjacent Plans data hook that loads profile options
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` and workstation fixtures/mocks for development and tests
- Workstation/component tests near the Plans view, plus any affected eforge-plan action tests needed to prove persistence still preserves open questions

Required behavior:

- Replace the Agent profile input with a select/dropdown and keep the existing planning profile selector unchanged.
- Always render a default/no-selection option labeled like `Default/active eforge profile (leave agent_profile unset)` and persist that choice as `agentProfile: null` or equivalent so `agent_profile` is omitted/cleared.
- Selecting a known profile saves through `update-session-plan-metadata` using `agentProfile: <profile-name>` and preserves open questions and unrelated metadata.
- Existing known `agent_profile` values select normally. Missing/deleted values render a visible synthetic current-value option that can be kept, changed, or cleared without blocking unrelated saves.
- Profile-list loading, empty, and error states must not block clearing `agent_profile` or editing planning profile metadata.
- Labels and help text must distinguish `Planning profile` (`errand`/`excursion`/`expedition`) from `Build agent profile` / `Agent runtime profile` (`agent_profile`).
- The workstation must remain sandboxed behind `window.eforge.invokeAction`/allowed actions; do not add direct `fetch`/`XMLHttpRequest` calls, hard-coded `/api/...` profile routes, profile-file reads, or private Console/engine config imports.

## Traceability

Criteria: ac-001, ac-002, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012
Aspects: ac-001:evidence:select-dropdown, ac-006:evidence:no-selection-default, ac-006:evidence:omitted-cleared, ac-007:general:general, ac-008:interface:ui, ac-008:interface:ui-surface, ac-008:subsystem:ui, ac-009:general:general, ac-010:evidence:missing-deleted, ac-011:general:general, ac-012:evidence:copy-label, ac-012:interface:test

## Validation

Run these gates after implementation:

- `pnpm type-check`
- Targeted workstation/component tests added or updated for `metadata-editor.tsx` / Plans metadata behavior
- `pnpm test -- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` if action persistence/schema behavior is touched
- `pnpm build` or the eforge-plan workstation build if asset/type bundling changes
- `pnpm maintainability:check`

Tests must cover select rendering, default clearing to null/omitted, selecting known profiles, preserving and clearing missing profiles, copy/label distinction, loading/empty/error non-blocking behavior, and open-question preservation.
