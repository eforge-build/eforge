import * as React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { AcDiagnostic, PlanData, Readiness } from '@/types';
import { SectionEditor } from './section-editor';
import { sectionContent, titleCase } from './dimensions';

const PLANNING_TYPES = ['bugfix', 'feature', 'refactor', 'architecture', 'docs', 'maintenance'];
const PLANNING_DEPTHS = ['quick', 'focused', 'deep'];
const AC_DIMENSION = 'acceptance-criteria';

interface ReadinessChecklistProps {
  plan: PlanData;
  readiness: Readiness;
  onSetSection: (dimension: string, content: string) => Promise<void>;
  onSelectDimensions: (planningType: string, planningDepth: string) => Promise<void>;
}

/**
 * Turns readiness diagnostics into an actionable checklist: missing dimensions
 * become inline section editors, acceptance-criteria quality issues become a
 * revise affordance, and an unselected plan gets a dimension-selection form.
 */
export function ReadinessChecklist({ plan, readiness, onSetSection, onSelectDimensions }: ReadinessChecklistProps) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const missing = readiness.missingDimensions ?? [];
  const covered = readiness.coveredDimensions ?? [];
  const skipped = readiness.skippedDimensions ?? [];
  const acDiagnostics = readiness.acDiagnostics ?? [];
  const noDimensions = missing.length === 0 && covered.length === 0 && skipped.length === 0
    && (plan.required_dimensions ?? []).length === 0;

  const save = async (dimension: string, content: string) => {
    await onSetSection(dimension, content);
    setEditing(null);
  };

  return (
    <section className="grid gap-2 rounded-md border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Readiness</h4>
        <span className={`text-xs font-semibold ${readiness.ready ? 'text-[color:var(--lane-ready)]' : 'text-[color:var(--prio-medium)]'}`}>
          {readiness.ready ? 'Ready to hand off' : `${missing.length + acDiagnostics.length} item(s) to resolve`}
        </span>
      </div>

      {noDimensions
        ? <SelectDimensionsForm plan={plan} onSelect={onSelectDimensions} />
        : (
          <ul className="grid gap-1.5">
            {missing.map((dimension) => (
              <li key={dimension} className="rounded border border-dashed border-[color:var(--prio-medium)]/40 p-2">
                <Row icon={<Circle className="h-4 w-4 text-[color:var(--prio-medium)]" />} label={titleCase(dimension)} hint="missing">
                  {editing !== dimension && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(dimension)}><Plus className="h-4 w-4" /> Add</Button>
                  )}
                </Row>
                {editing === dimension && (
                  <SectionEditor dimension={dimension} onSave={(content) => save(dimension, content)} onCancel={() => setEditing(null)} />
                )}
              </li>
            ))}

            {acDiagnostics.length > 0 && (
              <li className="rounded border border-dashed border-[color:var(--lane-blocked)]/40 p-2">
                <Row icon={<AlertTriangle className="h-4 w-4 text-[color:var(--lane-blocked)]" />} label="Acceptance criteria quality" hint="needs revision">
                  {editing !== AC_DIMENSION && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(AC_DIMENSION)}>Revise</Button>
                  )}
                </Row>
                <AcDiagnosticList diagnostics={acDiagnostics} />
                {editing === AC_DIMENSION && (
                  <SectionEditor
                    dimension={AC_DIMENSION}
                    initialContent={sectionContent(plan.sections, AC_DIMENSION)}
                    onSave={(content) => save(AC_DIMENSION, content)}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </li>
            )}

            {covered.filter((dimension) => !(dimension === AC_DIMENSION && acDiagnostics.length > 0)).map((dimension) => (
              <li key={dimension}>
                <Row icon={<CheckCircle2 className="h-4 w-4 text-[color:var(--lane-ready)]" />} label={titleCase(dimension)} hint="covered" />
              </li>
            ))}

            {skipped.map((dimension) => (
              <li key={dimension}>
                <Row icon={<MinusCircle className="h-4 w-4 text-muted-foreground" />} label={titleCase(dimension)} hint="skipped" />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function Row({ icon, label, hint, children }: { icon: React.ReactNode; label: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-foreground">{label}</span>
      <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{hint}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}

function AcDiagnosticList({ diagnostics }: { diagnostics: AcDiagnostic[] }) {
  return (
    <ul className="mt-2 grid gap-1.5">
      {diagnostics.map((diagnostic, index) => (
        <li key={index} className="rounded bg-background p-2 text-xs">
          <p className="text-foreground">{diagnostic.message}</p>
          {diagnostic.line && <code className="mt-0.5 block truncate text-[0.7rem] text-muted-foreground">{diagnostic.line}</code>}
          {diagnostic.suggestion && <p className="mt-0.5 text-[color:var(--lane-ready)]">{diagnostic.suggestion}</p>}
        </li>
      ))}
    </ul>
  );
}

function SelectDimensionsForm({ plan, onSelect }: { plan: PlanData; onSelect: (type: string, depth: string) => Promise<void> }) {
  const [planningType, setPlanningType] = React.useState(plan.planning_type ?? 'feature');
  const [planningDepth, setPlanningDepth] = React.useState(plan.planning_depth ?? 'focused');
  const [applying, setApplying] = React.useState(false);

  const apply = async () => {
    setApplying(true);
    try {
      await onSelect(planningType, planningDepth);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="grid gap-2 rounded border border-dashed p-2 text-sm">
      <p className="text-muted-foreground">No dimensions selected yet. Choose a planning type and depth to derive the required sections.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={planningType} onChange={(event) => setPlanningType(event.target.value)} className="w-40">
          {PLANNING_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </Select>
        <Select value={planningDepth} onChange={(event) => setPlanningDepth(event.target.value)} className="w-40">
          {PLANNING_DEPTHS.map((depth) => <option key={depth} value={depth}>{depth}</option>)}
        </Select>
        <Button size="sm" variant="secondary" disabled={applying} onClick={() => void apply()}>
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Apply dimensions
        </Button>
      </div>
    </div>
  );
}
