import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './providers/AuthProvider';
import { AppLayout } from './components/layout/AppLayout';
import { BrandMark } from './components/layout/Sidebar';
import { LanguageMenu, ThemeMenu } from './components/layout/Controls';
import { Button, FullPageSpinner, TooltipProvider } from './components/ui';
import { errorMessage } from './lib/utils';
import { LoginPage, SetupPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Heavy pages (CodeMirror/Recharts/etc.) are code-split so the initial load
// stays small; AppLayout renders a spinner while a chunk is fetched.
const MonitorsPage = lazy(() => import('./pages/MonitorsPage').then((m) => ({ default: m.MonitorsPage })));
const MonitorNewPage = lazy(() =>
  import('./pages/MonitorNewPage').then((m) => ({ default: m.MonitorNewPage })),
);
const MonitorEditPage = lazy(() =>
  import('./pages/MonitorEditPage').then((m) => ({ default: m.MonitorEditPage })),
);
const MonitorDetailPage = lazy(() =>
  import('./pages/MonitorDetailPage').then((m) => ({ default: m.MonitorDetailPage })),
);
const SubscriptionsPage = lazy(() =>
  import('./pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })),
);
const SubscriptionNewPage = lazy(() =>
  import('./pages/SubscriptionNewPage').then((m) => ({ default: m.SubscriptionNewPage })),
);
const SubscriptionDetailPage = lazy(() =>
  import('./pages/SubscriptionDetailPage').then((m) => ({ default: m.SubscriptionDetailPage })),
);
const TemplatesPage = lazy(() =>
  import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
);
const ChannelsPage = lazy(() =>
  import('./pages/ChannelsPage').then((m) => ({ default: m.ChannelsPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authenticated, setupRequired, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function SetupRoute() {
  const { setupRequired, authenticated, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!setupRequired) return <Navigate to={authenticated ? '/' : '/login'} replace />;
  return <SetupPage />;
}

function LoginRoute() {
  const { setupRequired, authenticated, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (authenticated) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function ConnectionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center text-[var(--foreground)]">
      <BrandMark className="h-12 w-12" />
      <h1 className="mt-1 text-lg font-semibold">{t('auth.unableToConnect')}</h1>
      <p className="max-w-md break-words text-sm text-[var(--muted-foreground)]">{errorMessage(error)}</p>
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={onRetry}>{t('auth.retry')}</Button>
        <LanguageMenu />
        <ThemeMenu />
      </div>
    </div>
  );
}

function AppRoutes() {
  const { isLoading, error, retry } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (error) return <ConnectionError error={error} onRetry={retry} />;

  return (
    <Routes>
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/login" element={<LoginRoute />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="monitors/new" element={<MonitorNewPage />} />
        <Route path="monitors/:id" element={<MonitorDetailPage />} />
        <Route path="monitors/:id/edit" element={<MonitorEditPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="subscriptions/new" element={<SubscriptionNewPage />} />
        <Route path="subscriptions/:id" element={<SubscriptionDetailPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
