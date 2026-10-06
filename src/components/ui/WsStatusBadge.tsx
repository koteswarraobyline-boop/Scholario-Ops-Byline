import React from 'react';
import { RealtimeStatus } from '../../context/OpsContext';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

/** Shows the state of the realtime (SSE) connection to the Ops API. */
interface WsStatusBadgeProps { status: RealtimeStatus | 'CONNECTING'; isDark: boolean }

export const WsStatusBadge: React.FC<WsStatusBadgeProps> = ({ status, isDark }) => {
  if (status === 'LIVE') {
    return (
      <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full ${
        isDark ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/50' : 'text-emerald-700 bg-emerald-50 border border-emerald-200'
      }`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        LIVE
      </span>
    );
  }
  if (status === 'RECONNECTING') {
    return (
      <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full ${
        isDark ? 'text-amber-400 bg-amber-950/50 border border-amber-900/50' : 'text-amber-700 bg-amber-50 border border-amber-200'
      }`}>
        <RefreshCw className="w-3 h-3 animate-spin" />
        RECONNECTING
      </span>
    );
  }
  if (status === 'OFFLINE') {
    return (
      <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full ${
        isDark ? 'text-rose-400 bg-rose-950/50 border border-rose-900/50' : 'text-rose-700 bg-rose-50 border border-rose-200'
      }`}>
        <WifiOff className="w-3 h-3" />
        OFFLINE
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full ${
      isDark ? 'text-slate-400 bg-slate-900 border border-slate-700' : 'text-slate-500 bg-slate-100 border border-slate-300'
    }`}>
      <Wifi className="w-3 h-3" />
      CONNECTING
    </span>
  );
};
