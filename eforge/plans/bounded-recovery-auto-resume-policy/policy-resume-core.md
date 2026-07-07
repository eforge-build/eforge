---
id: policy-resume-core
name: Guarded resume policy
branch: bounded-recovery-auto-resume-policy/policy-resume-core
---

# Guarded resume policy

Implement the daemon-owned guarded auto-resume evaluator and resume queueing path. The first automatic attempt is allowed only when the policy is enabled, budget remains, recovery analysis recommends high-confidence `continue-repair`, compiled artifacts are eligible, and all safety preflights pass. Later automatic attempts after a prior auto-resume must additionally show material progress or a materially different failure signature; repeated identical failures stop with a visible reason instead of looping. Normalize recovery verdicts and stop with visible reasons on manual/retry/abandon decisions or active gates, holds, and approvals. When eligible, record attempt count, call existing resume/apply helpers, wake scheduling, and emit typed audit events.

## Traceability

Criteria: ac-002, ac-003, ac-004
Aspects: ac-002:subsystem:apply, ac-002:subsystem:resume, ac-002:subsystem:resumes, ac-002:subsystem:wakes, ac-003:evidence:gates-holds-approvals, ac-003:evidence:manual-retry-abandon, ac-004:general:general

## Validation

Tests cover disabled/no-budget negatives, low or medium confidence, non-`continue-repair` verdicts, partial or malformed sidecars, missing or ineligible artifacts, dirty/conflicting worktree or queue preflight blockers, conflicting applied markers, active gates/holds/approvals, budget exhaustion, repeated-signature stop, progress-making next attempts, and one positive attempt/enqueue/resume/wake/event-parse path.

## Fragment: Continue-repair apply/resume flow

Implement AC-002 only for the apply/resume leg. Add a bounded eligibility decision for enabled policy, remaining budget, high-confidence `continue-repair`, and eligible compiled artifacts. Record/increment the auto-resume attempt count before enqueue. Reuse existing resume/apply helpers for continue-and-repair queueing, then trigger the existing scheduler wake/resume path. Audit events must use the client-owned event schema/protocol from the shared event work and should capture the decision intent before mutation plus success/failure/stop after mutation. Evidence notes: the owned backlog-curation apply test excerpt is a separate eforge-plan apply subsystem and mainly provides validation-before-write patterns; the console pipeline resume test shows recovered PRD/plan artifacts already render when `planning:start` is absent; engine helper files are path-only evidence and must be inspected before edits.
## Fragment: Safety stop mapping

Map every unsafe or unsupported recovery outcome to a durable, user-visible stop reason. Required stops include exhausted budget, low/medium confidence, manual/retry/abandon verdicts, partial or malformed sidecars, missing or ineligible compiled artifacts, dirty/conflicting worktree or queue preflight blockers, existing conflicting applied markers, active manual gates/holds/approvals, and repeated identical failures after an automatic attempt. Preserve manual recovery availability when a stop reason is emitted.
## Fragment: Default-off policy and loop guard

Plan the recovery policy as a consumer of the config and event surfaces owned by prerequisite atoms. Under default configuration, retain current pause behavior for failed queued builds and avoid writing any auto-resume attempt/mutation state. When the policy is enabled, persist enough bounded state to compare attempt count, progress marker, and failure signature after an auto-resume attempt. The first attempt does not require prior progress evidence; schedule another attempt only when progress was made or the new failure differs materially and budget remains. Repeated signatures after an automatic attempt stop the loop and leave manual recovery available. Add focused tests for default-off, progress-making retry, budget exhaustion, and repeated-signature stop conditions.

## Recovery Guidance

- Failed PRD: "bounded-recovery-auto-resume-policy"
- Root failed plan: "policy-resume-core"
- Failure summary: "Compiled plan artifacts are eligible for continue-and-repair for bounded-recovery-auto-resume-policy. artifact source: feature-branch; 5 landed commit(s); failing plan: policy-resume-core; feature branch: eforge/bounded-recovery-auto-resume-policy. Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD."
- Failure detail: "2 blocking issue outcome(s) remain after 2 review round(s) (2 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Failure detail: "2 blocking issue outcome(s) remain after 2 review round(s) (2 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Recommended action: "Continue and repair build (Continue build): run `eforge continue-repair bounded-recovery-auto-resume-policy`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD."
- Remaining work:
  - "policy-resume-core: repair the unresolved blocking reviewer findings by persisting durable attempt intent before applyRecoveryContinueRepair without adding a branch-tip-only artifact preflight."
  - "policy-resume-core: if artifact preflight remains needed, delegate to the existing compiled-resume eligibility path covering feature branch, merge worktree, and branch-history artifact sources."
  - "visibility-provenance remains blocked by policy-resume-core and should proceed only after the core policy repair lands."
- Retry/resume guidance: Continue policy-resume-core for failed PRD bounded-recovery-auto-resume-policy from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.
- Sidecar generated at: 2026-07-07T21:20:44.666Z
- Source sidecar: .eforge/queue/failed/bounded-recovery-auto-resume-policy.recovery.json
- Source identity: prdId=bounded-recovery-auto-resume-policy; setName=bounded-recovery-auto-resume-policy; featureBranch=eforge/bounded-recovery-auto-resume-policy; baseBranch=main
