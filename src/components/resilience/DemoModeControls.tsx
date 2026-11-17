import React from 'react';
import { DEMO_BANNER, DEMO_SCENARIOS } from '../../mocks/dependencyDemoData';
import { useDependencyDemo } from '../../context/DependencyDemoContext';

export const DemoBanner: React.FC = () => (
  <div role="status" className="rounded border border-violet-500 bg-violet-500/10 px-3 py-2 text-[11px] font-mono font-bold tracking-wide text-violet-600 dark:text-violet-300">
    {DEMO_BANNER}
  </div>
);

export const DemoToggle: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const demo = useDependencyDemo();
  return (
    <button
      type="button"
      aria-pressed={demo.enabled}
      onClick={() => demo.setEnabled(!demo.enabled)}
      className={`px-3 py-1.5 text-xs font-mono font-semibold rounded border cursor-pointer ${
        demo.enabled
          ? 'bg-violet-600 text-white border-violet-600'
          : isDark ? 'border-[#1E293B] text-slate-200' : 'border-slate-300 text-slate-700'
      }`}
    >
      {demo.enabled ? 'DEMO on' : 'DEMO off'}
    </button>
  );
};

export const DemoScenarios: React.FC = () => {
  const demo = useDependencyDemo();
  if (!demo.enabled) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-mono text-violet-200">HYPOTHETICAL SIMULATION. These buttons do not call the API.</p>
        <button type="button" onClick={demo.resetSimulation} className="px-3 py-1.5 text-xs font-semibold rounded bg-white text-slate-900 cursor-pointer">
          Reset simulation
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {DEMO_SCENARIOS.map(scenario => (
          <button
            key={scenario.id}
            type="button"
            aria-pressed={demo.scenario?.id === scenario.id}
            onClick={() => demo.setScenarioId(demo.scenario?.id === scenario.id ? null : scenario.id)}
            className={`px-2.5 py-1.5 rounded border text-left text-[11px] cursor-pointer ${
              demo.scenario?.id === scenario.id ? 'bg-rose-600 border-rose-600 text-white' : 'border-slate-500 text-slate-100'
            }`}
          >
            <span className="block font-semibold">{scenario.label}</span>
            <span className="block opacity-80">{scenario.summary}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
