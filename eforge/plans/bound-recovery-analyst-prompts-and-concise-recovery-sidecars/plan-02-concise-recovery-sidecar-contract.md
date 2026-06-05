---
id: plan-02-concise-recovery-sidecar-contract
name: Concise Recovery Sidecar Contract and Consumers
branch: bound-recovery-analyst-prompts-and-concise-recovery-sidecars/plan-02-concise-recovery-sidecar-contract
agents:
  builder:
    effort: high
    rationale: This plan changes a current wire/file contract and all TypeScript
      consumers in one pass to avoid intermediate type drift.
  reviewer:
    effort: high
    rationale: Review must check the sidecar contract migration, API version bump,
      and current consumer updates across engine, monitor, Console, and skills.
---

# Concise Recovery Sidecar Contract and Consumers

## Architecture Context

Recovery sidecars are written by the engine, read by engine recovery actions/resume paths, served by the monitor daemon, projected into queue items, and rendered in Console. The current JSON sidecar stores a full `BuildFailureSummary`, while the Markdown report renders broad audit-style sections in fixed order. This plan replaces that current contract with a concise v3 sidecar and updates current consumers directly. Legacy v1/v2 compatibility branches are not required for this greenfield change.

`@eforge-build/client` owns daemon wire shapes, so the TypeScript shape for the sidecar read response must be updated in `packages/client/src/routes/recovery.ts` before engine, monitor, or Console code consumes it. The engine writer must import that client-owned shape rather than redefining the daemon wire contract elsewhere.

## Implementation

### Overview

Write recovery sidecars as concise operator artifacts:

- JSON sidecar: current schema v3 with `verdict`, `report`, and `boundedEvidence`; no required old full-summary dump.
- Markdown sidecar: operator summary first, detailed bounded evidence below.
- Current readers: parse v3, project the bounded evidence needed by apply/resume/accepted-success flows, and fail current-shape validation for malformed sidecars.
- Console/monitor/API fixtures: use v3 fields.

### Key Decisions

1. Keep top-level `verdict` and optional `applied` in the sidecar JSON because queue projections, apply idempotency, and Console completion flows depend on those current concepts.
2. Replace top-level `summary` with top-level identity plus `boundedEvidence`. Engine flows that need a `BuildFailureSummary` receive a projection from the current v3 sidecar, not a legacy compatibility branch.
3. Move raw-ish evidence below `## Detailed Evidence` in Markdown and bound all large text previews with markers.
4. Bump `DAEMON_API_VERSION` because `GET /api/recovery/sidecar` returns a breaking JSON shape for first-party clients.
5. Update Claude Code and Pi recovery skills together because both tell users where to source the set name from a sidecar. Bump the Claude Code plugin version; do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope

- Define the current v3 recovery sidecar shape in `@eforge-build/client`.
- Update `writeRecoverySidecar()` to write v3 JSON and operator-first Markdown.
- Add engine sidecar read/projection helpers for current v3 sidecars.
- Update engine apply, resume, accepted-success, and queued-resume metadata reads to consume current v3 fields.
- Update monitor recovery sidecar route parsing and apply-read plumbing for v3.
- Update Console recovery dialog fixtures and set-name reads for v3.
- Update plugin/Pi recovery skill text that references `summary.setName`.
- Update tests and seed fixtures that construct recovery sidecar JSON.

### Out of Scope

- Legacy v1/v2 recovery sidecar compatibility shims.
- Console layout redesign beyond fields required by the new current sidecar contract.
- Deterministic fallback policy changes.
- Provider-specific prompt budgeting.

## Files

### Create

- `packages/engine/src/recovery/sidecar-payload.ts` — builds `RecoveryVerdictSidecar` v3 payloads from `{ prdId, summary, verdict, generatedAt }`, using `text-bounds.ts` from plan 01 for bounded evidence.
- `packages/engine/src/recovery/sidecar-markdown.ts` — renders operator-first Markdown from the v3 payload.
- `packages/engine/src/recovery/sidecar-read.ts` — reads/parses v3 sidecar JSON, validates the current shape, returns verdict/identity, and projects `boundedEvidence` into the minimal `BuildFailureSummary` required by current engine flows.

### Modify

- `packages/client/src/routes/recovery.ts` — replace `RecoveryVerdictSidecar` with the v3 contract:
  - `schemaVersion: number`
  - `generatedAt: string`
  - `prdId: string`
  - `setName: string`
  - `verdict: RecoveryVerdict`
  - `report: RecoverySidecarReport`
  - `boundedEvidence: RecoverySidecarBoundedEvidence`
  - `applied?: RecoveryAppliedMetadata`
- `packages/client/src/api-version-const.ts` — increment `DAEMON_API_VERSION` from 55 to 56 and document the recovery sidecar v3 response change.
- `packages/engine/src/recovery/sidecar.ts` — make this file a thin atomic writer that calls the payload and Markdown helpers; update header comments to schema v3.
- `packages/engine/src/recovery/applied-sidecar.ts` — update comments to mention v3 fields preserved when writing `applied` markers.
- `packages/engine/src/eforge.ts` — bounded exact edits only: in `applyRecovery()`, read the v3 sidecar via `sidecar-read.ts`, validate the verdict, derive failing-plan attribution from bounded evidence, and pass the projected summary into split recovery.
- `packages/engine/src/recovery/accept-success.ts` — load current v3 sidecar identity/evidence instead of requiring `summary`; keep eligibility checks using projected acceptance/terminal/validation evidence.
- `packages/engine/src/resume/compiled-build.ts` — resolve set name from top-level `setName` and use bounded evidence identity for feature/base branch fallbacks.
- `packages/engine/src/resume/queued-resume.ts` — read the current v3 sidecar projection instead of `parsed.summary`.
- `packages/monitor/src/routes/recovery-sidecar-service.ts` — parse v3 sidecars, validate `verdict`, `report`, and `boundedEvidence`, preserve valid `applied` metadata, and return the client-owned `RecoveryVerdictSidecar` shape.
- `packages/monitor/src/projections/queue-items.ts` — keep verdict/applied projection reading from top-level v3 fields; update comments/tests if needed.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — validate `json.verdict.verdict` and top-level `json.setName`; remove `json.summary.setName` assumptions.
- `packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx` — update sidecar fixtures to v3.
- `packages/console-ui/README.md` — update recovery-report data-flow text if it names the old JSON summary shape.
- `eforge-plugin/skills/recover/recover.md` — replace `summary.setName` guidance with the new top-level sidecar `setName` guidance.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version because the plugin skill text changes.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — mirror the recovery skill guidance change; do not bump the Pi package version.

### Test and Fixture Updates

Update affected fixtures and assertions in these files as needed:

- `test/recovery-sidecars.test.ts`
- `test/recovery-engine.test.ts`
- `test/daemon-recovery-engine-fallback.test.ts`
- `test/daemon-recovery-sidecars.test.ts`
- `test/daemon-recovery-routes.test.ts`
- `test/apply-recovery.test.ts`
- `test/apply-recovery-route.test.ts`
- `test/apply-recovery-accept-success.test.ts`
- `test/resume-build-route.test.ts`
- `test/resume-eligibility-route.test.ts`
- `test/resume-compiled-build-engine.test.ts`
- `test/serve-queue-recovery-verdict.test.ts`
- `packages/monitor/src/__tests__/routes-recovery.test.ts`
- `packages/monitor/src/__tests__/projections-queue-items.test.ts`
- `packages/monitor/src/__tests__/stream-hello-parity.test.ts`
- `packages/monitor/src/__tests__/routes-monitor-data-streams-acceptance.test.ts`
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx`

## v3 JSON Shape Details

Recommended client-owned interfaces:

```ts
export interface RecoverySidecarReport {
  operatorSummary: string;
  recommendedAction: string;
  rootFailure?: {
    planId?: string;
    scope?: string;
    stage?: string;
    message?: string;
  };
  keyEvidence: string[];
  completedWork: string[];
  remainingWork: string[];
  risks: string[];
  evidenceOmissions?: string[];
}

export interface RecoverySidecarBoundedEvidence {
  identity: {
    prdId: string;
    setName: string;
    featureBranch: string;
    baseBranch: string;
    failedAt: string;
    partial?: boolean;
  };
  plans: Array<{ planId: string; status: string; error?: string; terminalSubtype?: string; commitSha?: string }>;
  failingPlan: { planId: string; errorMessage?: string; terminalSubtype?: string };
  failingPlans?: Array<{ planId: string; errorMessage?: string; terminalSubtype?: string }>;
  landedCommits: Array<{ sha: string; subject: string; author: string; date: string }>;
  modelsUsed: string[];
  terminalFailure?: Record<string, string | boolean | number | undefined>;
  acceptanceValidation?: {
    passed: boolean;
    total: number;
    pass: number;
    fail: number;
    unknown: number;
    verdicts: Array<{ criterion: string; verdict: 'pass' | 'fail' | 'unknown'; evidence: string }>;
    omittedEvidenceCount?: number;
  };
  validationCommands?: Array<{ command: string; exitCode: number; outputPreview?: string; truncated?: boolean }>;
  landing?: { status: string; action?: string; reason?: string };
  reviewFailure?: unknown;
  diffStat?: string;
  evidenceOmissions?: string[];
}
```

The exact type names can vary, but the current contract must expose the same concepts: identity, verdict, operator report, bounded evidence, generated timestamp, schema version, and optional applied marker.

## Markdown Layout Details

Render Markdown in this order:

1. Title and generated/identity metadata.
2. `## Operator Summary` with verdict, confidence, verdict source when present, root failure scope/stage/plan when present, and recommended next action.
3. `## Recommended Action` or a subsection inside operator summary containing one short action sentence derived from verdict and fallback metadata.
4. `## Key Evidence` with bounded bullets.
5. `## Completed Work`, `## Remaining Work`, and `## Risks` with bounded bullets from the verdict.
6. `## Suggested Successor PRD` for split verdicts.
7. `## Detailed Evidence` containing plan tables, failing plans, review failure details, landed commits, models used, terminal failure, acceptance validation evidence, validation command previews, landing status, and diff stat.

All raw-ish detailed evidence fields must use bounded previews with visible truncation or omission markers.

## Verification

- [ ] Generated JSON sidecars contain `schemaVersion: 3`, `generatedAt`, top-level `prdId`, top-level `setName`, top-level `verdict`, `report`, and `boundedEvidence`.
- [ ] Generated JSON sidecars omit the old required full-summary dump shape; tests do not assert `json.summary` for current sidecars.
- [ ] Generated JSON sidecars contain verdict data, operator-facing report data, and bounded evidence data.
- [ ] Generated JSON sidecars exclude the full oversized validation-command output sentinel and include a truncation or omission marker for that evidence.
- [ ] Markdown sidecars contain the verdict, confidence, verdict source when present, terminal failure scope or stage when present, and recommended next action in the first 80 non-empty lines.
- [ ] Markdown sidecars place plan tables, acceptance-validation evidence, validation-command previews, review-failure details, and diff stat below `## Detailed Evidence`.
- [ ] Markdown sidecars exclude the full oversized validation-command output sentinel and include a visible truncation or omission marker.
- [ ] Monitor `GET /api/recovery/sidecar` returns the v3 `RecoveryVerdictSidecar` shape and preserves valid `applied` metadata.
- [ ] Engine apply recovery reads v3 sidecars and emits `plan:build:decision` using the projected failing plan ID.
- [ ] Split recovery apply receives a projected summary containing set name, feature branch, base branch, landed commits, plans, and failing plan evidence from v3 bounded evidence.
- [ ] Accepted-success preview/apply reads v3 sidecars and evaluates eligibility from bounded acceptance, terminal failure, landed commit, and validation command evidence.
- [ ] Resume set-name resolution reads top-level `setName` from v3 sidecars.
- [ ] Queue item projection still exposes `recoveryVerdict` and `recoveryApplied` from v3 sidecars.
- [ ] Console recovery dialog accepts v3 fixtures and reads set name from top-level `json.setName`.
- [ ] Deterministic fallback tests still produce manual/split fallback verdicts when the analyst throws, returns unparsable output, or returns an invariant-invalid verdict.
- [ ] `DAEMON_API_VERSION` is 56 and its comment names the recovery sidecar v3 response change.
- [ ] Claude Code and Pi recovery skill text both refer to the new sidecar `setName` location.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` patch version is incremented.
- [ ] `packages/pi-eforge/package.json` is unchanged.
- [ ] `pnpm vitest run test/recovery-sidecars.test.ts test/daemon-recovery-engine-fallback.test.ts test/daemon-recovery-sidecars.test.ts test/daemon-recovery-routes.test.ts test/apply-recovery.test.ts test/apply-recovery-route.test.ts test/apply-recovery-accept-success.test.ts test/resume-build-route.test.ts test/resume-eligibility-route.test.ts test/resume-compiled-build-engine.test.ts test/serve-queue-recovery-verdict.test.ts packages/monitor/src/__tests__/routes-recovery.test.ts packages/monitor/src/__tests__/projections-queue-items.test.ts packages/monitor/src/__tests__/stream-hello-parity.test.ts packages/monitor/src/__tests__/routes-monitor-data-streams-acceptance.test.ts packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` exits 0.