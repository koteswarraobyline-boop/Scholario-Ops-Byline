import React from 'react';
import { useOps } from '../../context/OpsContext';
import { Server, HardDrive, Cpu, Database, CheckCircle2 } from 'lucide-react';

export const HostingerView: React.FC = () => {
  const { servers, theme } = useOps();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            HOSTINGER CLOUD VPS FLEET
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Provider hypervisor status, datacenter locations, hardware virtualization &amp; snapshot storage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded flex items-center gap-1.5 ${
            isDark 
              ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-900/80' 
              : 'text-emerald-700 bg-emerald-50 border border-emerald-200'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Hostinger Cloud API: Connected</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs font-mono">
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Datacenter Regions</div>
          <div className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>4 Global Hubs</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Singapore, Frankfurt, Mumbai, London</div>
        </div>
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Total vCPU Fleet</div>
          <div className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>96 vCPU Cores</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>AMD EPYC Enterprise Gen 4</div>
        </div>
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Memory Fleet</div>
          <div className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>384 GB DDR5</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>ECC Registered Parity Checked</div>
        </div>
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>NVMe Storage Fleet</div>
          <div className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>4.8 TB NVMe</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RAID-10 Hardware Mirrored</div>
        </div>
      </div>

      {/* VPS Hardware List */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Instance Hostname</th>
                <th className="py-2.5 px-3.5">Region DC</th>
                <th className="py-2.5 px-3.5">Hostinger Plan</th>
                <th className="py-2.5 px-3.5">Specs (CPU / RAM / Disk)</th>
                <th className="py-2.5 px-3.5">IPv4 Address</th>
                <th className="py-2.5 px-3.5">Power State</th>
                <th className="py-2.5 px-3.5 text-right">Provider Sync</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {servers.map(s => (
                <tr key={s.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                  <td className={`py-2.5 px-3.5 font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    {s.hostname}
                  </td>
                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {s.region}
                  </td>
                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {s.plan.split('(')[0]}
                  </td>
                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {s.cpuCores} vCPU · {s.ramGb}GB · {s.diskGb}GB
                  </td>
                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {s.ip}
                  </td>
                  <td className="py-2.5 px-3.5">
                    <span className="text-emerald-500 font-bold text-[11px] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>RUNNING</span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5 text-right text-emerald-500 font-medium">
                    Verified
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
