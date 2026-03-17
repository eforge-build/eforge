import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ContentPreview {
  title: string;
  content: string;
}

interface PlanPreviewContextValue {
  selectedPlanId: string | null;
  openPreview: (planId: string) => void;
  contentPreview: ContentPreview | null;
  openContentPreview: (title: string, content: string) => void;
  closePreview: () => void;
}

const PlanPreviewContext = createContext<PlanPreviewContextValue | null>(null);

export function PlanPreviewProvider({ children }: { children: ReactNode }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [contentPreview, setContentPreview] = useState<ContentPreview | null>(null);

  const openPreview = useCallback((planId: string) => {
    setContentPreview(null);
    setSelectedPlanId(planId);
  }, []);

  const openContentPreview = useCallback((title: string, content: string) => {
    setSelectedPlanId(null);
    setContentPreview({ title, content });
  }, []);

  const closePreview = useCallback(() => {
    setSelectedPlanId(null);
    setContentPreview(null);
  }, []);

  return (
    <PlanPreviewContext.Provider value={{ selectedPlanId, openPreview, contentPreview, openContentPreview, closePreview }}>
      {children}
    </PlanPreviewContext.Provider>
  );
}

export function usePlanPreview(): PlanPreviewContextValue {
  const ctx = useContext(PlanPreviewContext);
  if (!ctx) {
    throw new Error('usePlanPreview must be used within a PlanPreviewProvider');
  }
  return ctx;
}
