import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface PlanPreviewContextValue {
  selectedPlanId: string | null;
  openPreview: (planId: string) => void;
  closePreview: () => void;
}

const PlanPreviewContext = createContext<PlanPreviewContextValue | null>(null);

export function PlanPreviewProvider({ children }: { children: ReactNode }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const openPreview = useCallback((planId: string) => {
    setSelectedPlanId(planId);
  }, []);

  const closePreview = useCallback(() => {
    setSelectedPlanId(null);
  }, []);

  return (
    <PlanPreviewContext.Provider value={{ selectedPlanId, openPreview, closePreview }}>
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
