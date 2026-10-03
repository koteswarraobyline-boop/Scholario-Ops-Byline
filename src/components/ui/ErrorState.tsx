import React from 'react';
import { useOps } from '../../context/OpsContext';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { ApiError } from '../../services/api';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Session expired — please log in again.';
    if (error.status === 403) return 'You do not have permission to view this.';
    if (error.status === 404) return 'The requested resource was not found.';
    if (error.status === 429) return 'Too many requests. Please wait a moment.';
    if (error.status >= 500) return 'Backend error — please try again.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

export const ErrorState: React.FC<ErrorStateProps> = ({ error, onRetry, compact }) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  const msg = getErrorMessage(error);

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-xs font-mono rounded border ${
        isDark ? 'bg-rose-950/40 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'
      }`}>
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{msg}</span>
        {onRetry && (
          <button onClick={onRetry} className="ml-auto flex items-center gap-1 hover:underline cursor-pointer">
            <RefreshCw className="w-3 h-3" />Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center rounded-lg border ${
      isDark ? 'bg-[#180E13] border-rose-900/60' : 'bg-rose-50 border-rose-200'
    }`}>
      <AlertCircle className={`w-10 h-10 mb-4 ${isDark ? 'text-rose-500' : 'text-rose-400'}`} />
      <h3 className={`text-sm font-semibold font-mono ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Failed to load data</h3>
      <p className={`text-xs mt-1.5 max-w-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{msg}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      )}
    </div>
  );
};
