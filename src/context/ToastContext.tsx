import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error';
  exiting: boolean;
}

interface ToastCtx {
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);

let _id = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = String(++_id);
    setToasts(prev => [...prev, { id, message, type, exiting: false }]);

    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    }, 2200);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  }, []);

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
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl bg-gray-900 text-white pointer-events-auto ${
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
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};
