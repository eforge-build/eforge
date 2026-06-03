---
id: plan-01-validation-guidance-contract
name: Validation Guidance Contract and Normalization
branch: improve-eforge-guardrails-and-structural-validation-repair-resilience/plan-01-validation-guidance-contract
agents:
  builder:
    effort: high
    rationale: Public SDK and client wire-shape changes require careful type and
      runtime normalization updates.
  reviewer:
    effort: high
    rationale: Review needs to check SDK, engine, and client schema alignment.
---

# Validation Guidance Contract and Normalization

## Architecture Context

Validation-provider data crosses three ownership boundaries: public extension SDK types, engine runtime normalization, and client-owned event/review issue wire schemas. This plan establishes the typed guidance shape first so later recovery routing can consume structured fields without parsing prose.

The client package remains the source of truth for `ReviewIssue`. Engine-local schemas that prompt reviewers must remain compatible, but validation-provider guidance originates from extension results and is mapped into review issues by the engine.

## Implementation

### Overview

Introduce a clean structured validation-provider guidance contract, preserve guidance during normalization, and carry it into `ReviewIssue` instances. Function-form validation providers return `ValidationProviderResult | null | undefined`; non-empty string failures are no longer part of the SDK contract and become deterministic unexpected-return failures in the runtime. Command-form providers remain supported as generic subprocess gates.

### Key Decisions

1. **Guidance lives on annotations.** Add a named annotation/guidance interface with `severity`, `message`, optional `file`, optional `line`, optional `details`, optional `fix`, optional `retryGuidance`, optional provider-authored `failureKind`, optional `repairClass`, and optional JSON-safe `metadata`.
2. **Closed repair classes.** Define and export `ValidationRepairClass = 'narrow' | 'structural' | 'manual' | 'followup'` in the SDK; use the same set in engine/client schemas.
3. **Separate runtime and domain failure kinds.** Rename or alias the engine runtime classification to `runtimeFailureKind` in normalized results, leaving annotation `failureKind` for provider-authored domain signatures.
4. **Reject invalid metadata deterministically.** Accept only bounded JSON-safe metadata. Omit invalid metadata from the normalized annotation, keep the validation failure, and append or expose a deterministic metadata rejection reason so the failure is not lost.
5. **Client owns wire shape.** Extend `packages/client/src/events.schemas.ts` for review issues instead of declaring a parallel validation issue shape in the engine.

## Scope

### In Scope

- SDK type changes for validation-provider annotations and return types.
- Runtime normalization for guidance fields, bounded JSON-safe metadata, and runtime/provider failure-kind separation.
- Review issue schema/type additions for validation guidance fields.
- Guidance mapping from normalized validation annotations to `ReviewIssue` objects.
- Prompt issue formatting that includes validation guidance for repair agents.
- Updating in-repo validation-provider example/test fixtures away from non-empty string failure returns.

### Out of Scope

- Structural repair routing and checkpoint artifacts; plan-02 consumes this contract.
- Maintainability output parsing; plan-03 adds the concrete guardrails provider parser.
- Console UI rendering changes beyond type/schema compatibility.

## Files

### Create

- None expected.

### Modify

- `packages/extension-sdk/src/hooks.ts` — Add `ValidationRepairClass`, JSON-safe metadata type aliases, a named validation annotation/guidance interface, and update `ValidationProviderResult` / function return types to remove non-empty string failure returns.
- `packages/extension-sdk/src/api.ts` — Update `registerValidationProvider` comments to describe structured function-form results and command-form generic failures.
- `packages/extension-sdk/src/index.ts` — Export the new validation guidance and repair-class types.
- `packages/engine/src/extensions/types.ts` — Mirror or type-import the SDK validation-provider shape used by recorder/runtime code.
- `packages/engine/src/extensions/validation-provider-runtime.ts` — Preserve `details`, `fix`, `retryGuidance`, provider `failureKind`, `repairClass`, and bounded JSON-safe `metadata`; distinguish `runtimeFailureKind`; treat non-empty string returns as unexpected return shapes.
- `packages/engine/src/pipeline/stages/validation-provider-recovery.ts` — Update current recoverability checks and guidance-to-review-issue mapping for the new normalized fields.
- `packages/client/src/events.schemas.ts` — Extend `ReviewIssueSchema` with optional `retryGuidance`, provider `failureKind`, `repairClass`, `metadata`, `validationProviderName`, and runtime validation failure kind fields.
- `packages/engine/src/schemas.ts` — Keep engine review issue schemas compatible with the optional guidance fields where reviewer/evaluator schema YAML is generated.
- `packages/engine/src/agents/review-fixer.ts` — Render validation guidance fields in the issue list passed to the fixer prompt.
- `examples/extensions/validation-provider.ts` — Use only structured result/null returns and include at least one example annotation carrying guidance fields.
- `test/validation-provider-runtime.test.ts` — Cover guidance preservation, metadata acceptance/rejection, and string-return rejection.
- `test/validation-provider-recovery-stage.test.ts` — Cover guidance-to-review-issue mapping and updated runtime failure-kind field names.
- `test/validation-provider-build-stage.test.ts` — Replace legacy string-failure fixtures with structured failed results and update expectations for string unexpected-return behavior if covered.
- `packages/client/src/__tests__/events-schemas-review-cycle.test.ts` or a focused client schema test — Verify `ReviewIssue` accepts valid guidance and rejects out-of-set `repairClass`.
- `test/schemas.test.ts` — Update schema YAML expectations if guidance fields are exposed in engine review issue schemas.

## Verification

- [ ] `normalizeValidationResult({ status: 'failed', annotations: [...] })` preserves `details`, `fix`, `retryGuidance`, provider `failureKind`, `repairClass`, and valid JSON metadata.
- [ ] `normalizeValidationResult('failure text')` returns a failed unexpected-return result, not a recoverable result failure.
- [ ] Invalid metadata leaves the validation result failed and produces a deterministic metadata rejection signal in the normalized annotation or details.
- [ ] `validationFailureToReviewIssues` maps provider guidance fields into `ReviewIssue` fields without mixing provider `failureKind` with runtime failure classification.
- [ ] Client event schema parsing accepts a review issue with `repairClass: 'structural'` and rejects a review issue with `repairClass: 'random'`.
- [ ] `examples/extensions/validation-provider.ts` imports through `test/extension-sdk-example.test.ts` with no non-empty string failure return type.
- [ ] Targeted tests pass: `pnpm test -- test/validation-provider-runtime.test.ts test/validation-provider-recovery-stage.test.ts test/validation-provider-build-stage.test.ts test/extension-sdk-example.test.ts`.
