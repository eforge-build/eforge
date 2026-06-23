import * as React from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { PlanData } from '@/types';

const PLANNING_PROFILES = ['errand', 'excursion', 'expedition'];

export interface MetadataInput { profile: string | null; agentProfile: string | null; openQuestions: string[] }

interface MetadataEditorProps {
  plan: PlanData;
  disabled?: boolean;
  onSave: (input: MetadataInput) => Promise<void>;
}

/** Editable plan configuration metadata: planning profile and agent profile.
 *  Open questions live in their own panel; this editor preserves them on save.
 *  Backed by `update-session-plan-metadata`. */
export function MetadataEditor({ plan, disabled, onSave }: MetadataEditorProps) {
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

  return <MetadataForm plan={plan} onSave={onSave} onClose={() => setEditing(false)} />;
}

function MetadataForm({ plan, onSave, onClose }: { plan: PlanData; onSave: (input: MetadataInput) => Promise<void>; onClose: () => void }) {
  const [profile, setProfile] = React.useState(plan.profile ?? '');
  const [agentProfile, setAgentProfile] = React.useState(plan.agent_profile ?? '');
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        profile: profile || null,
        agentProfile: agentProfile.trim() || null,
        openQuestions: plan.open_questions ?? [],
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-2 rounded-md border bg-background/50 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit metadata</h4>
      <label className="text-xs text-muted-foreground">Planning profile</label>
      <Select value={profile} onChange={(event) => setProfile(event.target.value)}>
        <option value="">none</option>
        {PLANNING_PROFILES.map((value) => <option key={value} value={value}>{value}</option>)}
      </Select>
      <label className="text-xs text-muted-foreground">Agent profile</label>
      <Input value={agentProfile} placeholder="(inherited)" onChange={(event) => setAgentProfile(event.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void submit()}>
          {saving ? <Spinner /> : null} Save
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
      </div>
    </section>
  );
}
