/**
 * Keyboard media keys (play/pause, next, previous, stop). Chromium only hears them while
 * its own media session is active, which breaks e.g. after a Yandex track or when another
 * app had them last. So while a track is loaded the app takes them system-wide, like
 * other music players do; with nothing loaded they're left to other apps.
 */
import { app, globalShortcut, type BrowserWindow } from 'electron'
import { log } from './soundcloud'

const KEYS: [string, 'toggle' | 'next' | 'prev' | 'pause'][] = [
  ['MediaPlayPause', 'toggle'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'prev'],
  ['MediaStop', 'pause']
]

let active = false

export function setMediaKeys(on: boolean, win: () => BrowserWindow | null): void {
  if (on === active || !app.isReady()) return
  active = on
  if (!on) {
    for (const [key] of KEYS) globalShortcut.unregister(key)
    return
  }
  const taken: string[] = []
  for (const [key, cmd] of KEYS) {
    const ok = globalShortcut.register(key, () => win()?.webContents.send('player:command', cmd))
    if (!ok) taken.push(key)
  }
  // another player holds them: Chromium's own media session handling still works
  if (taken.length) log(`media keys taken by another app: ${taken.join(', ')}`)
}

// a second instance quits before 'ready': globalShortcut would throw there
app.on('will-quit', () => {
  if (app.isReady()) globalShortcut.unregisterAll()
})
