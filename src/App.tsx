import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OpsProvider, useOps } from './context/OpsContext';
import { Shell } from './components/layout/Shell';
import { LoginPage } from './components/auth/LoginPage';

// All existing dashboard views — unchanged
import { OverviewView }      from './components/overview/OverviewView';
import { ApplicationsView }  from './components/applications/ApplicationsView';
import { InfrastructureView} from './components/infrastructure/InfrastructureView';
import { MonitorsView }      from './components/monitors/MonitorsView';
import { IncidentsView }     from './components/incidents/IncidentsView';
import { DrDashboardView }   from './components/resilience/DrDashboardView';
import { BackupsView }       from './components/resilience/BackupsView';
import { DependencyMapView } from './components/resilience/DependencyMapView';
import { HostingerView }     from './components/providers/HostingerView';
import { CloudflareView }    from './components/providers/CloudflareView';
import { DeploymentsView }   from './components/operations/DeploymentsView';
import { RunbooksView }      from './components/operations/RunbooksView';
import { MaintenanceView }   from './components/operations/MaintenanceView';
import { CommunicationsView} from './components/communications/CommunicationsView';
import { ReportsView }       from './components/analytics/ReportsView';
import { AuditLogsView }     from './components/admin/AuditLogsView';
import { UsersView }         from './components/admin/UsersView';

// ── Protected Route ──────────────────────────────────────────────────────────
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#070A10] flex items-center justify-center">
        <div className="text-slate-400 text-sm font-mono animate-pulse">Verifying session...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};

// ── Dashboard shell with tab-sync from URL ───────────────────────────────────
const DashboardView: React.FC<{ tab: string }> = ({ tab }) => {
  const { setActiveTab } = useOps();

  // Keep OpsContext activeTab in sync with URL
  React.useEffect(() => {
    setActiveTab(tab);
  }, [tab, setActiveTab]);

  const viewMap: Record<string, React.ReactNode> = {
    overview:       <OverviewView />,
    applications:   <ApplicationsView />,
    infrastructure: <InfrastructureView />,
    monitors:       <MonitorsView />,
    incidents:      <IncidentsView />,
    alerts:         <IncidentsView />,
    resilience:     <DrDashboardView />,
    failover:       <DrDashboardView />,
    backups:        <BackupsView />,
    dependencies:   <DependencyMapView />,
    hostinger:      <HostingerView />,
    cloudflare:     <CloudflareView />,
    deployments:    <DeploymentsView />,
    changes:        <DeploymentsView />,
    runbooks:       <RunbooksView />,
    maintenance:    <MaintenanceView />,
    communications: <CommunicationsView />,
    escalation:     <CommunicationsView />,
    integrations:   <CommunicationsView />,
    settings:       <CommunicationsView />,
    reports:        <ReportsView />,
    uptime:         <ReportsView />,
    audit:          <AuditLogsView />,
    users:          <UsersView />,
  };

  return <Shell>{viewMap[tab] ?? <OverviewView />}</Shell>;
};

// ── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected dashboard routes — all wrapped in OpsProvider + Shell */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <OpsProvider>
                  <DashboardRoutes />
                </OpsProvider>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Inner router that has access to OpsProvider
const DashboardRoutes: React.FC = () => (
  <Routes>
    <Route path="/"              element={<Navigate to="/overview" replace />} />
    <Route path="/overview"      element={<DashboardView tab="overview" />} />
    <Route path="/applications"  element={<DashboardView tab="applications" />} />
    <Route path="/infrastructure"element={<DashboardView tab="infrastructure" />} />
    <Route path="/monitors"      element={<DashboardView tab="monitors" />} />
    <Route path="/incidents"     element={<DashboardView tab="incidents" />} />
    <Route path="/alerts"        element={<DashboardView tab="alerts" />} />
    <Route path="/resilience"    element={<DashboardView tab="resilience" />} />
    <Route path="/failover"      element={<DashboardView tab="failover" />} />
    <Route path="/backups"       element={<DashboardView tab="backups" />} />
    <Route path="/dependencies"  element={<DashboardView tab="dependencies" />} />
    <Route path="/hostinger"     element={<DashboardView tab="hostinger" />} />
    <Route path="/cloudflare"    element={<DashboardView tab="cloudflare" />} />
    <Route path="/deployments"   element={<DashboardView tab="deployments" />} />
    <Route path="/runbooks"      element={<DashboardView tab="runbooks" />} />
    <Route path="/maintenance"   element={<DashboardView tab="maintenance" />} />
    <Route path="/communications"element={<DashboardView tab="communications" />} />
    <Route path="/escalation"    element={<DashboardView tab="escalation" />} />
    <Route path="/reports"       element={<DashboardView tab="reports" />} />
    <Route path="/uptime"        element={<DashboardView tab="uptime" />} />
    <Route path="/audit"         element={<DashboardView tab="audit" />} />
    <Route path="/users"         element={<DashboardView tab="users" />} />
    <Route path="/settings"      element={<DashboardView tab="settings" />} />
    <Route path="*"              element={<Navigate to="/overview" replace />} />
  </Routes>
);
