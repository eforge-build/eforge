import * as React from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Select } from '@/components/ui/select';
import type { AgentRuntimeProfileOption, PlanData } from '@/types';

const PLANNING_PROFILES = ['errand', 'excursion', 'expedition'];

export interface MetadataInput { profile: string | null; agentProfile: string | null; openQuestions: string[] }

export type AgentProfileOptionsState =
  | { status: 'idle' | 'loading'; profiles: AgentRuntimeProfileOption[]; active?: string | null }
  | { status: 'success' | 'empty'; profiles: AgentRuntimeProfileOption[]; active?: string | null }
  | { status: 'error'; profiles: AgentRuntimeProfileOption[]; active?: string | null; error: string };

interface MetadataEditorProps {
  plan: PlanData;
  disabled?: boolean;
  profileOptions?: AgentProfileOptionsState;
  onSave: (input: MetadataInput) => Promise<boolean | void>;
}

/** Editable plan configuration metadata: planning profile and agent profile.
 *  Open questions live in their own panel; this editor preserves them on save.
 *  Backed by `update-session-plan-metadata`. */
export function MetadataEditor({ plan, disabled, profileOptions = { status: 'idle', profiles: [] }, onSave }: MetadataEditorProps) {
  const [editing, setEditing] = React.useState(false);

  if (!editing) {
    return (
      <section className="grid gap-2 rounded-md border bg-background/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metadata</h4>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">profile: {plan.profile ?? 'none'}</Badge>
          {plan.agent_profile && <Badge variant="outline">agent: {plan.agent_profile}</Badge>}
          {plan.confidence && <Badge variant="outline">confidence: {plan.confidence}</Badge>}
        </div>
      </section>
    );
  }

  return <MetadataForm plan={plan} profileOptions={profileOptions} onSave={onSave} onClose={() => setEditing(false)} />;
}

function formatAgentProfileOption(option: AgentRuntimeProfileOption, active?: string | null): string {
  const parts = [option.name, option.scope];
  if (option.name === active) parts.push('active');
  if (option.shadowedBy) parts.push(`shadowed by ${option.shadowedBy}`);
  return parts.join(' · ');
}

function agentProfileStatusText(profileOptions: AgentProfileOptionsState): string {
  if (profileOptions.status === 'loading') return 'Loading profile options; saving and clearing remain available.';
  if (profileOptions.status === 'empty') return 'No named profiles were found; clearing remains available.';
  if (profileOptions.status === 'error') return `Could not load profile options (${profileOptions.error}); clearing remains available.`;
  return 'Choose a known profile or leave unset to inherit the active eforge profile.';
}

function MetadataForm({ plan, profileOptions, onSave, onClose }: { plan: PlanData; profileOptions: AgentProfileOptionsState; onSave: (input: MetadataInput) => Promise<boolean | void>; onClose: () => void }) {
  const [profile, setProfile] = React.useState(plan.profile ?? '');
  const [agentProfile, setAgentProfile] = React.useState(plan.agent_profile ?? '');
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await onSave({
        profile: profile || null,
        agentProfile: agentProfile.trim() || null,
        openQuestions: plan.open_questions ?? [],
      });
      if (saved !== false) onClose();
    } finally {
      setSaving(false);
    }
  };

  const knownProfileNames = profileOptions.profiles.map((option) => option.name);
  const hasCurrentKnownProfile = knownProfileNames.includes(agentProfile);
  const showCurrentProfileOption = agentProfile.trim().length > 0 && !hasCurrentKnownProfile;

  return (
    <section className="grid gap-2 rounded-md border bg-background/50 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit metadata</h4>
      <label className="text-xs text-muted-foreground" htmlFor="session-plan-planning-profile">Planning profile</label>
      <Select id="session-plan-planning-profile" value={profile} onChange={(event) => setProfile(event.target.value)}>
        <option value="">none</option>
        {PLANNING_PROFILES.map((value) => <option key={value} value={value}>{value}</option>)}
      </Select>
      <p className="text-xs text-muted-foreground">Planning profile controls plan scope and depth presets (errand, excursion, expedition).</p>
      <label className="text-xs text-muted-foreground" htmlFor="session-plan-agent-profile">Build agent profile</label>
      <Select id="session-plan-agent-profile" value={agentProfile} aria-describedby="session-plan-agent-profile-help" onChange={(event) => setAgentProfile(event.target.value)}>
        <option value="">Default/active eforge profile (leave agent_profile unset)</option>
        {showCurrentProfileOption && <option value={agentProfile}>{agentProfile} (current value missing/deleted)</option>}
        {profileOptions.profiles.map((option) => <option key={`${option.scope}:${option.name}`} value={option.name}>{formatAgentProfileOption(option, profileOptions.active)}</option>)}
      </Select>
      <p id="session-plan-agent-profile-help" className="text-xs text-muted-foreground">
        Agent runtime profile sets the build agent runtime stored as agent_profile. {agentProfileStatusText(profileOptions)}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void submit()}>
          {saving ? <Spinner /> : null} Save
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
      </div>
    </section>
  );
}
