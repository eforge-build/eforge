import * as React from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { PlanData } from '@/types';

const PLANNING_PROFILES = ['errand', 'excursion', 'expedition'];

export interface MetadataInput { profile: string | null; agentProfile: string | null; openQuestions: string[] }

interface MetadataEditorProps {
  plan: PlanData;
  onSave: (input: MetadataInput) => Promise<void>;
}

/** Editable plan metadata not covered by section/dimension actions: profile,
 *  agent profile, and open questions. Backed by `update-session-plan-metadata`. */
export function MetadataEditor({ plan, onSave }: MetadataEditorProps) {
  const [editing, setEditing] = React.useState(false);
  const openQuestions = plan.open_questions ?? [];

  if (!editing) {
    return (
      <section className="grid gap-2 rounded-md border bg-background/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metadata</h4>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">profile: {plan.profile ?? 'none'}</Badge>
          {plan.agent_profile && <Badge variant="outline">agent: {plan.agent_profile}</Badge>}
          {plan.confidence && <Badge variant="outline">confidence: {plan.confidence}</Badge>}
        </div>
        {openQuestions.length > 0 && (
          <div>
            <h5 className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Open questions</h5>
            <ul className="mt-1 grid gap-1 text-sm text-foreground">
              {openQuestions.map((question, index) => <li key={index} className="list-inside list-disc">{question}</li>)}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return <MetadataForm plan={plan} onSave={onSave} onClose={() => setEditing(false)} />;
}

function MetadataForm({ plan, onSave, onClose }: { plan: PlanData; onSave: (input: MetadataInput) => Promise<void>; onClose: () => void }) {
  const [profile, setProfile] = React.useState(plan.profile ?? '');
  const [agentProfile, setAgentProfile] = React.useState(plan.agent_profile ?? '');
  const [questions, setQuestions] = React.useState((plan.open_questions ?? []).join('\n'));
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        profile: profile || null,
        agentProfile: agentProfile.trim() || null,
        openQuestions: questions.split('\n').map((line) => line.trim()).filter(Boolean),
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
      <label className="text-xs text-muted-foreground">Open questions (one per line)</label>
      <Textarea value={questions} onChange={(event) => setQuestions(event.target.value)} className="min-h-24 text-xs" />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void submit()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
      </div>
    </section>
  );
}
