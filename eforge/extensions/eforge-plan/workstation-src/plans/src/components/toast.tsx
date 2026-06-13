import * as React from 'react';

export type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'border-border bg-card text-foreground',
  success: 'border-primary/50 bg-card text-text-bright',
  error: 'border-destructive/60 bg-card text-destructive-foreground',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id)), []);

  const push = React.useCallback((message: string, tone: ToastTone = 'info') => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const api = React.useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={`pointer-events-auto rounded-md border px-3 py-2 text-left text-sm shadow-2xl ring-1 ring-background/80 transition-opacity ${TONE_CLASSES[toast.tone]}`}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
