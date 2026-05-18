# Recovery Analysis: improve-monitor-daemon-scheduler-fsm-card-reporting

**Generated:** 2026-05-18T15:22:45.835Z
**Set:** improve-monitor-daemon-scheduler-fsm-card-reporting
**Feature Branch:** `eforge/improve-monitor-daemon-scheduler-fsm-card-reporting`
**Base Branch:** `main`
**Failed At:** 2026-05-18T15:22:18.755Z

## Verdict

**RETRY** (confidence: high)

## Rationale

The only plan that ran was `compile` (the planner), and it failed with "Backend error: WebSocket closed 1000" — a WebSocket normal-closure code indicating a dropped connection to the AI backend, not a logic or code error. No commits landed on the feature branch (`landedCommits: []`, `diffStat: ""`), so there is no partial state to preserve or reason to split. The PRD is fully intact and unstarted. WebSocket close 1000 during an agent turn is a well-known transient infrastructure condition (network interruption, backend timeout, or server-side session expiry). The same PRD can be retried as-is without modification.

## Plans

| Plan | Status | Error |
|------|--------|-------|
| compile | failed | Backend error: WebSocket closed 1000 |

## Failing Plan

**Plan ID:** compile
**Error:** Backend error: WebSocket closed 1000

## Models Used

- gpt-5.5

## Completed Work

- No plans completed — the planner (compile) was the only plan and it failed before producing any output or commits

## Remaining Work

- All acceptance criteria from the original PRD remain unimplemented: rename Scheduler FSM card row label to "Last queue wake-up"
- Friendly wake-up reason label mapping (enqueue, playbook-enqueue, apply-recovery, external)
- Missing wake-up reason fallback display: "none since startup"
- Extend shared client wire type/schema for optional scheduler capacity fields (runningCount, limit)
- Populate capacity fields in daemon auto-build snapshot and heartbeat projection paths
- Capacity display in UI as "N/M running"
- Heartbeat handling to refresh canonical daemonState.autoBuild with scheduler details
- Tests: drawer rendering, reducer/hook heartbeat behavior, client schema, daemon/server projection
- API version bump if wire contract changes
- Documentation updates if applicable

## Risks

- If the WebSocket drop was caused by a sustained backend issue (quota, model unavailability for gpt-5.5), the retry may fail again — but no evidence of this beyond a single transient close event
