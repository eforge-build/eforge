---
title: Add body-safe backlog item updates
created: 2026-06-26
depends_on: ["eforge-plan-workstation-ux-polish"]
stack_parent: eforge-plan-workstation-ux-polish
priority: 2
---

# Add body-safe backlog item updates

## Problem / Motivation

`eforge-plan:update-item` currently only supports metadata-oriented changes such as status, priority, tags, dependencies, epic, evidence notes, and recheck notes. Agents that need to revise an item's title, Claim, Evidence, Acceptance Criteria, Notes, Recheck, or other structured Markdown body content must work around the action by directly editing Markdown.

Direct Markdown edits bypass extension-owned storage, validation, optimistic locking, Markdown mirror updates, search/index dirty marking, and recommendation invalidation. This undermines the eforge-plan workstation goal that agents should use compact backlog actions for discovery, inspection, capture, and mutation instead of editing backing files.

## Goal

Expand the eforge-plan backlog mutation boundary so `eforge-plan:update-item` can safely update item titles, canonical body sections, and metadata without direct Markdown edits.

Canonical SQLite/private extension storage should remain authoritative, partial structured body updates should use optimistic locking, read/write outputs should expose hashes and paths, and Markdown mirrors, search, and recommendations should stay consistent.

## Approach

- Preserve `eforge-plan:update-item` as the primary contribution ID.
- Add optional fields to `eforge-plan:update-item` rather than forcing agents to discover a second write action unless schema compatibility becomes untenable.
- Keep canonical SQLite/private extension storage authoritative.
- Keep Markdown files as compatibility mirrors and import inputs.
- Use structured partial updates as the default API.
- Support simple top-level `title` updates.
- Support `sections` or `sectionOperations` for named body sections.
- Support existing metadata fields for status, priority, tags, dependencies, and epic.
- Support evidence notes, recheck notes, timestamps, and frontmatter as appropriate.
- Require an optimistic lock for title, body, and section edits.
- Accept one documented lock token if multiple are supported, such as body hash, record hash, or updated timestamp.
- Fail closed with a clear user-action error on optimistic-lock mismatch.
- Keep raw full-body replacement out of the normal agent-facing path.
- If a full-body escape hatch is added, make it explicit, locked, and documented as recovery/debug-oriented.
- Canonicalize known section headings: `Claim`, `Evidence`, `Acceptance Criteria`, `Recheck`, and `Notes`.
- Reject ambiguous duplicate canonical sections before writing.
- Preserve unknown or non-targeted sections verbatim unless the caller explicitly patches them.
- Recompute and persist section rows from the final body so search and compact detail projections reflect the same content users see.
- Perform read-lock-validate-render-write through canonical helpers in one transaction where feasible.
- Mark search and recommendations stale through existing extension pathways after mutation.
- Return enough confirmation data for agent UX, including changed fields/sections, updated timestamp, body hash, record hash, relative path, and canonical storage kind.
- Validate item IDs, status values, priority values or documented priority convention, epic refs, dependency refs, and canonical section formatting before writing.
- Update direct-agent workflow documentation so agents use the action for backlog item edits and avoid direct Markdown edits except explicit manual recovery.

Likely implementation touchpoints:

- `eforge/extensions/eforge-plan/index.ts`
  - Expand `UpdateInput` and the `update-item` handler.
  - Update action description/output schema so the contribution advertises comprehensive body-safe edits.
  - Return lock, path, and version data.
  - Preserve metadata-only compatibility where possible.
- `eforge/extensions/eforge-plan/canonical/backlog-records.ts`
  - Use or extend `updateCanonicalBacklogItem` so title, body, and sections can be safely updated together.
  - Ensure updated hashes and timestamps are available to action outputs.
- `eforge/extensions/eforge-plan/backlog-domain.ts` or a new focused helper such as `canonical/item-body-sections.ts`
  - Parse and render canonical item bodies.
  - Normalize section names.
  - Preserve unrelated sections.
  - Produce section rows for SQLite.
- `eforge/extensions/eforge-plan/sqlite/repositories/items.ts`, `sqlite/types.ts`, and projection helpers if needed
  - Expose body hash, record hash, and updated timestamp through read projections so callers can obtain lock tokens before updating.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` and `eforge/extensions/eforge-plan/projections/items.ts`
  - Include version/hash/path fields in `get-item` output where appropriate without unnecessarily bloating default compact payloads.
- `eforge/extensions/eforge-plan/__tests__/`
  - Add or update action tests.
  - Add or update storage migration tests.
  - Add or update recommendation invalidation tests.
  - Add or update README contract tests.
  - Add or update registration tests.
- `eforge/extensions/eforge-plan/README.md` and generated/public docs sources such as `web/content/docs/eforge-plan.md`
  - Update examples.
  - Update direct-agent workflow guidance.
- `eforge-plugin/` and `packages/pi-eforge/`
  - Update both consistently if any Claude Code or Pi skill text instructs direct backlog edits.
  - Bump `eforge-plugin/.claude-plugin/plugin.json` if the Claude Code plugin changes.

Assumptions to validate during implementation:

- `bodySha256` and `recordSha256` already exist on canonical item rows and can be safely exposed through read/write outputs without adding new schema storage.
- Existing canonical helpers can write title, body, and sections together.
- If existing canonical helpers cannot write title, body, and sections together, the implementation should add the smallest focused helper rather than duplicating repository writes in the action handler.
- Search index behavior is dirty-marker based, so the update action should mark affected item search docs dirty rather than synchronously rebuilding FTS.
- Existing recommendation invalidation via `markRecommendationsStaleForBacklogMutation` remains the correct post-mutation behavior.
- Priority validation has a clear convention.
- If priority validation does not have a clear convention, document the current free-form behavior or add a small accepted vocabulary before enforcing strict validation.

Risk guardrails:

- Avoid breaking legacy metadata-only callers.
- Guard against Markdown corruption with parser/render tests for canonical sections, unknown sections, duplicate headings, empty sections, and title changes.
- Guard against lost updates by requiring lock checks for body-affecting updates in the same write transaction.
- Guard against index/storage drift by asserting canonical row, section row, mirror, dirty-index, and recommendation-stale behavior.
- Keep scope limited to the action/storage/docs boundary.
- Do not expand scope into a full editor or daemon/kernel change.

Validation plan:

- Add focused tests first for current limitations and intended `update-item` behavior.
- Run the eforge-plan extension test subset.
- Run storage migration tests.
- Run recommendation invalidation tests.
- Run registration tests.
- Run README contract tests.
- Run `pnpm type-check` to validate TypeBox/static typing and action output shapes.
- Run `pnpm docs:check` after generated/public docs are updated.
- Run `pnpm maintainability:check` to catch file-size and region-marker issues.

## Scope

In scope:

- Extend `eforge-plan:update-item`, or add a clearly documented replacement only if necessary.
- Support partial title updates.
- Support partial updates for canonical structured sections such as `Claim`, `Evidence`, `Acceptance Criteria`, `Recheck`, and `Notes`.
- Support selected additional body sections via validated section operations.
- Continue supporting existing metadata fields including `status`, `priority`, `tags`, `dependsOn`, `epic`, evidence notes, recheck notes, timestamps, and frontmatter as appropriate.
- Add optimistic locking for body, title, and section mutations using one or more expected version fields such as body hash, record hash, or updated timestamp.
- Allow callers to patch only changed fields or sections without rewriting unrelated content.
- Validate item IDs, status values, priority values or documented priority convention, epic refs, dependency refs, and canonical section formatting before writing.
- Keep canonical SQLite, item section rows, dependency/tag tables, Markdown mirrors, search dirty markers, and recommendation stale metadata consistent after writes.
- Return a compact updated-item summary containing at least id, title, status, path/storage identity, updated timestamp, and body/record hash or equivalent lock token.
- Update direct-agent workflow documentation so agents use the action for backlog item edits and avoid direct Markdown edits except explicit manual recovery.
- Use the safer update path where relevant in backlog curation workflows.

Out of scope:

- Arbitrary direct Markdown file editing as a normal workflow.
- Broad backlog curation format changes.
- Changing backlog curation draft semantics beyond using the safer update path where relevant.
- Adding a full rich workstation body editor unless minimal form/mock changes are needed to keep the action discoverable.
- A full workstation body editor beyond action/schema affordances.
- Daemon/kernel build scheduling changes.
- Queueing changes.
- Engine behavior changes.
- Epic body update parity, except for shared helpers if they are low-cost and do not expand the session.

## Acceptance Criteria

- `eforge-plan:get-item` or an equivalent read path exposes version data sufficient for safe updates.
- The read path exposes `updatedAt`, `bodySha256`, `recordSha256`, or an equivalent documented lock token.
- `eforge-plan:update-item` can update an item title.
- `eforge-plan:update-item` can update the `Claim` section.
- `eforge-plan:update-item` can update the `Evidence` section.
- `eforge-plan:update-item` can update the `Acceptance Criteria` section.
- `eforge-plan:update-item` can update the `Recheck` section.
- `eforge-plan:update-item` can update the `Notes` section.
- `eforge-plan:update-item` can update selected additional body sections through validated section operations.
- `eforge-plan:update-item` can update item status.
- `eforge-plan:update-item` can update item priority.
- `eforge-plan:update-item` can update item tags.
- `eforge-plan:update-item` can update item dependencies.
- `eforge-plan:update-item` can update item epic metadata.
- `eforge-plan:update-item` can update evidence notes.
- `eforge-plan:update-item` can update recheck notes.
- A partial update preserves unrelated metadata.
- A partial update preserves unrelated known body sections.
- A partial update preserves unrelated unknown body sections verbatim unless they are explicitly patched.
- A metadata-only update preserves existing body content.
- A body/title/section update requires a documented optimistic-lock token.
- A body/title/section update fails with a clear optimistic-lock error when the expected hash or version does not match the current record.
- Invalid item IDs are rejected before writing.
- Invalid status values are rejected before writing.
- Invalid priority values or invalid documented priority conventions are rejected before writing.
- Invalid epic refs are rejected before writing.
- Invalid dependency refs are rejected before writing.
- Duplicate canonical sections are rejected before writing.
- Malformed section operations are rejected before writing.
- Canonical section formatting is validated before writing.
- A successful action response includes the updated item id.
- A successful action response includes the updated item title.
- A successful action response includes the updated item status.
- A successful action response includes the relative path or storage identity.
- A successful action response includes the updated timestamp.
- A successful action response includes the current body hash, record hash, or equivalent lock token.
- A successful action response identifies changed fields or sections.
- Canonical SQLite item rows reflect successful updates.
- Item section rows are recomputed from the final body after successful updates.
- Dependency tables reflect dependency updates after successful updates.
- Tag tables reflect tag updates after successful updates.
- Markdown mirrors reflect the final canonical item content after successful updates.
- Successful updates mark affected item search documents dirty.
- Successful updates mark recommendation metadata stale through the existing recommendation invalidation pathway.
- Legacy Markdown-backed items migrate into canonical storage before update.
- The comprehensive update path works after legacy Markdown-backed item migration.
- Documentation directs backlog edits through the contribution.
- Documentation discourages direct Markdown edits except explicit manual recovery.
- Agent-facing guidance directs backlog edits through the contribution.
- Agent-facing guidance discourages direct Markdown edits except explicit manual recovery.
- A test verifies metadata-only `update-item` compatibility.
- A test verifies title updates.
- A test verifies canonical body section updates.
- A test verifies partial updates preserve unrelated content.
- A test verifies optimistic-lock mismatch behavior.
- A test verifies validation failures before write.
- A test verifies legacy migration before update.
- A test verifies recommendation invalidation after update.
- A test verifies search/index dirty behavior after update.
- A test verifies docs/action registration contracts.
- `pnpm type-check` exits 0.
- `pnpm docs:check` exits 0 after generated/public docs are updated.
- `pnpm maintainability:check` exits 0.
- The eforge-plan extension test subset exits 0.
- Storage migration tests exit 0.
- Recommendation invalidation tests exit 0.
- Registration tests exit 0.
- README contract tests exit 0.
- If Claude Code or Pi skill text changes, `eforge-plugin/` and `packages/pi-eforge/` are updated consistently.
- If `eforge-plugin/` changes, `eforge-plugin/.claude-plugin/plugin.json` version is bumped.

## Manual Verification Notes

- Manually smoke-test in a temporary project by capturing an item, reading it with sections/body hash, updating one section with the expected hash, verifying a stale-hash retry fails, and confirming `get-item`, search, and recommendation freshness reflect the mutation.