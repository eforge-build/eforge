# Planner Compiler Architecture

## Summary

Reduced four atoms into a five-module plan: a shared idempotent queued-build finalizer, startup adoption/lock reconciliation, adopted-success state/artifact preservation, adopted failure/cancel control, and AC-008 regression coverage. AC-006 cleanup-gated orphan queue:prd:complete finalization was merged into the shared finalizer and its wake behavior into startup adoption. No conflicts were found. Four repair-only source/localization gaps remain with representationRequired=false; implementers must inspect actual queue/replay/state/cancellation/projection owners before bounded edits. All module candidates preserve docsWork=none and testWork=author-new.

## Compiler status

Compiler status: complete
Source hash: 4004fc4c792fe45786b874bb549797c54e4c896ea06b3a00de559f9a0fbc9431

## Plan boundaries

### mod-idempotent-queue-finalizer — Shared idempotent queued-build finalizer

Criteria: ac-002, ac-004, ac-006
Aspects: ac-002:general:general, ac-004:general:general, ac-006:subsystem:finalize
Depends on: (none)
Residue: no
Owned files: .pi/extensions/eforge-dev/index.ts, docs/webux-workspaces.md
Validation: Author real-code Vitest coverage for duplicate completion-event/PID-poll races and persisted orphan queue:prd:complete replay. Assert one terminal PRD transition, one lock release, expected recovery evidence, dependent-skip propagation, cleanup before completion handling, and no-op repeated finalization.

### mod-startup-adoption-reconciliation — Startup adoption and lock reconciliation

Criteria: ac-001, ac-005, ac-006
Aspects: ac-001:general:general, ac-005:general:general, ac-006:subsystem:wake
Depends on: mod-idempotent-queue-finalizer
Residue: no
Owned files: .pi/extensions/eforge-dev/index.ts, docs/webux-workspaces.md
Validation: Author restart/reconciliation tests covering live prior-generation locks, dead PIDs, stale locks, corrupt lock payloads, missing locks, and persisted orphan completion replay. Assert adopted/monitored state or cleared/degraded running state with exact diagnostics and no duplicate dispatch.

### mod-adopt-success-state-artifact-preservation — Adopted successful build state/artifact preservation

Criteria: ac-003
Aspects: ac-003:subsystem:preserve, ac-003:subsystem:update
Depends on: mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation
Residue: no
Owned files: eforge-plugin/.claude-plugin/plugin.json, eforge-plugin/skills/restart/restart.md, eforge-plugin/skills/update/update.md, eforge-plugin/skills/workflow/workflow.md, eforge/dependency-update-evidence.md, eforge/extensions/eforge-plan/backlog-curation-actions.ts, eforge/playbooks/dependency-update.md, eforge/prds/preserve-terminal-curation-findings-under-reducer-byte-caps.md, packages/pi-eforge/skills/eforge-update/SKILL.md
Validation: Author focused tests seeding orphaned completed queue/root artifact state, running the adoption path, and asserting original completion/artifacts remain, root queue state is updated or removed as required, dependents observe completion, and no rerun occurs.

### mod-adopted-failure-cancel-control — Adopted failure and cancellation control

Criteria: ac-004, ac-007
Aspects: ac-004:general:general, ac-007:general:general
Depends on: mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation
Residue: no
Owned files: (none)
Validation: Author tests for adopted failure cleanup, recovery sidecar/degraded evidence, dependent skips, verified cancellation signaling, and unverifiable PID diagnostics without unsafe signals.

### mod-ac008-regression-coverage — AC-008 adoption/reconciliation regression coverage

Criteria: ac-008
Aspects: ac-008:interface:test, ac-008:subsystem:cancellation, ac-008:subsystem:corrupt, ac-008:subsystem:reconciliation, ac-008:subsystem:stale, ac-008:subsystem:test
Depends on: mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation
Residue: no
Owned files: .claude/skills/eforge-plugin-update-docs/SKILL.md, .claude/skills/eforge-release/SKILL.md, .github/workflows/ci.yml, .github/workflows/publish.yml, .pi/extensions/eforge-dev/README.md, CONTRIBUTING.md, docs/architecture.md, docs/extensions-api.md, docs/extensions.md, docs/releasing.md, docs/roadmap.md, eforge-plugin/bin/eforge-mcp-proxy.mjs, eforge-plugin/skills/profile/profile.md, eforge-plugin/skills/recover/recover.md, eforge-plugin/skills/stack/stack.md, eforge/config.yaml, eforge/extensions/eforge-guardrails/index.ts, eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts, eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts, eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts, eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts, eforge/extensions/eforge-plan/__tests__/kanban.test.ts, eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts, eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts, eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts, eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts, eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts, eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts, eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts, eforge/extensions/eforge-plan/agent-task-actions.ts, eforge/extensions/eforge-plan/README.md, packages/engine/src/eforge.ts, packages/engine/src/queue/cancellation.ts, packages/monitor/src/daemon-event-reactions.ts, packages/monitor/src/projections/queue-items.ts, packages/monitor/src/server-main.ts, README.md, test/queue-cancellation-ownership.test.ts, test/queue-scheduler-reconciliation.test.ts, test/worktree-reconciliation.test.ts
Validation: Run targeted Vitest suites plus the broader test cycle as needed. Assertions should cover cancellation/reconciliation behavior, no duplicate dispatch after orphan completion, dependent unblocking after adopted success, deterministic stale/corrupt projection, and no projection crashes or wire-shape drift.

## Integration contracts

- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (interface test): Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve.
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (interface test): Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve.
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (interface test): Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve.
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (interface test): Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve.
- mod-ac008-regression-coverage -> mod-adopt-success-state-artifact-preservation (plan dependency): mod-ac008-regression-coverage builds on Adopted successful build state/artifact preservation
- mod-ac008-regression-coverage -> mod-adopted-failure-cancel-control (plan dependency): mod-ac008-regression-coverage builds on Adopted failure and cancellation control
- mod-ac008-regression-coverage -> mod-idempotent-queue-finalizer (plan dependency): mod-ac008-regression-coverage builds on Shared idempotent queued-build finalizer
- mod-ac008-regression-coverage -> mod-startup-adoption-reconciliation (plan dependency): mod-ac008-regression-coverage builds on Startup adoption and lock reconciliation
- mod-adopt-success-state-artifact-preservation -> mod-idempotent-queue-finalizer (plan dependency): mod-adopt-success-state-artifact-preservation builds on Shared idempotent queued-build finalizer
- mod-adopt-success-state-artifact-preservation -> mod-startup-adoption-reconciliation (plan dependency): mod-adopt-success-state-artifact-preservation builds on Startup adoption and lock reconciliation
- mod-adopted-failure-cancel-control -> mod-idempotent-queue-finalizer (plan dependency): mod-adopted-failure-cancel-control builds on Shared idempotent queued-build finalizer
- mod-adopted-failure-cancel-control -> mod-startup-adoption-reconciliation (plan dependency): mod-adopted-failure-cancel-control builds on Startup adoption and lock reconciliation
- mod-startup-adoption-reconciliation -> mod-idempotent-queue-finalizer (plan dependency): mod-startup-adoption-reconciliation builds on Shared idempotent queued-build finalizer
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file .claude/skills/eforge-plugin-update-docs/SKILL.md): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-guardrails/index.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-adopt-success-state-artifact-preservation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-adopted-failure-cancel-control -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file docs/releasing.md): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-idempotent-queue-finalizer -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file .pi/extensions/eforge-dev/README.md): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file docs/releasing.md): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts): shared-evidence-primary-owner
- mod-startup-adoption-reconciliation -> mod-ac008-regression-coverage (shared file eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts): shared-evidence-primary-owner

## Shared file ownership

- .claude/skills/eforge-plugin-update-docs/SKILL.md: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation (shared-evidence-primary-owner)
- .claude/skills/eforge-release/SKILL.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- .github/workflows/ci.yml: owner mod-ac008-regression-coverage (single-atom-evidence)
- .github/workflows/publish.yml: owner mod-ac008-regression-coverage (single-atom-evidence)
- .pi/extensions/eforge-dev/index.ts: owner mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (single-atom-evidence)
- .pi/extensions/eforge-dev/README.md: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- CONTRIBUTING.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- docs/architecture.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- docs/extensions-api.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- docs/extensions.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- docs/releasing.md: owner mod-ac008-regression-coverage; consumers mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- docs/roadmap.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- docs/webux-workspaces.md: owner mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (single-atom-evidence)
- eforge-plugin/.claude-plugin/plugin.json: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge-plugin/bin/eforge-mcp-proxy.mjs: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge-plugin/skills/profile/profile.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge-plugin/skills/recover/recover.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge-plugin/skills/restart/restart.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge-plugin/skills/stack/stack.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge-plugin/skills/update/update.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge-plugin/skills/workflow/workflow.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge/config.yaml: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/dependency-update-evidence.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge/extensions/eforge-guardrails/index.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/kanban.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts: owner mod-ac008-regression-coverage; consumers mod-adopt-success-state-artifact-preservation, mod-adopted-failure-cancel-control, mod-idempotent-queue-finalizer, mod-startup-adoption-reconciliation (shared-evidence-primary-owner)
- eforge/extensions/eforge-plan/agent-task-actions.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/extensions/eforge-plan/backlog-curation-actions.ts: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge/extensions/eforge-plan/README.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- eforge/playbooks/dependency-update.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- eforge/prds/preserve-terminal-curation-findings-under-reducer-byte-caps.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- packages/engine/src/eforge.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- packages/engine/src/queue/cancellation.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- packages/monitor/src/daemon-event-reactions.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- packages/monitor/src/projections/queue-items.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- packages/monitor/src/server-main.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- packages/pi-eforge/skills/eforge-update/SKILL.md: owner mod-adopt-success-state-artifact-preservation (single-atom-evidence)
- README.md: owner mod-ac008-regression-coverage (single-atom-evidence)
- test/queue-cancellation-ownership.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- test/queue-scheduler-reconciliation.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)
- test/worktree-reconciliation.test.ts: owner mod-ac008-regression-coverage (single-atom-evidence)

## Reduce conflicts

- (none)

## Machine-readable manifest

```json eforge-architecture-manifest
{
  "version": 1,
  "plans": [
    {
      "planId": "mod-idempotent-queue-finalizer",
      "title": "Shared idempotent queued-build finalizer",
      "residue": false,
      "criterionIds": [
        "ac-002",
        "ac-004",
        "ac-006"
      ],
      "aspectIds": [
        "ac-002:general:general",
        "ac-004:general:general",
        "ac-006:subsystem:finalize"
      ],
      "dependsOnPlanIds": []
    },
    {
      "planId": "mod-startup-adoption-reconciliation",
      "title": "Startup adoption and lock reconciliation",
      "residue": false,
      "criterionIds": [
        "ac-001",
        "ac-005",
        "ac-006"
      ],
      "aspectIds": [
        "ac-001:general:general",
        "ac-005:general:general",
        "ac-006:subsystem:wake"
      ],
      "dependsOnPlanIds": [
        "mod-idempotent-queue-finalizer"
      ]
    },
    {
      "planId": "mod-adopt-success-state-artifact-preservation",
      "title": "Adopted successful build state/artifact preservation",
      "residue": false,
      "criterionIds": [
        "ac-003"
      ],
      "aspectIds": [
        "ac-003:subsystem:preserve",
        "ac-003:subsystem:update"
      ],
      "dependsOnPlanIds": [
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ]
    },
    {
      "planId": "mod-adopted-failure-cancel-control",
      "title": "Adopted failure and cancellation control",
      "residue": false,
      "criterionIds": [
        "ac-004",
        "ac-007"
      ],
      "aspectIds": [
        "ac-004:general:general",
        "ac-007:general:general"
      ],
      "dependsOnPlanIds": [
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ]
    },
    {
      "planId": "mod-ac008-regression-coverage",
      "title": "AC-008 adoption/reconciliation regression coverage",
      "residue": false,
      "criterionIds": [
        "ac-008"
      ],
      "aspectIds": [
        "ac-008:interface:test",
        "ac-008:subsystem:cancellation",
        "ac-008:subsystem:corrupt",
        "ac-008:subsystem:reconciliation",
        "ac-008:subsystem:stale",
        "ac-008:subsystem:test"
      ],
      "dependsOnPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ]
    }
  ],
  "fileOwnership": [
    {
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": ".claude/skills/eforge-release/SKILL.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/ci.yml",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".github/workflows/publish.yml",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/index.ts",
      "ownerPlanIds": [
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": ".pi/extensions/eforge-dev/README.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "CONTRIBUTING.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/architecture.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions-api.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/extensions.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/releasing.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "docs/roadmap.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "docs/webux-workspaces.md",
      "ownerPlanIds": [
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/.claude-plugin/plugin.json",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/bin/eforge-mcp-proxy.mjs",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/profile/profile.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/recover/recover.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/restart/restart.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/stack/stack.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/update/update.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge-plugin/skills/workflow/workflow.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/config.yaml",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/dependency-update-evidence.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-capture-guardrails.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/kanban.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [
        "mod-adopt-success-state-artifact-preservation",
        "mod-adopted-failure-cancel-control",
        "mod-idempotent-queue-finalizer",
        "mod-startup-adoption-reconciliation"
      ],
      "shared": true,
      "reason": "shared-evidence-primary-owner"
    },
    {
      "path": "eforge/extensions/eforge-plan/agent-task-actions.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/backlog-curation-actions.ts",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/extensions/eforge-plan/README.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/playbooks/dependency-update.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "eforge/prds/preserve-terminal-curation-findings-under-reducer-byte-caps.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/eforge.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/engine/src/queue/cancellation.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/daemon-event-reactions.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/projections/queue-items.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/monitor/src/server-main.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "packages/pi-eforge/skills/eforge-update/SKILL.md",
      "ownerPlanIds": [
        "mod-adopt-success-state-artifact-preservation"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "README.md",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/queue-cancellation-ownership.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/queue-scheduler-reconciliation.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    },
    {
      "path": "test/worktree-reconciliation.test.ts",
      "ownerPlanIds": [
        "mod-ac008-regression-coverage"
      ],
      "consumerPlanIds": [],
      "shared": false,
      "reason": "single-atom-evidence"
    }
  ],
  "contracts": [
    {
      "contractId": "interface:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:test",
      "kind": "interface",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve."
    },
    {
      "contractId": "interface:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:test",
      "kind": "interface",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve."
    },
    {
      "contractId": "interface:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:test",
      "kind": "interface",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve."
    },
    {
      "contractId": "interface:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:test",
      "kind": "interface",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "interfaceKey": "test",
      "summary": "Shared interface test is referenced by atoms atom-rescope-cancellation, atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve. Primary atom atom-rescope-cancellation owns reusable interface findings for consumers atom-rescope-finalize, atom-rescope-general, atom-rescope-preserve."
    },
    {
      "contractId": "plan-dependency:mod-ac008-regression-coverage->mod-adopt-success-state-artifact-preservation:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-ac008-regression-coverage",
      "toPlanId": "mod-adopt-success-state-artifact-preservation",
      "summary": "mod-ac008-regression-coverage builds on Adopted successful build state/artifact preservation"
    },
    {
      "contractId": "plan-dependency:mod-ac008-regression-coverage->mod-adopted-failure-cancel-control:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-ac008-regression-coverage",
      "toPlanId": "mod-adopted-failure-cancel-control",
      "summary": "mod-ac008-regression-coverage builds on Adopted failure and cancellation control"
    },
    {
      "contractId": "plan-dependency:mod-ac008-regression-coverage->mod-idempotent-queue-finalizer:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-ac008-regression-coverage",
      "toPlanId": "mod-idempotent-queue-finalizer",
      "summary": "mod-ac008-regression-coverage builds on Shared idempotent queued-build finalizer"
    },
    {
      "contractId": "plan-dependency:mod-ac008-regression-coverage->mod-startup-adoption-reconciliation:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-ac008-regression-coverage",
      "toPlanId": "mod-startup-adoption-reconciliation",
      "summary": "mod-ac008-regression-coverage builds on Startup adoption and lock reconciliation"
    },
    {
      "contractId": "plan-dependency:mod-adopt-success-state-artifact-preservation->mod-idempotent-queue-finalizer:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-idempotent-queue-finalizer",
      "summary": "mod-adopt-success-state-artifact-preservation builds on Shared idempotent queued-build finalizer"
    },
    {
      "contractId": "plan-dependency:mod-adopt-success-state-artifact-preservation->mod-startup-adoption-reconciliation:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-startup-adoption-reconciliation",
      "summary": "mod-adopt-success-state-artifact-preservation builds on Startup adoption and lock reconciliation"
    },
    {
      "contractId": "plan-dependency:mod-adopted-failure-cancel-control->mod-idempotent-queue-finalizer:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-idempotent-queue-finalizer",
      "summary": "mod-adopted-failure-cancel-control builds on Shared idempotent queued-build finalizer"
    },
    {
      "contractId": "plan-dependency:mod-adopted-failure-cancel-control->mod-startup-adoption-reconciliation:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-startup-adoption-reconciliation",
      "summary": "mod-adopted-failure-cancel-control builds on Startup adoption and lock reconciliation"
    },
    {
      "contractId": "plan-dependency:mod-startup-adoption-reconciliation->mod-idempotent-queue-finalizer:",
      "kind": "plan-dependency",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-idempotent-queue-finalizer",
      "summary": "mod-startup-adoption-reconciliation builds on Shared idempotent queued-build finalizer"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:.claude/skills/eforge-plugin-update-docs/SKILL.md",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": ".claude/skills/eforge-plugin-update-docs/SKILL.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-guardrails/index.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-guardrails/index.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopt-success-state-artifact-preservation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopt-success-state-artifact-preservation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-adopted-failure-cancel-control->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-adopted-failure-cancel-control",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-idempotent-queue-finalizer->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-idempotent-queue-finalizer",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:.pi/extensions/eforge-dev/README.md",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": ".pi/extensions/eforge-dev/README.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:docs/releasing.md",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "docs/releasing.md",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts",
      "summary": "shared-evidence-primary-owner"
    },
    {
      "contractId": "shared-file:mod-startup-adoption-reconciliation->mod-ac008-regression-coverage:eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "kind": "shared-file",
      "fromPlanId": "mod-startup-adoption-reconciliation",
      "toPlanId": "mod-ac008-regression-coverage",
      "path": "eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts",
      "summary": "shared-evidence-primary-owner"
    }
  ],
  "conflicts": []
}
```