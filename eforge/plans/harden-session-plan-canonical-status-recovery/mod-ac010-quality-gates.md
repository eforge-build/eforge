---
id: mod-ac010-quality-gates
name: AC-010 quality gates
branch: harden-session-plan-canonical-status-recovery/mod-ac010-quality-gates
---

# AC-010 quality gates

Run final repository quality gates and remediate any failures without broad rewrites.

## Traceability

Criteria: ac-010
Aspects: ac-010:interface:test, ac-010:subsystem:test

## Validation

`pnpm test`, `pnpm type-check`, and `pnpm maintainability:check` each exit 0.

## Fragment: Run final AC-010 quality gates

Validate AC-010 by running the root quality gates after the session-plan canonical status recovery work is integrated:

- `pnpm test`
- `pnpm type-check`
- `pnpm maintainability:check`

If any gate fails, make the smallest targeted fixes needed to restore the gate. Treat this as existing-suite exercise/repair rather than authoring new documentation or new test coverage unless a failure specifically proves a missing test fixture must be updated.