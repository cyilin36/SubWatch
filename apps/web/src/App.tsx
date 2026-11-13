import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './providers/AuthProvider';
import { AppLayout } from './components/layout/AppLayout';
import { AmbientBackground } from './components/layout/AmbientBackground';
import { BrandMark } from './components/layout/BrandMark';
import { LanguageMenu } from './components/layout/Controls';
import { Button, FullPageSpinner, TooltipProvider } from './components/ui';
import { errorMessage } from './lib/utils';
import { LoginPage, SetupPage } from './pages/AuthPages';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

// Heavy pages (CodeMirror/Recharts/etc.) are code-split so the initial load
// stays small; AppLayout renders a spinner while a chunk is fetched.
const MonitorNewPage = lazy(() =>
  import('./pages/MonitorNewPage').then((m) => ({ default: m.MonitorNewPage })),
);
const MonitorEditPage = lazy(() =>
  import('./pages/MonitorEditPage').then((m) => ({ default: m.MonitorEditPage })),
);
const MonitorDetailPage = lazy(() =>
  import('./pages/MonitorDetailPage').then((m) => ({ default: m.MonitorDetailPage })),
);
const SubscriptionNewPage = lazy(() =>
  import('./pages/SubscriptionNewPage').then((m) => ({ default: m.SubscriptionNewPage })),
);
const SubscriptionDetailPage = lazy(() =>
  import('./pages/SubscriptionDetailPage').then((m) => ({ default: m.SubscriptionDetailPage })),
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
const TemplatesPage = lazy(() =>
  import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
);
const TemplateEditorPage = lazy(() =>
  import('./pages/TemplateEditorPage').then((m) => ({ default: m.TemplateEditorPage })),
);

/**
 * Legacy routes from the pre-v2 multi-page layout (separate dashboard, monitor
 * list and subscription list pages). Everything now lives on `/`.
 */
const LEGACY_REDIRECTS = ['dashboard', 'monitors', 'subscriptions'];

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
    <div className="relative flex min-h-screen flex-col items-center justify-center px-5 py-16 text-center text-white">
      <AmbientBackground />
      <div className="glass glass-panel relative w-full max-w-lg p-8 sm:p-10">
        <BrandMark className="mx-auto h-12 w-12 rounded-[18px]" />
        <p className="type-label mt-8">{t('app.name')}</p>
        <h1 className="mt-3 text-subheading text-white">{t('auth.unableToConnect')}</h1>
        <p className="mt-3 break-words text-body text-moonlight">{errorMessage(error)}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={onRetry}>{t('auth.retry')}</Button>
          <LanguageMenu />
        </div>
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
        <Route index element={<HomePage />} />
        <Route path="subscriptions/new" element={<SubscriptionNewPage />} />
        <Route path="subscriptions/:id" element={<SubscriptionDetailPage />} />
        <Route path="monitors/new" element={<MonitorNewPage />} />
        <Route path="monitors/:id" element={<MonitorDetailPage />} />
        <Route path="monitors/:id/edit" element={<MonitorEditPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/new" element={<TemplateEditorPage />} />
        <Route path="templates/:id" element={<TemplateEditorPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {LEGACY_REDIRECTS.map((path) => (
          <Route key={path} path={path} element={<Navigate to="/" replace />} />
        ))}
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
