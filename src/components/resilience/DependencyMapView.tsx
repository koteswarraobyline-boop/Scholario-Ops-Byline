import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { Layers, ArrowDown, Shield, Server, Database, Globe, ArrowRight } from 'lucide-react';

export const DependencyMapView: React.FC = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    title: string;
    type: string;
    status: string;
    lastChecked: string;
    dependencies: string[];
    dependents: string[];
  }>({
    id: 'node-cf',
    title: 'Cloudflare Anycast Network',
    type: 'Edge & CDN',
    status: 'OPERATIONAL',
    lastChecked: '4 seconds ago',
    dependencies: ['Hostinger Edge Transit', 'Primary Origin VIP'],
    dependents: ['Public Internet Users', 'Scholario Mobile App']
  });

  const topologyLevels = [
    {
      levelName: '1. Ingress & Edge',
      nodes: [
        { id: 'node-users', title: 'Global Districts & Users', type: 'Ingress', status: 'HEALTHY', deps: [], dependents: ['Cloudflare Edge'] },
        { id: 'node-cf', title: 'Cloudflare Anycast CDN & LB', type: 'Edge Routing', status: 'HEALTHY', deps: ['Global Users'], dependents: ['Hostinger VPS Cluster'] }
      ]
    },
    {
      levelName: '2. Application Compute (Hostinger VPS)',
      nodes: [
        { id: 'node-ciph', title: 'Cipher LMS Engine', type: 'Node.js Cluster', status: 'HEALTHY', deps: ['Cloudflare'], dependents: ['MySQL', 'Redis'] },
        { id: 'node-apex', title: 'Apex SIS Records', type: 'PHP 8.3 / FPM', status: 'HEALTHY', deps: ['Cloudflare'], dependents: ['PostgreSQL 16'] },
        { id: 'node-mosa', title: 'Mosaic Exam Analytics', type: 'Node.js Engine', status: 'CRITICAL', deps: ['Cloudflare'], dependents: ['MySQL Clickhouse (Starved)'] },
        { id: 'node-vant', title: 'Vantage Billing Engine', type: 'Go Core Service', status: 'HEALTHY', deps: ['Cloudflare'], dependents: ['PCI Database', 'Vault'] }
      ]
    },
    {
      levelName: '3. Data & Storage Tier',
      nodes: [
        { id: 'node-db-ciph', title: 'Cipher Primary MySQL', type: 'Database Master', status: 'HEALTHY', deps: ['Cipher VPS'], dependents: ['DR Standby Replica'] },
        { id: 'node-db-mosa', title: 'Mosaic Analytics DB', type: 'Database (Starved)', status: 'CRITICAL', deps: ['Mosaic VPS'], dependents: ['Exam Exporter'] },
        { id: 'node-redis', title: 'Distributed Redis Mesh', type: 'Session Cache', status: 'HEALTHY', deps: ['App Nodes'], dependents: ['Auth Session Store'] },
        { id: 'node-s3', title: 'Hostinger S3 Cold Vault', type: 'Object Storage', status: 'HEALTHY', deps: ['Snapshot Backup Cron'], dependents: ['Long-term Archives'] }
      ]
    },
    {
      levelName: '4. Disaster Recovery (DR)',
      nodes: [
        { id: 'node-dr-sg', title: 'Singapore DR Standby', type: 'KVM 8 Standby', status: 'HEALTHY', deps: ['Master Binlog Stream'], dependents: ['Failover Pool'] },
        { id: 'node-dr-fra', title: 'Frankfurt DR Standby', type: 'KVM 8 Standby', status: 'HEALTHY', deps: ['PG WAL Replication'], dependents: ['Failover Pool'] }
      ]
    }
  ];

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            DEPENDENCY TOPOLOGY &amp; BLAST RADIUS MAP
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Hierarchical topology illustrating ingress, compute workloads, database tiers &amp; DR standby channels
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 font-mono text-xs">
        
        {/* Left Map Canvas */}
        <div className={`lg:col-span-2 rounded-lg border p-5 space-y-5 transition-colors ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          {topologyLevels.map((lvl, idx) => (
            <div key={lvl.levelName} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {lvl.levelName}
                </span>
                <div className={`flex-1 h-px ${isDark ? 'bg-[#1A2332]' : 'bg-slate-200'}`} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {lvl.nodes.map(n => {
                  const isCrit = n.status === 'CRITICAL';
                  const isSelected = selectedNode.id === n.id;

                  return (
                    <button
                      key={n.id}
                      onClick={() => setSelectedNode({
                        id: n.id,
                        title: n.title,
                        type: n.type,
                        status: n.status,
                        lastChecked: 'Just now',
                        dependencies: n.deps,
                        dependents: n.dependents
                      })}
                      className={`p-3 rounded border text-left transition-all cursor-pointer ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-500/10 shadow-xs ring-1 ring-blue-500' 
                          : isCrit 
                            ? (isDark ? 'bg-[#180E13] border-rose-900/80' : 'bg-rose-50 border-rose-300')
                            : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-slate-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300')
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`w-2 h-2 rounded-full ${isCrit ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                        <span className={`text-[9px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {n.type}
                        </span>
                      </div>
                      <div className={`font-bold text-xs mt-1.5 truncate font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{n.title}</div>
                      <div className={`text-[10px] mt-1 font-semibold ${isCrit ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {n.status}
                      </div>
                    </button>
                  );
                })}
              </div>

              {idx < topologyLevels.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className={`w-3.5 h-3.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right Node Inspector */}
        <div className={`rounded-lg border p-5 space-y-4 transition-colors ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`border-b pb-3 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
            <span className={`text-[9px] uppercase tracking-wider font-semibold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Topology Node Inspection</span>
            <h2 className="text-base font-bold font-sans mt-0.5">{selectedNode.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {selectedNode.type}
              </span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs font-bold ${selectedNode.status === 'HEALTHY' || selectedNode.status === 'OPERATIONAL' ? 'text-emerald-500' : 'text-rose-500'}`}>
                {selectedNode.status}
              </span>
            </div>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <span className={`text-[10px] uppercase block font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Upstream Dependencies:
              </span>
              <div className="space-y-1.5">
                {selectedNode.dependencies.length > 0 ? (
                  selectedNode.dependencies.map(d => (
                    <div key={d} className={`p-2 rounded border flex items-center gap-1.5 ${
                      isDark ? 'bg-[#0B0F17] border-[#1A2436] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}>
                      <span className="text-blue-500 font-bold">←</span>
                      <span>{d}</span>
                    </div>
                  ))
                ) : (
                  <div className={`italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Root of ingress tree (No upstream)</div>
                )}
              </div>
            </div>

            <div>
              <span className={`text-[10px] uppercase block font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Downstream Dependents (Blast Radius):
              </span>
              <div className="space-y-1.5">
                {selectedNode.dependents.length > 0 ? (
                  selectedNode.dependents.map(d => (
                    <div key={d} className={`p-2 rounded border flex items-center gap-1.5 ${
                      isDark ? 'bg-[#0B0F17] border-[#1A2436] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}>
                      <span className="text-amber-500 font-bold">→</span>
                      <span>{d}</span>
                    </div>
                  ))
                ) : (
                  <div className={`italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Terminal tier</div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
