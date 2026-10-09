/**
 * Tray icon: play / pause / next without opening the window, and — when "close to tray"
 * is on in Settings — the place the app lives after its window is closed.
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { store } from './store'

let tray: Tray | null = null
let state = { playing: false, hasTrack: false, title: '' }
let getWindow: () => BrowserWindow | null = () => null

/** The app icon: bundled next to the exe in the installed app, from build/ in development. */
export const appIconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png')

const ru = (): boolean => store.getPrefs().lang !== 'en'

export function showWindow(): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function send(cmd: 'prev' | 'toggle' | 'next'): void {
  getWindow()?.webContents.send('player:command', cmd)
}

function rebuild(): void {
  if (!tray) return
  const r = ru()
  tray.setToolTip(state.title ? `Heddify — ${state.title}` : 'Heddify')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(state.title ? [{ label: state.title.length > 60 ? state.title.slice(0, 57) + '…' : state.title, enabled: false }, { type: 'separator' as const }] : []),
      { label: state.playing ? (r ? 'Пауза' : 'Pause') : r ? 'Слушать' : 'Play', enabled: state.hasTrack, click: () => send('toggle') },
      { label: r ? 'Следующий трек' : 'Next track', enabled: state.hasTrack, click: () => send('next') },
      { label: r ? 'Предыдущий трек' : 'Previous track', enabled: state.hasTrack, click: () => send('prev') },
      { type: 'separator' },
      { label: r ? 'Открыть Heddify' : 'Open Heddify', click: showWindow },
      { label: r ? 'Выйти' : 'Quit', click: () => quitApp() }
    ])
  )
}

export function createTray(win: () => BrowserWindow | null): void {
  getWindow = win
  if (tray) return
  const icon = nativeImage.createFromPath(appIconPath()).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.on('click', showWindow)
  rebuild()
}

export function updateTray(next: { playing: boolean; hasTrack: boolean; title?: string }): void {
  const title = next.title ?? state.title
  if (next.playing === state.playing && next.hasTrack === state.hasTrack && title === state.title) return
  state = { playing: next.playing, hasTrack: next.hasTrack, title }
  rebuild()
}

/* ---------- close to tray ---------- */

let quitting = false

export const closeToTray = (): boolean => store.getPrefs().closeToTray === true && !quitting

/** Quits for real (past close-to-tray); `how` replaces the plain app.quit(), e.g. to install an update. */
export function quitApp(how: () => void = () => app.quit()): void {
  quitting = true
  how()
}

app.on('before-quit', () => {
  quitting = true
})
