/**
 * Runs `cb` once `window.sc` exists. In the app the preload provides it before any code
 * runs; the browser preview installs a mock asynchronously and fires 'sc-bridge' after.
 */
export function whenBridge(cb: () => void): void {
  if (window.sc) cb()
  else window.addEventListener('sc-bridge', cb, { once: true })
}
