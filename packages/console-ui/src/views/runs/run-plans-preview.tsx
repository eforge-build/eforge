// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import type { PlansResponse } from '@eforge-build/client/browser';

interface RunPlansPreviewProps {
  plans: PlansResponse;
}

/** Renders the generated plan list from a `PlansResponse`. */
export function RunPlansPreview({ plans }: RunPlansPreviewProps) {
  if (plans.length === 0) {
    return <p className="text-xs text-muted-foreground">No plans generated.</p>;
  }

  return (
    <div className="space-y-2">
      {plans.map((plan) => (
        <PlanRow key={plan.id} plan={plan} />
      ))}
    </div>
  );
}

type PlanItem = PlansResponse[number];

interface PlanRowProps {
  plan: PlanItem;
}

function PlanRow({ plan }: PlanRowProps) {
  const [bodyExpanded, setBodyExpanded] = React.useState(false);
  const hasBody = Boolean(plan.body);
  const excerpt = hasBody ? plan.body.slice(0, 200) : '';
  const buildCount = plan.build?.length ?? 0;
  const hasReview = Boolean(plan.review);
  const partialReasons = ((plan as PlanItem & { partialReasons?: Array<{ message?: string }> }).partialReasons ?? []).map((reason) => reason.message).filter((message): message is string => typeof message === 'string' && message.length > 0);

  return (
    <div className="border rounded p-2 text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono font-semibold">{plan.id}</span>
        <span className="bg-secondary text-secondary-foreground rounded px-1">
          {plan.type}
        </span>
        {plan.dependsOn.length > 0 && (
          <span className="text-muted-foreground">
            deps: {plan.dependsOn.join(', ')}
          </span>
        )}
        {buildCount > 0 && (
          <span className="text-muted-foreground">{buildCount} build stage(s)</span>
        )}
        {hasReview && (
          <span className="text-muted-foreground">has review config</span>
        )}
      </div>
      {plan.name && <p className="text-muted-foreground">{plan.name}</p>}
      {partialReasons.map((message) => <p key={message} className="text-muted-foreground">{message}</p>)}
      {hasBody && (
        <div>
          <button
            type="button"
            onClick={() => setBodyExpanded((v) => !v)}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            {bodyExpanded ? 'hide body' : 'preview body'}
          </button>
          {bodyExpanded && (
            <pre className="mt-1 text-xs overflow-auto max-h-60 bg-muted p-1 rounded whitespace-pre-wrap">
              {excerpt}
              {plan.body.length > 200 && '...'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
// --- eforge:endregion runs-build-entrypoints ---
