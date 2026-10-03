import React from 'react';
import { useOps } from '../../context/OpsContext';
import { LucideIcon, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
}) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center rounded-lg border ${
      isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
    }`}>
      <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
        isDark ? 'bg-[#1A2436]' : 'bg-slate-100'
      }`}>
        <Icon className={`w-6 h-6 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
      </div>
      <h3 className={`text-sm font-semibold font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{title}</h3>
      {description && (
        <p className={`text-xs mt-1.5 max-w-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-1.5 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
