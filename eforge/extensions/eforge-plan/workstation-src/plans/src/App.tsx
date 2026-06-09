import * as React from 'react';
import { ClipboardList, GitBranch, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToastProvider } from '@/components/toast';
import { RouterProvider, useRouter } from '@/router';
import { useWorkstationData } from '@/hooks/use-workstation-data';
import { BacklogView } from '@/views/backlog-view';
import { PlansView } from '@/views/plans-view';

type TabId = 'backlog' | 'plans';
const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'backlog', label: 'Backlog', icon: GitBranch },
  { id: 'plans', label: 'Plans', icon: ClipboardList },
];

export function App() {
  return (
    <ToastProvider>
      <RouterProvider>
        <Shell />
      </RouterProvider>
    </ToastProvider>
  );
}

function Shell() {
  const router = useRouter();
  const data = useWorkstationData();
  const activeTab: TabId = router.segments[0] === 'plans' ? 'plans' : 'backlog';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-lg font-semibold text-text-bright">
            <Sparkles className="h-5 w-5 text-primary" /> eforge-plan
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{data.bridgeVersion ? `bridge v${data.bridgeVersion}` : 'mock bridge'}</Badge>
            <Button variant="outline" size="sm" onClick={() => void data.refresh()} disabled={data.loading}>
              {data.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </div>
        </div>
        <nav className="mt-3 flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => router.navigate(tab.id)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-accent text-text-bright' : 'text-muted-foreground hover:bg-accent/60'}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" /> {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="p-4">
        {data.error && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">{data.error}</p>}
        {activeTab === 'plans'
          ? <PlansView artifacts={data.artifacts} onRefresh={data.refresh} />
          : <BacklogView
              board={data.board}
              recommendations={data.recommendations}
              recommendationStatus={data.recommendationStatus}
              activeRecommendationRefreshTask={data.activeRecommendationRefreshTask}
              onRefresh={data.refresh}
            />}
      </main>
    </div>
  );
}
