import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import * as Sentry from "@sentry/react";
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import './styles/tokens.css'
import AppRoutes from './routes.tsx'
import './i18n'
import { AuthProvider } from './lib/auth'
import { TenantProvider } from './contexts/TenantContext'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (sentryDsn && !sentryDsn.includes('placeholder')) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <AuthProvider>
          <TenantProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </TenantProvider>
        </AuthProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </StrictMode>,
)
