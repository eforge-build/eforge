import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

function expectContainsAll(path: string, terms: readonly string[]) {
  const raw = read(path);
  for (const term of terms) {
    expect(raw, `${path} should contain ${term}`).toContain(term);
  }
}

function expectOmitsAll(path: string, terms: readonly string[]) {
  const raw = read(path);
  for (const term of terms) {
    expect(raw, `${path} should not contain ${term}`).not.toContain(term);
  }
}

describe('surfaces docs contracts', () => {
  it('documents oversized compile diagnostics and read-only recovery guidance', () => {
    expectContainsAll('web/content/docs/troubleshooting.md', [
      'Oversized PRDs and compile scope/context failures',
      'planning:scope-context:failure',
      'bounded-decomposition',
      'manual-reduce-scope',
      'repair-existing-artifacts',
      'read-only guidance',
      'do not create Console or daemon `apply-recovery` actions',
    ]);

    expectContainsAll('web/content/docs/glossary.md', [
      'Compile preflight',
      'Compile scope/context failure',
      'Recovery sidecar',
      'compile scope/context guidance',
      'do not map to `apply-recovery` mutations or Console apply buttons',
    ]);

    expectContainsAll('docs/architecture.md', [
      'planning:scope-context:failure',
      'typed compile-resilience diagnostics',
      'typed scope/context failure path',
    ]);
  });

  it('keeps generated public docs mirrors current for compile-resilience guidance', () => {
    for (const page of ['troubleshooting', 'glossary'] as const) {
      expect(read(`web/public/docs/${page}.md`)).toBe(read(`web/content/docs/${page}.md`));
    }

    expectContainsAll('web/public/llms-full.txt', [
      'Oversized PRDs and compile scope/context failures',
      'planning:scope-context:failure',
      'read-only guidance',
    ]);

    expectContainsAll('web/content/reference/events.md', [
      'planning:scope-context:failure',
    ]);
    expect(read('web/public/reference/events.md')).toBe(read('web/content/reference/events.md'));
  });

  it('keeps surface helpers on shared client contracts without daemon route literals', () => {
    expectContainsAll('packages/eforge/src/cli/compile-resilience-display.ts', [
      "from '@eforge-build/client'",
      'CompileScopeContextFailure',
    ]);
    expectContainsAll('packages/console-ui/src/lib/compile-resilience-format.ts', [
      "from '@eforge-build/client/browser'",
      'CompileScopeContextFailure',
      'RecoverySidecarRecoveryOption',
    ]);
    expectContainsAll('packages/console-ui/src/components/recovery/compile-scope-context-options.tsx', [
      "from '@eforge-build/client/browser'",
      'RecoverySidecarRecoveryOption',
      'do not map to apply-recovery',
    ]);

    for (const path of [
      'packages/eforge/src/cli/compile-resilience-display.ts',
      'packages/console-ui/src/lib/compile-resilience-format.ts',
      'packages/console-ui/src/components/recovery/compile-scope-context-options.tsx',
      'packages/console-ui/src/components/recovery/recovery-report-panel.tsx',
    ]) {
      expectOmitsAll(path, ['/api/']);
    }
  });

  it('keeps compile scope/context recovery guidance separate from mutating recovery actions', () => {
    expectContainsAll('packages/engine/src/recovery/sidecar-markdown.ts', [
      'Compile scope/context recovery guidance',
      'read-only compile guidance',
      'do not map to an `apply-recovery` mutation',
    ]);

    const recoveryPanel = read('packages/console-ui/src/components/recovery/recovery-report-panel.tsx');
    const actionBlock = recoveryPanel.slice(
      recoveryPanel.indexOf('const SIDECAR_ACTIONS'),
      recoveryPanel.indexOf('export function RecoveryReportPanel'),
    );
    expect(actionBlock).toContain('Retry from scratch');
    expect(actionBlock).toContain('Continue and repair build');
    expect(actionBlock).toContain('Archive failed PRD');
    expect(actionBlock).not.toContain('compile-scope-context');
    expect(actionBlock).not.toContain('retry-as-expedition');
    expect(actionBlock).not.toContain('bounded-decomposition');
  });
});
