import { cn } from '@/lib/utils';
import type { RiskLevel } from './use-heatmap-data';

interface HeatmapCellProps {
  touched: boolean;
  riskLevel: RiskLevel;
  filePath: string;
  planName: string;
}

const riskLabels: Record<RiskLevel, string> = {
  'none': 'Not touched',
  'single': 'Single plan',
  'overlap': 'Overlap (multiple plans)',
};

export function HeatmapCell({ touched, riskLevel, filePath, planName }: HeatmapCellProps) {
  return (
    <div
      className={cn(
        'w-6 h-6 rounded-sm border border-border/50 cursor-default relative group',
        !touched && 'bg-bg-tertiary/30',
        riskLevel === 'single' && 'bg-blue/25',
        riskLevel === 'overlap' && 'bg-yellow/40',
      )}
      title={`${filePath}\n${planName}: ${riskLabels[riskLevel]}`}
    >
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 pointer-events-none">
        <div className="bg-popover border border-border rounded-md px-2.5 py-1.5 text-[10px] whitespace-nowrap shadow-lg">
          <div className="text-text-bright">{filePath}</div>
          <div className="text-text-dim mt-0.5">
            {planName} · {riskLabels[riskLevel]}
          </div>
        </div>
      </div>
    </div>
  );
}
