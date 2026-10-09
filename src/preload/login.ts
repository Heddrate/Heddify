// Runs in every page of the soundcloud.com web session. Windows showing Google sign-in
// present themselves as Firefox (see useFirefoxIdentity in main); there, hide the
// Chromium-only UA Client Hints API so the page sees a consistent browser.
// Everywhere else this does nothing. Nothing is exposed to the page.
import { contextBridge } from 'electron'

if (navigator.userAgent.includes('Firefox/')) {
  contextBridge.executeInMainWorld({
    func: () => {
      try {
        Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true })
      } catch {
        /* already defined as non-configurable */
      }
    }
  })
}
