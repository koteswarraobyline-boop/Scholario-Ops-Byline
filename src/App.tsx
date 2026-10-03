import React from 'react';
import { OpsProvider, useOps } from './context/OpsContext';
import { Shell } from './components/layout/Shell';
import { OverviewView } from './components/overview/OverviewView';
import { ApplicationsView } from './components/applications/ApplicationsView';
import { InfrastructureView } from './components/infrastructure/InfrastructureView';
import { MonitorsView } from './components/monitors/MonitorsView';
import { IncidentsView } from './components/incidents/IncidentsView';
import { DrDashboardView } from './components/resilience/DrDashboardView';
import { BackupsView } from './components/resilience/BackupsView';
import { DependencyMapView } from './components/resilience/DependencyMapView';
import { HostingerView } from './components/providers/HostingerView';
import { CloudflareView } from './components/providers/CloudflareView';
import { DeploymentsView } from './components/operations/DeploymentsView';
import { RunbooksView } from './components/operations/RunbooksView';
import { MaintenanceView } from './components/operations/MaintenanceView';
import { CommunicationsView } from './components/communications/CommunicationsView';
import { ReportsView } from './components/analytics/ReportsView';
import { AuditLogsView } from './components/admin/AuditLogsView';

const MainContent: React.FC = () => {
  const { activeTab } = useOps();

  switch (activeTab) {
    case 'overview':
      return <OverviewView />;
    case 'applications':
      return <ApplicationsView />;
    case 'infrastructure':
      return <InfrastructureView />;
    case 'monitors':
      return <MonitorsView />;
    case 'incidents':
    case 'alerts':
      return <IncidentsView />;
    case 'resilience':
    case 'failover':
      return <DrDashboardView />;
    case 'backups':
      return <BackupsView />;
    case 'dependencies':
      return <DependencyMapView />;
    case 'hostinger':
      return <HostingerView />;
    case 'cloudflare':
      return <CloudflareView />;
    case 'deployments':
    case 'changes':
      return <DeploymentsView />;
    case 'runbooks':
      return <RunbooksView />;
    case 'maintenance':
      return <MaintenanceView />;
    case 'communications':
    case 'escalation':
    case 'integrations':
    case 'settings':
      return <CommunicationsView />;
    case 'reports':
    case 'uptime':
      return <ReportsView />;
    case 'audit':
    case 'users':
      return <AuditLogsView />;
    default:
      return <OverviewView />;
  }
};

export default function App() {
  return (
    <OpsProvider>
      <Shell>
        <MainContent />
      </Shell>
    </OpsProvider>
  );
}
