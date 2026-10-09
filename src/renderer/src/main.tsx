import '@fontsource-variable/inter'
import './styles/themes.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/views.css'
import './styles/motion.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lib/presence'
import { initTheme } from './lib/theme'
import { ErrorBoundary } from './components/ErrorBoundary'

// Opening the renderer in a plain browser during development: use fake data.
if (import.meta.env.DEV && !window.sc) {
  const { installMock } = await import('./dev/mock')
  installMock()
  window.dispatchEvent(new Event('sc-bridge'))
}

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
