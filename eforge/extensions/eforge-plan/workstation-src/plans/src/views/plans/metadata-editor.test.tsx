import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanData } from '@/types';
import { MetadataEditor, type AgentProfileOptionsState } from './metadata-editor';

const baseOptions: AgentProfileOptionsState = {
  status: 'success',
  active: 'team-runtime',
  profiles: [
    { name: 'team-runtime', harness: 'pi', path: 'eforge/profiles/team-runtime.yaml', scope: 'project' },
    { name: 'local-fast', harness: 'claude-sdk', path: '.eforge/profiles/local-fast.yaml', scope: 'local' },
  ],
};

function plan(overrides: Partial<PlanData> = {}): PlanData {
  return {
    session: 'session-one',
    topic: 'Session one',
    status: 'planning',
    profile: 'excursion',
    agent_profile: null,
    open_questions: ['Keep the question?'],
    ...overrides,
  };
}

function renderEditor(input: { plan?: PlanData; profileOptions?: AgentProfileOptionsState } = {}) {
  const onSave = vi.fn(async () => undefined);
  render(<MetadataEditor plan={input.plan ?? plan()} profileOptions={input.profileOptions ?? baseOptions} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
  return { onSave };
}

describe('MetadataEditor agent runtime profile selection', () => {
  it('renders build agent profile as a select while keeping planning profile distinct', () => {
    renderEditor();

    expect(screen.getByLabelText('Planning profile')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByText(/Planning profile controls plan scope and depth presets/)).toBeTruthy();
    expect(screen.getByLabelText('Build agent profile')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByText(/Agent runtime profile sets the build agent runtime stored as agent_profile/)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Default/active eforge profile (leave agent_profile unset)' })).toBeTruthy();
  });

  it('clears agent_profile by saving the default option as null and preserves open questions', async () => {
    const { onSave } = renderEditor({ plan: plan({ agent_profile: 'team-runtime' }) });

    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ profile: 'excursion', agentProfile: null, openQuestions: ['Keep the question?'] }));
  });

  it('shows an existing known agent_profile as the selected runtime profile with disambiguating context', () => {
    renderEditor({ plan: plan({ agent_profile: 'team-runtime' }) });

    expect((screen.getByLabelText('Build agent profile') as HTMLSelectElement).value).toBe('team-runtime');
    expect(screen.getByRole('option', { name: 'team-runtime · project · active' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'local-fast · local' })).toBeTruthy();
  });

  it('saves a selected known profile through the existing agentProfile field', async () => {
    const { onSave } = renderEditor();

    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: 'local-fast' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ profile: 'excursion', agentProfile: 'local-fast', openQuestions: ['Keep the question?'] }));
  });

  it('hides shadowed duplicate profile entries because agent_profile stores only the profile name', () => {
    renderEditor({
      plan: plan({ agent_profile: 'team-runtime' }),
      profileOptions: {
        status: 'success',
        active: 'team-runtime',
        profiles: [
          { name: 'team-runtime', harness: 'pi', path: 'eforge/profiles/team-runtime.yaml', scope: 'project' },
          { name: 'team-runtime', harness: 'claude-sdk', path: '.eforge/profiles/team-runtime.yaml', scope: 'local', shadowedBy: 'project' },
        ],
      },
    });

    expect(screen.getByRole('option', { name: 'team-runtime · project · active' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /shadowed by project/ })).toBeNull();
  });

  it('renders a missing current profile that can be preserved, changed, or cleared', async () => {
    const { onSave } = renderEditor({ plan: plan({ agent_profile: 'deleted-profile' }) });

    expect(screen.getByRole('option', { name: 'deleted-profile (current value missing/deleted)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ agentProfile: 'deleted-profile' })));

    cleanup();
    const changed = renderEditor({ plan: plan({ agent_profile: 'deleted-profile' }) });
    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: 'local-fast' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(changed.onSave).toHaveBeenCalledWith({ profile: 'excursion', agentProfile: 'local-fast', openQuestions: ['Keep the question?'] }));

    cleanup();
    const second = renderEditor({ plan: plan({ agent_profile: 'deleted-profile' }) });
    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(second.onSave).toHaveBeenCalledWith(expect.objectContaining({ agentProfile: null })));
  });

  it.each([
    [{ status: 'loading', profiles: [] } satisfies AgentProfileOptionsState, /Loading profile options; saving and clearing remain available/],
    [{ status: 'empty', profiles: [] } satisfies AgentProfileOptionsState, /No named profiles were found; clearing remains available/],
    [{ status: 'error', profiles: [], error: 'boom' } satisfies AgentProfileOptionsState, /Could not load profile options \(boom\); clearing remains available/],
  ])('keeps clearing and planning-profile edits available while profile options are %s', async (profileOptions, message) => {
    const { onSave } = renderEditor({ plan: plan({ profile: 'errand', agent_profile: 'team-runtime' }), profileOptions });

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Default/active eforge profile (leave agent_profile unset)' })).toBeTruthy();
    expect((screen.getByLabelText('Build agent profile') as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Save/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Planning profile'), { target: { value: 'expedition' } });
    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ profile: 'expedition', agentProfile: null, openQuestions: ['Keep the question?'] }));
  });
});
