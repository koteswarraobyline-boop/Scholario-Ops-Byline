import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEMO_SCENARIOS, type DemoScenario } from '../mocks/dependencyDemoData';

interface DependencyDemoState {
  enabled: boolean;
  scenario: DemoScenario | null;
  setEnabled: (on: boolean) => void;
  setScenarioId: (id: string | null) => void;
  resetSimulation: () => void;
}

const DependencyDemoContext = createContext<DependencyDemoState | undefined>(undefined);
const STORAGE_KEY = 'scholario-dependency-demo';

export const DependencyDemoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabledState] = useState(false);
  const [scenarioId, setScenarioIdState] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') setEnabledState(true);
    } catch {
      /* session storage is optional */
    }
  }, []);

  const setEnabled = (on: boolean) => {
    setEnabledState(on);
    if (!on) setScenarioIdState(null);
    try { sessionStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  };

  const value = useMemo<DependencyDemoState>(() => ({
    enabled,
    scenario: DEMO_SCENARIOS.find(item => item.id === scenarioId) ?? null,
    setEnabled,
    setScenarioId: setScenarioIdState,
    resetSimulation: () => setScenarioIdState(null),
  }), [enabled, scenarioId]);

  return <DependencyDemoContext.Provider value={value}>{children}</DependencyDemoContext.Provider>;
};

export function useDependencyDemo(): DependencyDemoState {
  const value = useContext(DependencyDemoContext);
  if (!value) throw new Error('useDependencyDemo must be used within DependencyDemoProvider');
  return value;
}
