import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OpsProvider, useOps } from './context/OpsContext';

import { Shell } from './components/layout/Shell';
import { LoginPage } from './components/auth/LoginPage';
import { ViewErrorBoundary } from './components/ui/ViewErrorBoundary';
import { OverviewView } from './components/overview/OverviewView';
import { NotFoundView } from './components/ui/NotFoundView';

// Pages load on demand (Overview, the landing page, ships in the main bundle)
const ApplicationsView = lazy(() => import('./components/applications/ApplicationsView').then(m => ({ default: m.ApplicationsView })));
const InfrastructureView = lazy(() => import('./components/infrastructure/InfrastructureView').then(m => ({ default: m.InfrastructureView })));
const MonitorsView = lazy(() => import('./components/monitors/MonitorsView').then(m => ({ default: m.MonitorsView })));
const IncidentsView = lazy(() => import('./components/incidents/IncidentsView').then(m => ({ default: m.IncidentsView })));
const DrDashboardView = lazy(() => import('./components/resilience/DrDashboardView').then(m => ({ default: m.DrDashboardView })));
const BackupsView = lazy(() => import('./components/resilience/BackupsView').then(m => ({ default: m.BackupsView })));
const DependencyMapView = lazy(() => import('./components/resilience/DependencyMapView').then(m => ({ default: m.DependencyMapView })));
const HostingerView = lazy(() => import('./components/providers/HostingerView').then(m => ({ default: m.HostingerView })));
const CloudflareView = lazy(() => import('./components/providers/CloudflareView').then(m => ({ default: m.CloudflareView })));
const DeploymentsView = lazy(() => import('./components/operations/DeploymentsView').then(m => ({ default: m.DeploymentsView })));
const RunbooksView = lazy(() => import('./components/operations/RunbooksView').then(m => ({ default: m.RunbooksView })));
const MaintenanceView = lazy(() => import('./components/operations/MaintenanceView').then(m => ({ default: m.MaintenanceView })));
const CommunicationsView = lazy(() => import('./components/communications/CommunicationsView').then(m => ({ default: m.CommunicationsView })));
const ReportsView = lazy(() => import('./components/analytics/ReportsView').then(m => ({ default: m.ReportsView })));
const ReliabilityView = lazy(() => import('./components/analytics/ReliabilityView').then(m => ({ default: m.ReliabilityView })));
const ResourcesView = lazy(() => import('./components/capacity/ResourcesView').then(m => ({ default: m.ResourcesView })));
const AuditLogsView = lazy(() => import('./components/admin/AuditLogsView').then(m => ({ default: m.AuditLogsView })));
const UsersView = lazy(() => import('./components/admin/UsersView').then(m => ({ default: m.UsersView })));
const SetupView = lazy(() => import('./components/setup/SetupView').then(m => ({ default: m.SetupView })));

const ViewLoading: React.FC = () => (
  <div className="text-xs font-mono text-slate-500 animate-pulse p-2">Loading…</div>
);

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

  React.useEffect(() => {
    setActiveTab(tab);
  }, [tab, setActiveTab]);

  const viewMap: Record<string, React.ReactNode> = {
    setup:          <SetupView />,
    overview:       <OverviewView />,
    applications:   <ApplicationsView />,
    infrastructure: <InfrastructureView />,
    monitors:       <MonitorsView />,
    incidents:      <IncidentsView />,
    resilience:     <DrDashboardView />,
    backups:        <BackupsView />,
    dependencies:   <DependencyMapView />,
    hostinger:      <HostingerView />,
    cloudflare:     <CloudflareView />,
    deployments:    <DeploymentsView />,
    runbooks:       <RunbooksView />,
    maintenance:    <MaintenanceView />,
    communications: <CommunicationsView />,
    reliability:    <ReliabilityView />,
    resources:      <ResourcesView />,
    reports:        <ReportsView />,
    audit:          <AuditLogsView />,
    users:          <UsersView />,
  };

  return (
    <Shell>
      <ViewErrorBoundary resetKey={tab}>
        <Suspense fallback={<ViewLoading />}>{viewMap[tab] ?? <OverviewView />}</Suspense>
      </ViewErrorBoundary>
    </Shell>
  );
};

// ── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
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
    <Route path="/setup"         element={<DashboardView tab="setup" />} />
    <Route path="/real-vps"      element={<Navigate to="/setup" replace />} />
    <Route path="/overview"      element={<DashboardView tab="overview" />} />
    <Route path="/applications"  element={<DashboardView tab="applications" />} />
    <Route path="/infrastructure"element={<DashboardView tab="infrastructure" />} />
    <Route path="/monitors"      element={<DashboardView tab="monitors" />} />
    <Route path="/incidents"     element={<DashboardView tab="incidents" />} />
    <Route path="/resilience"    element={<DashboardView tab="resilience" />} />
    <Route path="/backups"       element={<DashboardView tab="backups" />} />
    <Route path="/dependencies"  element={<DashboardView tab="dependencies" />} />
    <Route path="/hostinger"     element={<DashboardView tab="hostinger" />} />
    <Route path="/cloudflare"    element={<DashboardView tab="cloudflare" />} />
    <Route path="/deployments"   element={<DashboardView tab="deployments" />} />
    <Route path="/runbooks"      element={<DashboardView tab="runbooks" />} />
    <Route path="/maintenance"   element={<DashboardView tab="maintenance" />} />
    <Route path="/communications"element={<DashboardView tab="communications" />} />
    <Route path="/reliability"   element={<DashboardView tab="reliability" />} />
    <Route path="/resources"     element={<DashboardView tab="resources" />} />
    <Route path="/reports"       element={<DashboardView tab="reports" />} />
    <Route path="/audit"         element={<DashboardView tab="audit" />} />
    <Route path="/users"         element={<DashboardView tab="users" />} />
    <Route path="*"              element={<Shell><NotFoundView /></Shell>} />
  </Routes>
);
