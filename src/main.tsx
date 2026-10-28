import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Providers } from './app/providers.tsx'
import { bootstrapTelemetry } from './telemetry/bootstrap.ts'

// Best-effort: fetch telemetry config and init. Never blocks the app.
bootstrapTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
)
