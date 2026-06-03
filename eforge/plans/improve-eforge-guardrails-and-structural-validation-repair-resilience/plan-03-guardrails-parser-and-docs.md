---
id: plan-03-guardrails-parser-and-docs
name: Guardrails Parser, Examples, and Documentation
branch: improve-eforge-guardrails-and-structural-validation-repair-resilience/plan-03-guardrails-parser-and-docs
agents:
  builder:
    effort: high
    rationale: The plan combines a concrete project-team extension parser with
      public SDK documentation updates.
  doc-author:
    effort: high
    rationale: Public extension docs need contract, recovery, checkpoint, and
      greenfield/no-compatibility language aligned across several files.
---

# Guardrails Parser, Examples, and Documentation

## Architecture Context

Plans 01 and 02 provide the structured guidance contract and recovery engine. This plan makes the checked-in eforge guardrails extension the first concrete provider of structural guidance by parsing `pnpm maintainability:check` output into annotations. It also updates public docs and examples so extension authors see the new contract and the structural repair behavior.

The guardrails extension remains a project/team native extension. It must not loosen the maintainability gate or modify baseline ceilings; it only converts existing fail-closed output into machine-readable repair guidance.

## Implementation

### Overview

Parse file-size and region-marker violations from the maintainability script output. Return structured validation-provider annotations with repair class, fix text, retry guidance, failure kind, and metadata. Update docs and examples to describe the clean structured contract, command-form limitations, narrow versus structural routing, checkpoint artifacts, and evaluator gating.

### Key Decisions

1. **Regex parser for known output.** Parse `BASELINE EXCEEDED  <path>: <lines> lines (ceiling: <ceiling>)`, `CAP EXCEEDED  <path>: <lines> lines (<category> cap: <cap>)`, and the `Region marker balance violations:` section. If parsing finds no annotations, return a generic structured failure with the raw output in `details`.
2. **Structural default for file size.** File-size baseline and cap failures default to `repairClass: 'structural'`; guidance tells agents not to use comment shortening or dense formatting as the primary repair strategy.
3. **Narrow default for marker balance.** Region-marker balance annotations use a targeted repair class unless the parser cannot extract a file, in which case the provider falls back to a generic fail-closed failure.
4. **Metadata is small and numeric.** Include `currentLines`, `ceiling` or `cap`, `overflow`, `category`, and `thresholdType` for file-size annotations. Include parsed marker line and marker message where available for marker annotations.
5. **Docs align with shipped behavior.** Remove legacy string-failure guidance from function-form docs, document command-form generic recovery, and document checkpoint references and evaluator-mediated structural repair.

## Scope

### In Scope

- Maintainability output parser for baseline, cap, and region-marker output.
- Structured guidance annotations from `eforge/extensions/eforge-guardrails.ts`.
- Parser tests for known output and generic fallback.
- Public docs and examples for the new guidance contract and recovery behavior.
- Architecture/policy doc updates where they describe validation stages or maintainability repair guidance.

### Out of Scope

- Changes to `scripts/check-agent-maintainability.mjs` output format unless the parser tests prove the current output is insufficient.
- Changes to `scripts/agent-maintainability-baseline.json` ceilings.
- UI changes for rendering the new guidance fields.
- New extension-platform capabilities beyond validation providers.

## Files

### Create

- `eforge/extensions/guardrails/maintainability-parser.ts` — Parser and annotation builder for maintainability output, kept separate so tests can exercise it without executing the extension factory.
- `test/eforge-guardrails-maintainability.test.ts` — Parser tests for baseline exceeded, cap exceeded, region-marker output, and generic fallback.

### Modify

- `eforge/extensions/eforge-guardrails.ts` — Use the parser when `pnpm maintainability:check` fails and return structured annotations with details preserved.
- `examples/extensions/validation-provider.ts` — Ensure the example demonstrates guidance fields on at least one annotation if plan-01 did not already add the final example text.
- `examples/extensions/README.md` — Describe validation-provider guidance fields, command-form limitations, and structural repair behavior.
- `docs/extensions.md` — Update validation-provider conceptual docs: clean structured function-form contract, guidance fields, repair classes, recovery routing, checkpoint artifacts, and command-form generic failure behavior.
- `docs/extensions-api.md` — Update the API reference for `ValidationProviderResult`, annotation fields, return types, examples, failure semantics, and recovery behavior.
- `packages/extension-sdk/README.md` — Update the validation-provider summary and example text for structured guidance and structural repair semantics.
- `docs/architecture.md` — Update build-stage and agent architecture text if the in-build validation-fixer mode from plan-02 changes the stage descriptions.
- `docs/llm-friendly-code.md` — Add a concise maintainability repair note if policy language needs to state that file-size failures use extraction/splitting rather than line shaving.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — Update documentation assertions if they look for legacy validation-provider recovery text.

## Verification

- [ ] Parser output for `BASELINE EXCEEDED  packages/client/src/routes.ts: 628 lines (ceiling: 626)` contains one annotation with `failureKind: 'maintainability:file-size-baseline'`, `repairClass: 'structural'`, `metadata.currentLines: 628`, `metadata.ceiling: 626`, and `metadata.overflow: 2`.
- [ ] Parser output for `CAP EXCEEDED  src/new.ts: 612 lines (implementation cap: 600)` contains one annotation with `failureKind: 'maintainability:file-size-cap'`, `metadata.cap: 600`, and `metadata.category: 'implementation'`.
- [ ] Parser output for a region-marker balance section contains an annotation with `failureKind: 'maintainability:region-marker-balance'` when a file path is parseable.
- [ ] Unparseable non-empty maintainability output returns a structured failed result with raw output in `details` and no thrown exception.
- [ ] File-size guidance text contains the phrase `comment shortening` or an equivalent explicit prohibition against comment shortening and dense formatting as the primary repair strategy.
- [ ] `eforge/extensions/eforge-guardrails.ts` preserves the original maintainability output in `details` on failure.
- [ ] `docs/extensions.md`, `docs/extensions-api.md`, and `packages/extension-sdk/README.md` each contain `repairClass`, `retryGuidance`, `failureKind`, and `metadata` in the validation-provider section.
- [ ] Validation-provider docs no longer present non-empty string returns as a supported function-form failure path.
- [ ] Targeted tests pass: `pnpm test -- test/eforge-guardrails-maintainability.test.ts test/extension-sdk-example.test.ts test/extension-tooling-wiring-runtime-docs.test.ts`.
- [ ] Documentation drift gate passes: `pnpm docs:check`.
