import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import { HelmetProvider } from 'react-helmet-async'
import * as Sentry from "@sentry/react";
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import './styles/tokens.css'
import AppRoutes from './routes.tsx'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Publishable Key")
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "https://placeholder-dsn@sentry.io/0",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0, 
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ClerkProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </StrictMode>,
)
 bitumen: 121
