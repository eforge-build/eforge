/**
 * Accessibility reviewer perspective extension — demonstrates runtime reviewer perspective registration.
 *
 * This extension registers a custom reviewer perspective that runs during parallel
 * review-cycle perspective dispatch for plans that touch UI files (.tsx / .jsx files,
 * or .ts files under src/). When
 * applicable, it injects an accessibility-focused prompt fragment into the reviewer agent's
 * context, directing it to evaluate ARIA usage, keyboard navigation, color contrast, and
 * semantic HTML.
 *
 * Demonstrates:
 *
 * - `registerReviewerPerspective` registration
 * - Declarative `appliesTo.fileGlobs` applicability — the perspective runs automatically when the
 *   diff includes at least one matching file; no runtime function call is required
 * - Optional `appliesTo.fn` for richer context-aware applicability (commented out below)
 * - Read-only applicability context — perspectives cannot mutate orchestration state
 *
 * Runtime status: `registerReviewerPerspective` is runtime-supported. Perspectives execute
 * during parallel review-cycle perspective dispatch (`review.strategy: parallel`, or `auto`
 * once the diff crosses the parallel-review thresholds). Registration is captured at load time for provenance and
 * management tooling (eforge extension show, list, validate, test). Function-form applicability
 * timeouts and throws are fail-open: the perspective is skipped and an
 * `extension:reviewer-perspective:skipped` diagnostic is emitted rather than blocking the review.
 *
 * For the full API reference, see docs/extensions-api.md — `registerReviewerPerspective`.
 * For the conceptual overview, trust model, and applicability rules, see docs/extensions.md —
 * "Reviewer perspectives" section.
 */

import type { EforgeExtensionAPI } from '@eforge-build/extension-sdk';

export default function accessibilityPerspective(eforge: EforgeExtensionAPI): void {
  eforge.registerReviewerPerspective({
    key: 'accessibility',
    label: 'Accessibility Review',
    description:
      'Reviews UI components for WCAG compliance, ARIA attributes, keyboard navigation, semantic HTML, and color contrast.',

    promptFragment: `
## Accessibility review

Evaluate the changed UI components for accessibility compliance:

- **ARIA attributes**: verify role, aria-label, aria-describedby, and aria-hidden usage is correct and complete.
- **Keyboard navigation**: ensure interactive elements are reachable and operable via keyboard alone.
- **Semantic HTML**: prefer native elements (<button>, <a>, <nav>, <main>) over generic <div>/<span> with event listeners.
- **Color contrast**: flag hardcoded color values and note any risk of contrast-ratio violations.
- **Focus management**: confirm focus is managed correctly after dynamic content changes (modals, alerts, drawers).
- **Form labeling**: verify all form inputs have an associated <label> or aria-label.

Provide a summary of findings with file and line references. Use severity levels (critical / warning / suggestion).
`.trim(),

    // Declarative applicability: run only when the diff includes UI source files.
    // The perspective is skipped for plans that touch no matching paths.
    appliesTo: {
      fileGlobs: [
        '**/*.tsx',
        '**/*.jsx',
        'src/**/*.ts',
        'packages/*/src/**/*.ts',
      ],

      // Optional escape-hatch function: uncomment to add richer context-aware rules
      // on top of the declarative fileGlobs above. It runs only after all declarative rules pass.
      //
      // Receives (changedFiles: string[], changedLines: number). Return true to apply,
      // false to skip. Throws and timeouts are fail-open (perspective is skipped).
      //
      // fn: (changedFiles, _changedLines) => {
      //   // Skip accessibility review for test-only diffs.
      //   return changedFiles.some(
      //     (f) =>
      //       (f.endsWith('.tsx') || f.endsWith('.jsx')) &&
      //       !f.includes('__tests__') &&
      //       !f.endsWith('.test.tsx') &&
      //       !f.endsWith('.spec.tsx'),
      //   );
      // },
    },
  });
}
