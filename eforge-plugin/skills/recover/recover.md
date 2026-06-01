---
description: Inspect the recovery verdict for a failed PRD and apply the recommended action (retry, split, abandon, resume from compiled artifacts, or manual)
disable-model-invocation: true
---

# /eforge:recover

Inspect the recovery analysis for a failed PRD and act on the verdict — re-queue, split into a successor PRD, resume from compiled artifacts, or archive the original.

## Workflow

Call `mcp__eforge__eforge_queue_list` to discover failed PRDs, read the recovery sidecar to surface the verdict and rationale, confirm the action with the user, and call `mcp__eforge__eforge_apply_recovery` to execute. For compiled-build resume, call `mcp__eforge__eforge_resume_build` after confirmation. Never auto-apply — always confirm.

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

  If the user agrees, call `mcp__eforge__eforge_recover` with `{ setName, prdId }` — source `setName` from `summary.setName` in a prior sidecar if available, otherwise ask the user to supply it. Then loop back to Step 2.

  If the user declines, stop here.

- If the sidecar is present, continue to Step 3.

### Step 3: Render the Verdict

Display the recovery report to the user:

**PRD**: `{prdId}`
**Verdict**: `{verdict}` (`retry` / `split` / `abandon` / `manual`)
**Confidence**: `{confidence}` (`low` / `medium` / `high`)

**Rationale**
{rationale}

**Completed work**
{completedWork — bullet list}

**Remaining work**
{remainingWork — bullet list}

**Risks**
{risks — bullet list}

If the verdict is `split`, also show:

**Suggested successor PRD**
```
{suggestedSuccessorPrd}
```

Also check whether the PRD has compiled artifacts and a feature branch. If it does, present the compiled-build resume option alongside the verdict-recommended action:

> This PRD has compiled artifacts on a feature branch. You may either follow the verdict action above or resume the build from its compiled artifacts using `mcp__eforge__eforge_resume_build`. Which would you prefer?

### Step 4: Confirm the Action

Ask the user to confirm the verdict-specific action or the resume option:

- `retry`: "Re-queue PRD `{prdId}` for another attempt? (yes / no)"
- `split`: "Enqueue a successor PRD based on the suggested content above? (yes / no)"
- `abandon`: "Archive the failed PRD `{prdId}` (this cannot be undone)? (yes / no)"
- `manual`: Render the full markdown report and stop. Tell the user:

> This verdict requires manual intervention. Review the report above and take action outside of eforge. No automated action is available for the `manual` verdict.

**Stop here** for `manual`. Do not call `eforge_apply_recovery`. If it were called it would return `{ verdict: 'manual', noAction: true }` — no mutation occurs.

- **resume**: "Resume PRD `{prdId}` from its compiled artifacts? (yes / no)"

### Step 5: Apply the Recovery

**Verdict-based recovery**: On confirmation for `retry`, `split`, or `abandon`, call `mcp__eforge__eforge_apply_recovery` with `{ prdId }`.

The daemon applies the action in-process and returns synchronously. Report the result using the returned response fields:

- **retry**: "PRD `{prdId}` has been re-queued. Commit: `{commitSha}`."
- **split**: "Successor PRD `{successorPrdId}` enqueued. Commit: `{commitSha}`."
- **abandon**: "PRD `{prdId}` has been archived. Commit: `{commitSha}`."

**Compiled-build resume**: On confirmation for resume, call `mcp__eforge__eforge_resume_build` with `{ prdId }`, adding `setName` when the sidecar reports a set name that differs from the PRD id and `profile` when the user requests a specific agent runtime profile. The daemon validates the profile override before spawning a background build agent and returns `{ sessionId, pid }`. Report:

> Resuming build for PRD `{prdId}`. Session ID: `{sessionId}`, PID: `{pid}`.

## When to Choose Compiled-Build Resume vs PRD-Level Retry

| Situation | Recommended action |
|-----------|-------------------|
| PRD failed early (before compile stage) — no artifacts | Use `retry` or `split` via `mcp__eforge__eforge_apply_recovery` |
| PRD failed after compile — feature branch exists with partial work | Consider `mcp__eforge__eforge_resume_build` to pick up from compiled artifacts |
| Compiled artifacts are stale or the plan has changed significantly | Use `retry` via `mcp__eforge__eforge_apply_recovery` to start fresh |
| User wants to archive the failed PRD without further attempts | Use `abandon` via `mcp__eforge__eforge_apply_recovery` |

## Error Handling

| Condition | Action |
|-----------|--------|
| `eforge_read_recovery_sidecar` returns 404 | Offer to call `eforge_recover` to generate the verdict (Step 2) |
| Sidecar contains `recoveryError` | Offer to re-run `eforge_recover` to regenerate (Step 2) |
| `eforge_apply_recovery` fails | Surface the daemon error message verbatim; do not retry automatically |
| `eforge_resume_build` fails | Surface the daemon error message verbatim; do not retry automatically |
<!-- parity-skip-start -->
| Tool unavailable | Warn that eforge MCP tools are not available; suggest checking plugin configuration |
<!-- parity-skip-end -->

## Related Skills

| Skill | Command | When to suggest |
|-------|---------|----------------|
| Status | `mcp__eforge__eforge_queue_list` | Check which PRDs are failed before recovering |
| Build | `/eforge:build` | Enqueue new work after a successful recovery |
| Plan | `/eforge:plan` | Plan a replacement PRD before re-queuing |
