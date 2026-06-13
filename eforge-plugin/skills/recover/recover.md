---
description: Inspect the recovery verdict for a failed PRD and apply the recommended action (retry, continue-repair, abandon, or manual)
disable-model-invocation: true
---

# /eforge:recover

Inspect the recovery analysis for a failed PRD and act on the verdict — retry from scratch, continue and repair from preserved compiled artifacts, archive the original, or stop for manual replanning.

## Workflow

Call `mcp__eforge__eforge_queue_list` to discover failed PRDs, read the recovery sidecar to surface the verdict and rationale, confirm the action with the user, and then call the matching tool. Use `mcp__eforge__eforge_apply_recovery` for `retry` and `abandon`. Use `mcp__eforge__eforge_continue_repair` for the `continue-repair` action when preserved artifacts are eligible. Never auto-apply — always confirm.

## Steps

### Step 1: Identify the Failed PRD

If the user supplied a `<prdId>` argument, use it directly and skip to Step 2.

Otherwise, call `mcp__eforge__eforge_queue_list` (no parameters) and filter the response for items where `status === 'failed'`. Present the list to the user and ask which one to recover. If no failed PRDs are found, tell the user:

> No failed PRDs found. Use `/eforge:status` to check the current build state.

**Stop here** if no failed PRDs exist.

### Step 2: Read the Recovery Sidecar

Call `mcp__eforge__eforge_read_recovery_sidecar` with `{ prdId }`.

- If the tool returns a 404 or the response contains a `recoveryError` field, offer to run the recovery analysis:

> No recovery analysis found for `{prdId}`. Would you like me to run the analysis now? (yes / no)

  If the user agrees, call `mcp__eforge__eforge_recover` with `{ setName, prdId }` — source `setName` from the top-level sidecar `setName` field in a prior sidecar if available, otherwise ask the user to supply it. Then loop back to Step 2.

  If the user declines, stop here.

- If the sidecar is present, continue to Step 3.

### Step 3: Render the Verdict

Display the recovery report to the user:

**PRD**: `{prdId}`
**Verdict**: `{verdict}` (`retry` / `continue-repair` / `abandon` / `manual`)
**Confidence**: `{confidence}` (`low` / `medium` / `high`)

**Rationale**
{rationale}

**Completed work**
{completedWork — bullet list}

**Remaining work**
{remainingWork — bullet list}

**Risks**
{risks — bullet list}

Inspect sidecar-provided continue-and-repair fields. If `continueRepairEligibility.eligible === true` or `recoveryOptions` contains a recommended continue-and-repair option such as `{ kind: "continue-repair", action: "continue-repair", recommended: true }`, present exactly one primary action:

> This recovery sidecar recommends **Continue and repair build** from preserved compiled artifacts. Continue with `mcp__eforge__eforge_continue_repair`? (yes / no)

If `continueRepairEligibility.eligible === false`, show the bounded reason and do not recommend continue-and-repair. The mutating `mcp__eforge__eforge_continue_repair` tool validates eligibility server-side if the user explicitly asks to try after reviewing the warning.

Do not author replacement PRD content from the recovery sidecar. If the verdict is `manual`, render the full report and use the manual guidance below.

### Step 4: Confirm the Action

Ask the user to confirm the verdict-specific action:

- `retry`: "Retry PRD `{prdId}` from scratch? (yes / no)"
- `continue-repair`: "Continue and repair build `{prdId}` from preserved compiled artifacts with `mcp__eforge__eforge_continue_repair`? (yes / no)"
- `abandon`: "Archive the failed PRD `{prdId}` (this cannot be undone)? (yes / no)"
- `manual`: Render the full markdown report and stop. Tell the user:

> This verdict requires manual review / manual replanning. Review the report above, decide the bounded repair plan outside of eforge, and enqueue any replacement work deliberately. No automated apply-recovery action is available for the `manual` verdict.

**Stop here** for `manual`. Do not call `mcp__eforge__eforge_apply_recovery`; if it were called it would return `{ verdict: 'manual', noAction: true }` and no mutation would occur.

### Step 5: Apply the Recovery

On confirmation, call the appropriate tool:

- **retry**: Call `mcp__eforge__eforge_apply_recovery` with `{ prdId }`. Report: "PRD `{prdId}` has been queued to retry from scratch."
- **continue-repair**: Call `mcp__eforge__eforge_continue_repair` with `{ prdId }`, adding `setName` when the sidecar top-level `setName` differs from the PRD id and `profile` when the user requests a specific agent runtime profile. Report: "Queued continue-and-repair build for PRD `{prdId}`. It will wait for scheduler dispatch under the current queue controls."
- **abandon**: Call `mcp__eforge__eforge_apply_recovery` with `{ prdId }`. Report: "PRD `{prdId}` has been archived."

A dispatched continue-and-repair build preserves normal queue controls: parallelism, pause state, dependency gating, and profile routing. It returns queued metadata such as the PRD id, set name, branches, moved descendants, and optional profile; it does not return a session id or PID.

## When to Choose Continue and Repair vs Retry from Scratch

| Situation | Recommended action |
|-----------|-------------------|
| Sidecar recommends continue-and-repair from preserved compiled artifacts | Prefer `mcp__eforge__eforge_continue_repair` after confirmation |
| PRD failed early before compiled artifacts were preserved | Use `retry` via `mcp__eforge__eforge_apply_recovery` |
| Compiled artifacts are stale or the plan has changed significantly | Use `retry` via `mcp__eforge__eforge_apply_recovery` to start fresh |
| The report cannot determine a safe automated action | Stop for manual review / manual replanning |
| User wants to archive the failed PRD without further attempts | Use `abandon` via `mcp__eforge__eforge_apply_recovery` |

## Error Handling

| Condition | Action |
|-----------|--------|
| `eforge_read_recovery_sidecar` returns 404 | Offer to call `eforge_recover` to generate the verdict (Step 2) |
| Sidecar contains `recoveryError` | Offer to re-run `eforge_recover` to regenerate (Step 2) |
| `eforge_apply_recovery` fails | Surface the daemon error message verbatim; do not retry automatically |
| `eforge_continue_repair` fails | Surface the daemon error message verbatim; do not retry automatically |
<!-- parity-skip-start -->
| Tool unavailable | Warn that eforge MCP tools are not available; suggest checking plugin configuration |
<!-- parity-skip-end -->

## Related Skills

| Skill | Command | When to suggest |
|-------|---------|----------------|
| Status | `mcp__eforge__eforge_queue_list` | Check which PRDs are failed before recovering |
| Build | `/eforge:build` | Enqueue new work after a successful recovery |
| Plan | `/eforge:plan` | Plan replacement work before queuing it |
