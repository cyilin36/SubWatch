import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import './i18n';
import './styles.css';
import { applyTheme } from './lib/theme';
import App from './App';

// The client is dark-only; stamp it before the first paint to avoid a flash.
applyTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          theme="dark"
          closeButton
          toastOptions={{
            classNames: {
              toast: 'glass-popover',
            },
            style: {
              background: 'rgb(18 28 48 / 0.82)',
              border: '1px solid rgb(255 255 255 / 0.15)',
              borderRadius: '16px',
              color: '#ffffff',
              boxShadow: '0 24px 64px rgb(3 7 18 / 0.65)',
              backdropFilter: 'blur(40px) saturate(180%)',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
