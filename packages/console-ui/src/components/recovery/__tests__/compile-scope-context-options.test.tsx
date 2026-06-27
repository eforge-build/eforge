// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecoverySidecarRecoveryOption } from '@eforge-build/client/browser';
import { CompileScopeContextOptions } from '../compile-scope-context-options';

afterEach(cleanup);

describe('CompileScopeContextOptions', () => {
  it('renders read-only compile guidance', () => {
    const options: RecoverySidecarRecoveryOption[] = [{
      kind: 'compile-scope-context',
      action: 'bounded-decomposition',
      recommended: true,
      eligible: true,
      reason: 'Decompose the oversized PRD.',
      attempted: false,
      attempt: 0,
      maxAttempts: 1,
      source: 'provider',
      failureKind: 'context-window',
    }];

    render(<CompileScopeContextOptions options={options} />);

    expect(screen.getByText('Compile scope/context guidance')).toBeTruthy();
    expect(screen.getByText(/do not map to apply-recovery/i)).toBeTruthy();
    expect(screen.getByText(/bounded decomposition/)).toBeTruthy();
    expect(screen.getByText('Decompose the oversized PRD.')).toBeTruthy();
  });
});
