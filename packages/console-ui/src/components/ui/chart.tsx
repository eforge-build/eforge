/**
 * Chart primitives — a thin shadcn-style wrapper over recharts.
 *
 * `ChartContainer` provides a responsive box, injects per-series CSS color
 * variables from a `ChartConfig`, and applies dark-theme-friendly defaults for
 * recharts surfaces (grid, axes, cursor). `ChartTooltipContent` renders a
 * compact themed tooltip. Colors always flow through CSS custom properties so
 * the theme-token-discipline gate stays satisfied.
 */
import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

export interface ChartConfigItem {
  label?: React.ReactNode;
  color?: string;
}

export type ChartConfig = Record<string, ChartConfigItem>;

interface ChartContextValue {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextValue | null>(null);

function useChart(): ChartContextValue {
  const ctx = React.useContext(ChartContext);
  if (!ctx) throw new Error('useChart must be used within a <ChartContainer />');
  return ctx;
}

/** Emit `--color-<key>` custom properties scoped to one chart instance. */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorEntries = Object.entries(config).filter(([, item]) => item.color);
  if (colorEntries.length === 0) return null;
  const css = colorEntries
    .map(([key, item]) => `  --color-${key}: ${item.color};`)
    .join('\n');
  return (
    <style
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: `[data-chart="${id}"] {\n${css}\n}` }}
    />
  );
}

/**
 * Measure a box's content size via ResizeObserver. We size recharts charts
 * explicitly from this instead of using `<ResponsiveContainer>`, which logs a
 * `width(-1)/height(-1)` warning on the first paint tick before its observer
 * fires. Returns 0×0 until measured (and in environments without layout, e.g.
 * jsdom), in which case the chart simply does not render.
 */
function useMeasuredSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

interface ChartContainerProps extends React.ComponentProps<'div'> {
  config: ChartConfig;
  /** A single recharts chart element (PieChart/AreaChart/BarChart/…). */
  children: React.ReactElement;
}

function ChartContainer({ id, className, children, config, ...props }: ChartContainerProps) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;
  const [ref, size] = useMeasuredSize();
  const ready = size.width > 0 && size.height > 0;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        data-chart={chartId}
        className={cn(
          'flex aspect-video justify-center text-xs',
          '[&_.recharts-cartesian-grid_line]:stroke-border/40',
          '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
          '[&_.recharts-surface]:overflow-visible',
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        {ready
          ? React.cloneElement(
              children as React.ReactElement<{ width?: number; height?: number }>,
              { width: size.width, height: size.height },
            )
          : null}
      </div>
    </ChartContext.Provider>
  );
}
ChartContainer.displayName = 'ChartContainer';

const ChartTooltip = RechartsPrimitive.Tooltip;

interface ChartTooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: ChartTooltipPayloadEntry[];
  label?: React.ReactNode;
  hideLabel?: boolean;
  formatter?: (value: number | string, name: string) => React.ReactNode;
  className?: string;
}

function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel,
  formatter,
  className,
}: ChartTooltipContentProps) {
  const { config } = useChart();
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className={cn(
        'grid min-w-[8rem] gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md',
        className,
      )}
    >
      {!hideLabel && label != null && (
        <div className="font-medium text-foreground">{label}</div>
      )}
      <div className="grid gap-1">
        {payload.map((entry, index) => {
          const key = String(entry.dataKey ?? entry.name ?? index);
          const itemConfig = config[key];
          const name = itemConfig?.label ?? entry.name ?? key;
          const swatch = entry.color ?? `var(--color-${key})`;
          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: swatch }}
                />
                {name}
              </span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatter && entry.value != null
                  ? formatter(entry.value, String(name))
                  : entry.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartStyle, useChart };
