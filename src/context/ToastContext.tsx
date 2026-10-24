import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error';
  exiting: boolean;
  action?: ToastAction;
}

interface ToastOptions {
  /** A button in the toast, e.g. Undo. Tapping it closes the toast. */
  action?: ToastAction;
  /** How long the toast stays, in ms (default 2.2 s). */
  duration?: number;
}

interface ToastCtx {
  showToast: (message: string, type?: 'success' | 'error', options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });
// eslint-disable-next-line react/only-export-components
export const useToast = () => useContext(ToastContext);

let _id = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  const showToast = useCallback((
    message: string,
    type: 'success' | 'error' = 'success',
    options: ToastOptions = {},
  ) => {
    const id = String(++_id);
    setToasts(prev => [...prev, { id, message, type, exiting: false, action: options.action }]);
    setTimeout(() => dismiss(id), options.duration ?? 2200);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-24 inset-x-0 flex flex-col items-center gap-2 z-[300] pointer-events-none px-4"
          aria-live="polite"
        >
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl bg-slate-800 dark:bg-slate-700 dark:ring-1 dark:ring-white/10 text-white pointer-events-auto ${
                toast.exiting ? 'anim-toast-out' : 'anim-toast-in'
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
              }`}>
                {toast.type === 'success'
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                  : <XCircle className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                }
              </div>
              <span className="text-sm font-medium leading-snug">{toast.message}</span>
              {toast.action && (
                <button
                  onClick={() => { toast.action?.onClick(); dismiss(toast.id); }}
                  className="ml-1 -mr-1 px-3 py-1 rounded-lg text-sm font-bold text-blue-300 hover:bg-white/10"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};
