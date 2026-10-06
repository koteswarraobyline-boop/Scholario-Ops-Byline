import React from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { useOps } from '../../context/OpsContext';

/** Renders action results (success / error) reported through OpsContext.notify */
export const Toaster: React.FC = () => {
  const { toasts, dismissToast, theme } = useOps();
  const isDark = theme === 'dark';
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(420px,calc(100vw-2rem))]" role="status" aria-live="polite">
      {toasts.map(t => {
        const Icon = t.type === 'success' ? CheckCircle2 : t.type === 'error' ? AlertTriangle : Info;
        const tone = t.type === 'success'
          ? (isDark ? 'border-emerald-800 bg-emerald-950/95 text-emerald-200' : 'border-emerald-300 bg-emerald-50 text-emerald-900')
          : t.type === 'error'
            ? (isDark ? 'border-rose-800 bg-rose-950/95 text-rose-200' : 'border-rose-300 bg-rose-50 text-rose-900')
            : (isDark ? 'border-blue-800 bg-[#0F1A2E]/95 text-blue-200' : 'border-blue-300 bg-blue-50 text-blue-900');
        return (
          <div key={t.id} className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border shadow-lg text-xs font-mono ${tone}`}>
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 break-words">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} className="opacity-60 hover:opacity-100 cursor-pointer" aria-label="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
