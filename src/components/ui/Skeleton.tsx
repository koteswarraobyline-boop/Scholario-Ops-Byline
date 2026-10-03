import React from 'react';
import { useOps } from '../../context/OpsContext';

interface SkeletonProps { className?: string }

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => {
  const { theme } = useOps();
  return (
    <div className={`animate-pulse rounded ${
      theme === 'dark' ? 'bg-[#1E293B]' : 'bg-slate-200'
    } ${className}`} />
  );
};

export const SkeletonCard: React.FC<{ rows?: number }> = ({ rows = 3 }) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  return (
    <div className={`p-4 rounded-lg border space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
      <Skeleton className="h-3 w-2/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-2.5 ${i % 2 === 0 ? 'w-full' : 'w-4/5'}`} />
      ))}
    </div>
  );
};

export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 4 }) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  return (
    <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
      <div className={`px-4 py-3 border-b ${isDark ? 'border-[#1E293B] bg-[#0D1220]' : 'border-slate-100 bg-slate-50'}`}>
        <Skeleton className="h-3 w-1/3" />
      </div>
      <div className="divide-y divide-[#172030]">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-4 py-3 flex gap-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-2.5 flex-1 ${c === 0 ? 'max-w-[140px]' : ''}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
