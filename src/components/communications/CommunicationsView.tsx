import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { Send, CheckCircle2, Bell, Radio, Shield } from 'lucide-react';

export const CommunicationsView: React.FC = () => {
  const { communicationChannels, escalationPolicies, sendTestNotification, theme } = useOps();
  const isDark = theme === 'dark';
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);

  const handleTestDispatch = async (channelId: string, channelName: string) => {
    setTestingId(channelId);
    setTestSuccessMessage(null);
    await sendTestNotification(channelId);
    setTestingId(null);
    setTestSuccessMessage(`Test notification confirmed delivered to ${channelName}`);
    setTimeout(() => setTestSuccessMessage(null), 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            COMMUNICATIONS &amp; ESCALATION MATRIX
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Microsoft Teams webhooks, email relays, on-call paging &amp; multi-tiered escalation matrix
          </p>
        </div>
      </div>

      {testSuccessMessage && (
        <div className={`p-3.5 rounded border text-xs font-mono flex items-center gap-2 animate-in fade-in ${
          isDark ? 'bg-[#0E1A14] border-emerald-900 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800'
        }`}>
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{testSuccessMessage}</span>
        </div>
      )}

      {/* Channels Section */}
      <div className="space-y-3">
        <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>Configured Operational Channels</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          {communicationChannels.map(ch => {
            const isTesting = testingId === ch.id;

            return (
              <div key={ch.id} className={`p-4 rounded-lg border space-y-3 flex flex-col justify-between transition-colors ${
                isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
              }`}>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-sans text-sm">{ch.name}</span>
                    <span className="text-[10px] text-blue-500 font-semibold uppercase">
                      {ch.type}
                    </span>
                  </div>

                  <div className={`mt-2.5 text-[11px] break-all p-2 rounded border ${
                    isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2436]' : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    Endpoint: {ch.targetEndpoint.slice(0, 28)}••••••••
                  </div>

                  <div className={`mt-2.5 text-[11px] space-y-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <strong className="text-emerald-500">ENABLED</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Delivery:</span>
                      <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                        {new Date(ch.lastDeliveryAt).toLocaleTimeString()} ({ch.lastDeliveryStatus})
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleTestDispatch(ch.id, ch.name)}
                  disabled={isTesting}
                  className={`w-full mt-2 py-1.5 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 border cursor-pointer ${
                    isDark 
                      ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' 
                      : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                  }`}
                >
                  <Send className={`w-3 h-3 ${isTesting ? 'animate-spin text-blue-500' : ''}`} />
                  <span>{isTesting ? 'DISPATCHING...' : 'DISPATCH TEST PAYLOAD'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Escalation Policies */}
      <div className="space-y-3">
        <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>Incident Escalation Policy Matrix</h2>
        <div className={`rounded-lg border overflow-hidden transition-colors ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Severity Tier</th>
                <th className="py-2.5 px-3.5">Dispatched Channels</th>
                <th className="py-2.5 px-3.5">Initial Delay</th>
                <th className="py-2.5 px-3.5">Reminder Repeat</th>
                <th className="py-2.5 px-3.5">Auto-Escalate Window</th>
                <th className="py-2.5 px-3.5 text-right">Escalate Target</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {escalationPolicies.map(pol => (
                <tr key={pol.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                  <td className="py-2.5 px-3.5 font-bold">
                    <span className={pol.severity === 'CRITICAL' ? 'text-rose-500' : 'text-amber-500'}>
                      {pol.severity}
                    </span>
                  </td>

                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {pol.channels.map(c => c.replace('comm-', '').toUpperCase()).join(', ')}
                  </td>

                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {pol.initialDelayMin === 0 ? 'Immediate (0s)' : `${pol.initialDelayMin} min`}
                  </td>

                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Every {pol.repeatIntervalMin} min
                  </td>

                  <td className="py-2.5 px-3.5 text-rose-500 font-bold">
                    If unacknowledged &gt; {pol.autoEscalateAfterMin} min
                  </td>

                  <td className={`py-2.5 px-3.5 text-right font-sans ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {pol.escalateToTeam}
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
