import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@eforge-build/engine/prompts';

describe('loadPrompt() throws on unresolved template variables', () => {
  it('throws when called with partial vars for the planner prompt', async () => {
    await expect(
      loadPrompt('planner', {}),
    ).rejects.toThrow(/loadPrompt\(planner\.md\): unresolved template variables: .+/);
  });

  it('error message contains the prompt identifier', async () => {
    await expect(
      loadPrompt('planner', {}),
    ).rejects.toThrow('loadPrompt(planner');
  });

  it('error message contains at least one specific missing variable name', async () => {
    const error = await loadPrompt('planner', {}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('source');
  });

  it('deduplicates repeated unresolved variable names in the error message', async () => {
    // The planner prompt uses {{planSetName}} multiple times; it should only appear once in the error
    const error = await loadPrompt('planner', {}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const msg = (error as Error).message;
    const matches = msg.match(/\bplanSetName\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('returns a string with zero {{...}} tokens when all variables are provided', async () => {
    const prompt = await loadPrompt('builder', {
      plan_id: 'test-plan-01',
      plan_name: 'Test Plan',
      plan_content: 'Implement the feature.',
      shardScope: '',
      parallelLanes: '',
      verification_scope: 'Run pnpm test.',
      commit_section: '## Commit\n\nAfter verification, commit all changes.',
      continuation_context: '',
    });

    expect(typeof prompt).toBe('string');
    expect(prompt).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
  });

  it('includes open-target guidance in the eforge-plan planning draft prompt', async () => {
    const prompt = await loadPrompt('eforge-plan-planning-draft', {
      topic: 'Backlog cleanup',
      session: 'session-one',
      planningType: 'maintenance',
      planningDepth: 'focused',
      requestedOutputSections: 'backlogCurationDraft,recommendations',
      sourceText: 'source',
      existingSessionPlan: 'none',
      progressTool: 'progress',
      submitTool: 'submit',
      resultSchema: 'type: object',
    });

    expect(prompt).toContain('Recommendation target fields may reference only open item/epic ids.');
    expect(prompt).toContain('Treat closed dependencies as satisfied historical context, not active recommendation targets.');
    expect(prompt).toContain('`activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, `safeParallelizableGroups.epicIds`, `blockedChains.itemIds`, and `blockedChains.blockedBy` may reference only open targets.');
    expect(prompt).toContain('Strong shipped-status item patches must cite compact shipped evidence from `source.shippedEvidenceCandidates`');
    expect(prompt).toContain('`Shipped evidence: lifecycle trace — ...`');
    expect(prompt).toContain('`Shipped evidence: inferred from git/PR history — ...`');
    expect(prompt).toContain('`Ambiguous shipped candidate: needs input — ...`');
    expect(prompt).toContain('Same-draft recommendation exclusion: when your `backlogCurationDraft` proposes closing an item or epic');
  });

  it('treats {{...}} inside substituted values as literal text', async () => {
    // Regression: a plan body that quotes a downstream prompt's placeholders
    // (e.g. {{summary}}, {{prdContent}}) must not trip the unresolved-variable
    // check. The check only validates variables declared by the template
    // itself.
    const planContent = [
      'The recovery-analyst prompt expects placeholders {{summary}},',
      '{{prdContent}}, {{recovery_schema}}, and {{cwd}}.',
    ].join('\n');

    const prompt = await loadPrompt('builder', {
      plan_id: 'plan-01-recovery-engine-core',
      plan_name: 'Recovery engine core',
      plan_content: planContent,
      shardScope: '',
      parallelLanes: '',
      verification_scope: 'Run pnpm test.',
      commit_section: '## Commit\n\nAfter verification, commit all changes.',
      continuation_context: '',
    });

    expect(prompt).toContain('{{summary}}');
    expect(prompt).toContain('{{prdContent}}');
    expect(prompt).toContain('{{recovery_schema}}');
    expect(prompt).toContain('{{cwd}}');
  });
});
