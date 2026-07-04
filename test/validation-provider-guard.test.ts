import { describe, expect, it } from 'vitest';
import type { BuildStageSpec } from '@eforge-build/engine/config';
import type { ValidationProviderRegistration } from '@eforge-build/engine/extensions';
import { applyValidationProviderGuard } from '@eforge-build/engine/validation-provider-guard';

const provider = { kind: 'validationProvider', name: 'guard-test-provider', extensionName: 'test-extension', extensionPath: '/tmp/test-extension', value: { commands: ['true'] } } as unknown as ValidationProviderRegistration;

describe('validation provider runtime guard', () => {
  it('is a no-op when no providers are loaded', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];

    expect(applyValidationProviderGuard(build, undefined)).toEqual({ planBuild: build, injected: false });
    expect(applyValidationProviderGuard(build, [])).toEqual({ planBuild: build, injected: false });
  });

  it('injects validate before review-cycle when providers are loaded', () => {
    const { planBuild, injected } = applyValidationProviderGuard(['implement', 'review-cycle'], [provider]);

    expect(injected).toBe(true);
    expect(planBuild).toEqual(['implement', 'validate', 'review-cycle']);
  });

  it('injects validate before a review-cycle inside a parallel group', () => {
    const { planBuild } = applyValidationProviderGuard([['implement', 'doc-author'], 'doc-sync', ['review-cycle', 'test-cycle']], [provider]);

    expect(planBuild).toEqual([['implement', 'doc-author'], 'doc-sync', 'validate', ['review-cycle', 'test-cycle']]);
  });

  it('appends validate when no review stage is present', () => {
    const { planBuild } = applyValidationProviderGuard(['implement'], [provider]);

    expect(planBuild).toEqual(['implement', 'validate']);
  });

  it('does not duplicate an existing validate stage', () => {
    const build: BuildStageSpec[] = ['implement', 'validate', 'review-cycle'];

    expect(applyValidationProviderGuard(build, [provider])).toEqual({ planBuild: build, injected: false });
  });
});
