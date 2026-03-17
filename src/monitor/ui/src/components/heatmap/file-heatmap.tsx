import { useState } from 'react';
import type { RunState } from '@/lib/reducer';
import { useHeatmapData } from './use-heatmap-data';
import { HeatmapCell } from './heatmap-cell';
import { HeatmapLegend } from './heatmap-legend';
import { HeatmapSummary } from './heatmap-summary';

const DEFAULT_FILE_LIMIT = 50;

interface FileHeatmapProps {
  runState: RunState;
}

export function FileHeatmap({ runState }: FileHeatmapProps) {
  const { files, plans, matrix, stats } = useHeatmapData(runState);
  const [showAll, setShowAll] = useState(false);

  if (stats.totalFiles === 0) {
    return (
      <div className="bg-card border border-border rounded-lg px-4 py-6 text-center text-text-dim text-sm">
        Waiting for file change data...
      </div>
    );
  }

  const visibleFiles = showAll ? files : files.slice(0, DEFAULT_FILE_LIMIT);
  const hasMore = files.length > DEFAULT_FILE_LIMIT;

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wide text-text-dim">
          File Heatmap
        </h3>
        <HeatmapSummary {...stats} />
      </div>

      <HeatmapLegend />

      {/* Grid */}
      <div className="overflow-x-auto">
        {/* Plan column headers */}
        <div className="flex gap-0.5 mb-1" style={{ paddingLeft: '218px' }}>
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="w-6 text-[9px] text-text-dim text-center overflow-hidden"
              title={plan.id}
            >
              <div className="truncate" style={{ writingMode: 'vertical-lr', height: '60px', transform: 'rotate(180deg)' }}>
                {plan.id}
              </div>
            </div>
          ))}
        </div>

        {/* File rows */}
        {visibleFiles.map((file) => {
          const planRisks = matrix.get(file.path);
          return (
            <div key={file.path} className="flex items-center gap-0.5 mb-0.5">
              <div
                className="w-[216px] text-[10px] text-text-dim overflow-hidden text-ellipsis whitespace-nowrap shrink-0"
                title={file.path}
              >
                {file.path}
              </div>
              {plans.map((plan) => {
                const risk = planRisks?.get(plan.id) ?? 'none';
                return (
                  <HeatmapCell
                    key={plan.id}
                    touched={risk !== 'none'}
                    riskLevel={risk}
                    filePath={file.path}
                    planName={plan.id}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Show all toggle */}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[11px] text-blue hover:text-text-bright cursor-pointer self-start"
        >
          {showAll
            ? `Show top ${DEFAULT_FILE_LIMIT} files`
            : `Show all ${files.length} files (${files.length - DEFAULT_FILE_LIMIT} more)`}
        </button>
      )}
    </div>
  );
}
