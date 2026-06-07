import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { titleCase } from './dimensions';

interface SectionEditorProps {
  dimension: string;
  initialContent?: string;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Inline editor for a single session-plan dimension section. Used both to fill a
 * missing dimension and to revise one that already has content (e.g. acceptance
 * criteria flagged by readiness diagnostics).
 */
export function SectionEditor({ dimension, initialContent = '', onSave, onCancel }: SectionEditorProps) {
  const [value, setValue] = React.useState(initialContent);
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 grid gap-2 rounded-md border bg-background/60 p-3">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titleCase(dimension)}</label>
      <Textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={`Write the ${titleCase(dimension)} section in Markdown…`}
        className="min-h-32 font-mono text-xs"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={saving || !value.trim()} onClick={() => void submit()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save section
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
