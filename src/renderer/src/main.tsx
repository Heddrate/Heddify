import '@fontsource-variable/inter'
import '@fontsource-variable/unbounded'
import './styles/themes.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/views.css'
import './styles/motion.css'
import './styles/shell.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lib/presence'
import { initTheme } from './lib/theme'
import { loadWallpaper } from './lib/wallpaper'
import { ErrorBoundary } from './components/ErrorBoundary'

// Opening the renderer in a plain browser during development: use fake data.
if (__WEB__) {
  // the website: the services a browser can use on its own (web/bridge.ts)
  const { installWebBridge } = await import('./web/bridge')
  installWebBridge()
  window.dispatchEvent(new Event('sc-bridge'))
} else if (import.meta.env.DEV && !window.sc) {
  const { installMock } = await import('./dev/mock')
  installMock()
  window.dispatchEvent(new Event('sc-bridge'))
}

initTheme()
void loadWallpaper()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
