/**
 * Updates from GitHub Releases (electron-updater). A new version downloads quietly in the
 * background and is installed when the app restarts — or right away from the "Обновить"
 * button. Only the installed (NSIS) app updates itself; the portable exe and the zip don't.
 */
import { app, Notification, type BrowserWindow } from 'electron'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/ipc'
import { log } from './soundcloud'
import { appIconPath, quitApp } from './tray'
import { store } from './store'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }
let getWindow: () => BrowserWindow | null = () => null

/** Installed by the NSIS setup: its uninstaller sits next to the exe. */
function installed(): boolean {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return false
  try {
    return readdirSync(dirname(process.execPath)).some((f) => /^Uninstall .+\.exe$/i.test(f))
  } catch {
    return false
  }
}

function set(next: UpdateState): void {
  state = next
  getWindow()?.webContents.send('update:state', state)
}

export const updateState = (): UpdateState => state

export function checkForUpdates(): void {
  if (state.status === 'unsupported' || state.status === 'downloading' || state.status === 'ready') return
  set({ status: 'checking' })
  autoUpdater.checkForUpdates().catch((e: unknown) => {
    log(`update check failed: ${e instanceof Error ? e.message : String(e)}`)
    set({ status: 'error' })
  })
}

/**
 * Restarts into the downloaded version. The window closes and the silent installer runs for
 * ~30 s before the app opens again — a system notification says so, or it looks like a crash.
 */
export function installUpdate(): void {
  if (state.status !== 'ready') return
  const ru = store.getPrefs().lang !== 'en'
  if (Notification.isSupported()) {
    new Notification({
      title: ru ? 'Heddify обновляется' : 'Heddify is updating',
      body: ru ? 'Откроется сам через полминуты' : 'It will open again in about 30 seconds',
      icon: appIconPath(),
      silent: true
    }).show()
  }
  // a moment for the renderer's "Устанавливаю обновление" screen; close-to-tray must not keep the old version
  setTimeout(() => quitApp(() => autoUpdater.quitAndInstall(true, true)), 1200)
}

/** The release description (GitHub sends HTML) as a few plain lines for the banner. */
function noteLines(raw: unknown): string[] {
  const text = Array.isArray(raw) ? raw.map((n: { note?: string | null }) => n?.note ?? '').join('\n') : typeof raw === 'string' ? raw : ''
  return text
    .replace(/<\/(li|p|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.replace(/^[\s*•-]+/, '').trim())
    .filter((l) => l && !/^#/.test(l))
    .slice(0, 4)
}

export function startUpdater(win: () => BrowserWindow | null): void {
  getWindow = win
  if (!installed()) {
    state = { status: 'unsupported' }
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ status: 'latest' }))
  autoUpdater.on('download-progress', (p) =>
    set({ status: 'downloading', version: state.version, percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, notes: noteLines(i.releaseNotes) }))
  autoUpdater.on('error', (e) => {
    log(`update error: ${e?.message ?? e}`)
    if (state.status !== 'ready') set({ status: 'error' })
  })
  setTimeout(checkForUpdates, 15_000)
  setInterval(checkForUpdates, CHECK_EVERY_MS)
}
