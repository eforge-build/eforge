---
id: plan-01-thin-test-suite
name: Thin Automated Test Suite
branch: thin-automated-test-suite/plan-01-thin-test-suite
agents:
  builder:
    effort: high
    rationale: Test deletion spans six independent areas and requires evidence-first
      edits plus careful retained-coverage mapping.
  reviewer:
    effort: high
    rationale: Review must verify no valuable contract, security-adjacent,
      publication, or integration coverage was lost.
  tester:
    effort: high
    rationale: Targeted validation commands cover several packages and expensive
      package publication tests.
---

# Thin Automated Test Suite

## Architecture Context

This plan is intentionally test-only. It reduces duplicated, stale, or overly granular tests while preserving confidence through adjacent retained coverage. Production implementation files are out of scope unless a test-only helper/export cleanup becomes necessary; any such production edit must be documented in the evidence file with the reason.

The build must create `eforge/plans/thin-automated-test-suite/deleted-test-coverage.md` before deleting or consolidating tests. Treat this as a plan evidence artifact, not user-facing product documentation.

## Implementation

### Overview

Thin six scoped areas in one build:

1. Client event wire-contract duplicate cleanup.
2. Console selector micro-test consolidation.
3. Monitor static UI duplicate coverage thinning.
4. Engine provenance GitHub remote integration thinning.
5. First-party extension package publication/build test consolidation.
6. Extension package-management route test thinning.

Keep edits organized by area. Use bounded exact edits for large test files; do not rewrite oversized files.

### Evidence-First Workflow

1. Create `eforge/plans/thin-automated-test-suite/deleted-test-coverage.md` before deleting or consolidating any test.
2. Add one row for every deleted or consolidated `it(...)`/`describe(...)` block or deleted test file.
3. For each row, include:
   - Area.
   - Deleted or consolidated test name(s).
   - File path.
   - Retained adjacent test, lower-level contract, or fixture that covers the behavior.
   - Targeted validation command or static evidence used to confirm retained coverage.
   - Future-review note when a candidate is left in place because retained coverage is ambiguous.
4. Add keep-rationale rows for expensive first-party extension package tests that remain because they prove unique public-package confidence.
5. Update the evidence file as edits change; do not leave evidence for deletions that did not occur.

Suggested table columns:

| Area | Deleted/consolidated test | File | Retained coverage | Validation/evidence | Notes |
| --- | --- | --- | --- | --- | --- |

## Key Decisions

1. Delete only JSON-only or stale event-contract duplicates when schema validation, wire-parity fixtures, focused schema tests, or registry tests retain the behavior.
2. Prefer table-driven selector tests with descriptive labels over behavioral deletion.
3. Preserve monitor static-serving security-adjacent coverage through either direct static helper tests or full-server tests for traversal, malformed escapes, symlink escapes, route wiring, SPA fallback, and API 404 behavior.
4. Keep parser coverage for every GitHub remote URL variant, but retain only one representative real-git collector integration for GitHub blob URL construction.
5. Keep package publication/build tests when they uniquely prove public metadata, build/import safety, npm pack contents, workspace/type-check/release wiring, or fresh-project import safety.
6. Remove brittle source-string inspection in route tests only where public behavior tests cover the same contract.

## Scope

### In Scope

- Creating `eforge/plans/thin-automated-test-suite/deleted-test-coverage.md` before test edits.
- Test-only deletions, consolidations, helper export cleanup, and import cleanup in the scoped files.
- Retained-coverage documentation for every deleted or consolidated test.
- Targeted validation listed in this plan and orchestration.

### Out of Scope

- Production behavior changes.
- Broad test framework rewrites.
- Opportunistic cleanup outside the listed files.
- Removing high-value security, data-integrity, contract, package-publication, or integration tests without retained-coverage evidence.
- Permanent user-facing docs solely to justify deleted tests.

## Files

### Create

- `eforge/plans/thin-automated-test-suite/deleted-test-coverage.md` — Evidence table mapping each deleted or consolidated test to retained coverage and validation.

### Delete

- `packages/client/src/__tests__/events.test.ts` — Stale JSON-only daemon event roundtrip file. Retained coverage exists in `events-wire-parity-valid-fixtures.ts` plus `events-wire-parity.test.ts`, focused daemon/auto-build schema suites, and registry persistence tests.

### Modify

- `packages/client/src/__tests__/events-schemas.test.ts` — Remove the stale `new plan lifecycle + merge-worktree variants — JSON roundtrip` block if evidence maps each variant to retained `safeParseEforgeEvent` and wire-parity coverage. Keep adjacent `safeParseEforgeEvent` tests for plan status values, plan error set/clear, merge worktree set/clear, daemon heartbeat, and registry metadata.
- `packages/client/src/__tests__/events-schema-test-helpers.ts` — Remove `newVariants` and `NEW_VARIANT_TYPES` only if they become unused after event-schema cleanup.
- `packages/console-ui/src/__tests__/labels.test.ts` — Convert repeated one-assertion selector cases into labeled `it.each` tables. Preserve every current input/output pair, including acronym, date-prefix, markdown-title rejection, null/undefined/empty title, and slug fallback cases.
- `packages/console-ui/src/views/system/__tests__/extension-management-selectors.test.ts` — Convert repeated eligibility, trust-action, action-availability, and label/copy checks into labeled tables. Preserve behavior for project-local, project-team, user, external named, external unnamed, legacy trust, rich trustState, changed, trusted, untrusted, promote, demote, and unavailable-reason cases.
- `packages/monitor/src/__tests__/http-static-assets.test.ts` — Retain direct-helper coverage for malformed percent escapes, encoded traversal, multiple leading slash/encoded slash rejection, symlink escape rejection, SPA fallback, asset miss, asset caching, root redirects, and Console root serving. Consolidate only if labels remain specific.
- `packages/monitor/src/__tests__/static-ui-serving.test.ts` — Remove full-server duplicates for low-level malformed escape, encoded traversal, symlink escape, and missing asset behavior only if `http-static-assets.test.ts` retains those cases. Keep full-server route-wiring coverage for root redirects, `/console/`, Console assets, SPA fallback, and `/api/not-a-route` JSON 404. Remove setup/imports that become unused by deleted duplicate security tests.
- `test/provenance.test.ts` — Convert `parseGitHubRepoFromRemote` one-assertion cases into descriptive table-driven parser tests. Remove duplicate real-git collector integrations for non-HTTPS GitHub remote forms (`git+https`, scp-like SSH, `ssh://`) after recording that the parser table retains those variants and the HTTPS collector integration still proves blob URL construction from a real repository. Keep at least one GitHub collector test and keep parser coverage for remote variants and non-GitHub remotes.
- `eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts` — Keep unique foundation coverage for metadata, workspace/type-check/release wiring, tsconfig scope, lockfile importer, tsup bundling, public imports, compiled source-provider path, and import-safe built runtime/workstation artifacts. Add keep rationales to the evidence file for expensive retained build/import coverage.
- `eforge/extensions/eforge-plan/__tests__/package-publication.test.ts` — Remove duplicate metadata/release and build-file existence tests when retained by `package-foundation.test.ts`, `ensureBuilt`, and npm pack contents. Keep `npm pack --dry-run` contents and compiled runtime self-contained/fresh-project import safety checks.
- `eforge/extensions/eforge-playbooks/__tests__/package-foundation.test.ts` — Leave high-value package metadata, workspace, lockstep, type-check, tsconfig, bundling, public-import, and license coverage unless a duplicate with explicit retained coverage is identified. Record keep rationale for retained package confidence.
- `eforge/extensions/eforge-playbooks/__tests__/package-publication.test.ts` — Leave the combined build/import/npm-pack test unless retained coverage becomes unambiguous. Record keep rationale because it proves public package artifacts.
- `eforge/extensions/eforge-playbooks/__tests__/registration.test.ts` — Use as retained adjacent coverage for package capability/registration confidence; modify only for test-only import cleanup if needed.
- `eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts` — Use as retained adjacent coverage for eforge-plan/playbooks capability handoff confidence; modify only for test-only import cleanup if needed.
- `test/extension-tooling-routes-package-management.test.ts` — Delete the brittle production-source string inspection test named `POST extensionUpdate applies version overrides only to npm sidecar sources` after recording retained behavior coverage. Keep behavior tests for persisted effective npm source spec, npm file sidecar rejection, invalid registry version override rejection, path sidecar rejection, and tarball sidecar rejection. Make the path and tarball rejection labels explicit by source kind if the existing loop is edited.

## Area-Specific Retained Coverage Notes

### Client events

Retain or cite:

- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` entries for all daemon lifecycle, scheduler, auto-build, recovery, orphan, warning, and error events.
- `packages/client/src/__tests__/events-wire-parity.test.ts` validating those fixtures through `safeParseEforgeEvent`.
- `packages/client/src/__tests__/events-wire-parity-invalid.test.ts` for invalid discriminants and field-shape rejection.
- `packages/client/src/__tests__/events-schemas.test.ts` focused schema coverage for plan status values, plan error set/clear, merge worktree set/clear, daemon heartbeat, registry persistence, and projector behavior.
- `packages/client/src/__tests__/events-schemas-auto-build.test.ts` for auto-build transition schema/projector behavior.
- `packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts` for queue/landing/stack schema and registry behavior.

### Console selectors

Consolidation must preserve the exact expected outputs currently asserted in `labels.test.ts` and `extension-management-selectors.test.ts`. Use labels such as `slug acronym: mcp`, `markdown rejection: newline body leak`, `validate target: external named`, and `action eligibility: project-team changed can re-trust` so a failing table row identifies the lost behavior.

### Monitor static UI

Preserve coverage as follows:

- Traversal and malformed escape rejection: retained in `http-static-assets.test.ts` through direct helper HTTP tests.
- Symlink escape rejection: retained in `http-static-assets.test.ts` with `it.skipIf(!symlinksAvailable)`.
- Route wiring, Console root, assets, SPA fallback, and API 404: retained in `static-ui-serving.test.ts` through the real monitor server.
- If any direct-helper coverage is removed, keep the equivalent full-server test instead.

### Engine provenance

Keep parser cases for:

- HTTPS GitHub remote with and without `.git`.
- `git+https` GitHub remote.
- scp-like SSH GitHub remote with and without `.git`.
- `ssh://` GitHub remote with and without `.git`.
- GitLab, Bitbucket, local file path, empty string, and hyphenated owner/repo behavior.

Keep one real-git collector test that creates a repository, configures a GitHub remote, commits a plan artifact, calls `collectBuildArtifactProvenance`, and verifies the `https://github.com/<owner>/<repo>/blob/<sha>/...` URL.

### First-party extension packages

Record keep rationales for expensive tests that remain:

- eforge-plan build/import-safe runtime and workstation artifact test: proves public package code imports from built artifacts and registers actions/input sources/deep links/integration commands/console workstations.
- eforge-plan npm pack dry-run test: proves published file list excludes source, tests, node_modules, tsconfig, and tsup config while including prompts and built assets.
- eforge-plan compiled runtime self-contained test: proves fresh-project import safety by rejecting repository source paths and first-party package imports in built JS.
- eforge-playbooks publication test: proves build/import/npm-pack public artifact shape in one expensive integration.
- eforge-playbooks registration and planning contract tests: prove action, command, capability, optional dependency, and planning-mode handoff contracts without npm pack.

### Extension package-management routes

Public behavior retained after removing source-string inspection:

- Version-pinned npm update persists `registry-pkg@2.0.0` in the sidecar and response.
- `file:` npm sidecar sources reject version overrides with 400.
- Invalid registry version specifiers reject with 400.
- Path sidecar sources reject version overrides with 400.
- Tarball sidecar sources reject version overrides with 400.
- `DAEMON_API_VERSION >= 70` remains explicit.

## Verification

- [ ] `eforge/plans/thin-automated-test-suite/deleted-test-coverage.md` exists before the first deletion or consolidation commit.
- [ ] The evidence file has one row for every deleted or consolidated test and no rows for edits that were abandoned.
- [ ] Every evidence row names retained coverage and a validation command or static evidence source.
- [ ] Candidate tests without retained coverage remain in place or have a future-review row in the evidence file.
- [ ] `packages/client/src/__tests__/events.test.ts` is deleted or emptied only if all 20 daemon variant payloads remain represented in wire-parity valid fixtures or focused schema tests.
- [ ] Removed client JSON-only tests have retained `safeParseEforgeEvent`, wire-parity, focused schema, or registry coverage listed in the evidence file.
- [ ] Console selector tables preserve every pre-existing input/output assertion and include descriptive case labels.
- [ ] Monitor static UI tests still include traversal, malformed escape, symlink escape, route wiring, SPA fallback, and API 404 coverage across `http-static-assets.test.ts` and `static-ui-serving.test.ts`.
- [ ] Provenance parser tests still cover all remote URL variants listed in this plan.
- [ ] Provenance collector tests still include one real-git GitHub blob URL construction test.
- [ ] First-party extension package tests retain metadata, build/import safety, package file, workspace/type-check/release, and publication artifact confidence.
- [ ] Expensive retained first-party extension package tests have keep rationale rows in the evidence file.
- [ ] The route source-string inspection test is removed only if behavior tests still cover npm, npm `file:`, path, tarball, and invalid-version override cases.
- [ ] No production implementation file is edited unless the evidence file documents a test-only cleanup reason.
- [ ] All orchestration validation commands exit 0, or final implementation notes identify any intentionally skipped full-suite command and the CI confidence path.
