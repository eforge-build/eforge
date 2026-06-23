import { RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBox } from '@/components/ui/error-box';
import { Spinner } from '@/components/ui/spinner';
import { ToastProvider } from '@/components/toast';
import { RouterProvider } from '@/router';
import { useWorkstationData } from '@/hooks/use-workstation-data';
import { WorkstationView } from '@/views/workstation-view';

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
  const data = useWorkstationData();

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
              {data.loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="p-4">
        {data.error && <ErrorBox className="mb-3 rounded-md p-3 text-sm">{data.error}</ErrorBox>}
        <WorkstationView data={data} />
      </main>
    </div>
  );
}
