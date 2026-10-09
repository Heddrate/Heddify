import './userData'
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, session, shell } from 'electron'
import { THUMB_ICONS } from './thumbIcons'
import { join } from 'node:path'
import { store } from './store'
import { apiRequest, closeWebBridge, log, prepareWebSession, resolveStream, setUiParent } from './soundcloud'
import { cancelLogin, login, loginWithToken, logout } from './auth'
import type { ApiMethod, ApiOptions, Presence, StreamRequest } from '../shared/ipc'
import { DEFAULT_DISCORD_APP_ID, discord } from './discord'
import {
  applyCacheLimit,
  cacheKey,
  cacheStats,
  cachedStream,
  clearCache,
  dropCached,
  listCached,
  pinTracks,
  registerCacheScheme,
  rememberStream,
  serveCache,
  unpinTracks
} from './cache'
import { resolveAudius } from './audius'
import { appIconPath, closeToTray, createTray, showWindow, updateTray } from './tray'
import { setMediaKeys } from './mediaKeys'
import { checkForUpdates, installUpdate, startUpdater, updateState } from './updater'

/** Window frame colours per theme, so the first frame already matches (see themes.css). */
const FRAME: Record<string, { bg: string; symbol: string }> = {
  dark: { bg: '#0b0b0b', symbol: '#a7a7a7' },
  oled: { bg: '#000000', symbol: '#a7a7a7' },
  graphite: { bg: '#1c1c1c', symbol: '#b3b3b3' },
  light: { bg: '#e9e9e9', symbol: '#5e5e5e' }
}

function frameColors(): { bg: string; symbol: string } {
  const theme = store.getPrefs().theme
  return FRAME[typeof theme === 'string' && theme in FRAME ? theme : 'dark']
}

// Present as regular Chrome: SoundCloud and Google sign-in refuse "Electron" user agents.
const chromeMajor = process.versions.chrome.split('.')[0]
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
app.setAppUserModelId('com.heddrate.scplayer')
// A music player: the (invisible) Yandex page must be allowed to start audio when we
// press its play button from code — Chromium otherwise waits for a real click on it.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

registerCacheScheme()

let mainWindow: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(() => {
    // No File/Edit menu; it also removes Ctrl+R / Ctrl+W accelerators in the shipped app.
    if (app.isPackaged) Menu.setApplicationMenu(null)
    prepareWebSession(join(__dirname, '../preload/login.js'))
    watchYandexApi()
    allowMediaCors()
    serveCache()
    registerIpc()
    createWindow()
    createTray(() => mainWindow)
    startUpdater(() => mainWindow)
  })
  app.on('window-all-closed', () => app.quit())
}

function visibleBounds(): Electron.Rectangle | undefined {
  const b = store.getBounds()
  if (!b || b.x === undefined || b.y === undefined) return undefined
  const rect = { x: b.x, y: b.y, width: b.width, height: b.height }
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
    return rect.x < a.x + a.width - 80 && rect.x + rect.width > a.x + 80 && rect.y >= a.y - 10 && rect.y < a.y + a.height - 80
  })
  return onScreen ? rect : undefined
}

function createWindow(): void {
  const saved = store.getBounds()
  const bounds = visibleBounds()
  const frame = frameColors()

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1320,
    height: saved?.height ?? 840,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Heddify',
    backgroundColor: frame.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: frame.bg, symbolColor: frame.symbol, height: 56 },
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
      // only for the embedded Yandex Music page, locked down in 'will-attach-webview'
      webviewTag: true
    }
  })

  mainWindow.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (!isYandexMusic(params.src) || params.partition !== YANDEX_PARTITION) {
      e.preventDefault()
      return
    }
    // never a preload chosen by the page; only our own volume hook (src/preload/yandex.ts)
    prefs.preload = join(__dirname, '../preload/yandex.js')
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
  })

  if (saved?.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    updateThumbar()
  })

  mainWindow.on('close', (e) => {
    if (!mainWindow) return
    store.setBounds({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() })
    // "close to tray": the music keeps playing, the tray icon brings the window back
    if (closeToTray()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  setUiParent(mainWindow)
  mainWindow.on('closed', () => {
    mainWindow = null
    setUiParent(null)
    // hidden helper windows (web bridge, session sync) must not keep the app alive;
    // destroy() skips their close handlers, which may be holding a captcha prompt open
    closeWebBridge()
    discord.close()
    app.quit()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  // renderer problems land in the same diagnostics log as API errors
  mainWindow.webContents.on('console-message', (e) => {
    if (e.level === 'error') log(`renderer: ${e.message.slice(0, 500)} (${e.sourceId.split('/').pop()}:${e.lineNumber})`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) => log(`renderer gone: ${d.reason} (${d.exitCode})`))
  mainWindow.webContents.on('preload-error', (_e, p, err) => log(`preload error ${p}: ${err.message}`))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * hls.js fetches playlists/segments and we sample artwork colours on a canvas;
 * SoundCloud's CDN doesn't send CORS headers for a file:// origin, so add them.
 */
function allowMediaCors(): void {
  const types = new Set(['xhr', 'media', 'image', 'other'])
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (details, callback) => {
    if (!types.has(details.resourceType)) return callback({})
    const headers = { ...(details.responseHeaders ?? {}) }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith('access-control-allow-')) delete headers[key]
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Headers'] = ['*']
    callback({ responseHeaders: headers })
  })
}

/* ---------- embedded Yandex Music (its own site, its own session) ---------- */

const YANDEX_PARTITION = 'persist:yandex'

const isYandexMusic = (url?: string): boolean => /^https:\/\/music\.yandex\.(ru|com|by|kz|uz)(\/|$)/i.test(url ?? '')

/**
 * Headers the Yandex Music web app sends to its own API (auth, client id). The renderer
 * repeats API calls from inside the page with them, exactly like the site does.
 * Cookies are not captured; they stay in the session.
 */
const YA_HEADER_KEYS = /^(authorization|x-yandex-music-[a-z-]+|accept-language)$/i
let yandexHeaders: Record<string, string> = {}

function watchYandexApi(): void {
  session.fromPartition(YANDEX_PARTITION).webRequest.onBeforeSendHeaders(
    { urls: ['https://api.music.yandex.ru/*', 'https://api.music.yandex.net/*'] },
    (details, callback) => {
      callback({ requestHeaders: details.requestHeaders })
      const picked: Record<string, string> = {}
      for (const [k, v] of Object.entries(details.requestHeaders)) if (YA_HEADER_KEYS.test(k)) picked[k] = v
      if (!Object.keys(picked).length) return
      const merged = { ...yandexHeaders, ...picked }
      if (JSON.stringify(merged) === JSON.stringify(yandexHeaders)) return
      yandexHeaders = merged
      mainWindow?.webContents.send('ya:headers', yandexHeaders)
    }
  )
}

/**
 * Yandex sign-in in its own window (same session as the hidden Yandex Music page),
 * like the SoundCloud one: it closes by itself once Yandex sends us back to music.
 */
let yandexLoginWin: BrowserWindow | null = null

function yandexLogin(): Promise<boolean> {
  if (yandexLoginWin && !yandexLoginWin.isDestroyed()) {
    yandexLoginWin.focus()
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: mainWindow ?? undefined,
      title: store.getPrefs().lang === 'en' ? 'Sign in to Yandex' : 'Вход в Яндекс',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: YANDEX_PARTITION, sandbox: true, contextIsolation: true }
    })
    yandexLoginWin = win
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      yandexLoginWin = null
      if (!win.isDestroyed()) win.close()
      resolve(ok)
    }
    const check = (_e: unknown, url: string): void => {
      if (isYandexMusic(url)) finish(true)
    }
    win.webContents.on('did-navigate', check)
    win.webContents.on('did-redirect-navigation', check)
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: { parent: win, width: 500, height: 700, autoHideMenuBar: true }
    }))
    win.on('closed', () => finish(false))
    void win.loadURL(`https://passport.yandex.ru/auth?retpath=${encodeURIComponent('https://music.yandex.ru/')}`).catch(() => undefined)
  })
}

/** Sign-in (passport.yandex.ru, social logins) opens popups; keep them inside the Yandex session. */
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(yandex\.(ru|com|by|kz|uz)|ya\.ru)(\/|$)/i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true } }
    }
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

/* ---------- taskbar thumbnail buttons: previous / play-pause / next ---------- */

let thumbState = { playing: false, hasTrack: false }

function updateThumbar(): void {
  if (!mainWindow || process.platform !== 'win32') return
  const send = (cmd: string) => () => mainWindow?.webContents.send('player:command', cmd)
  const flags: ('disabled' | 'enabled')[] = [thumbState.hasTrack ? 'enabled' : 'disabled']
  const ru = store.getPrefs().lang !== 'en'
  mainWindow.setThumbarButtons([
    { tooltip: ru ? 'Предыдущий' : 'Previous', icon: nativeImage.createFromDataURL(THUMB_ICONS.prev), click: send('prev'), flags },
    {
      tooltip: thumbState.playing ? (ru ? 'Пауза' : 'Pause') : ru ? 'Слушать' : 'Play',
      icon: nativeImage.createFromDataURL(thumbState.playing ? THUMB_ICONS.pause : THUMB_ICONS.play),
      click: send('toggle'),
      flags
    },
    { tooltip: ru ? 'Следующий' : 'Next', icon: nativeImage.createFromDataURL(THUMB_ICONS.next), click: send('next'), flags }
  ])
}

/** Rich Presence is on by default with the bundled application id. */
function configureDiscord(): void {
  const prefs = store.getPrefs()
  const enabled = prefs.discordEnabled !== false
  const custom = typeof prefs.discordAppId === 'string' ? prefs.discordAppId.trim() : ''
  const id = /^\d{17,20}$/.test(custom) ? custom : DEFAULT_DISCORD_APP_ID
  discord.configure(enabled ? id : null)
}

function registerIpc(): void {
  ipcMain.handle('auth:status', () => ({ loggedIn: !!store.getToken() }))
  ipcMain.handle('auth:login', () => (mainWindow ? login(mainWindow) : { ok: false, error: 'no window' }))
  ipcMain.handle('auth:cancel', () => cancelLogin())
  ipcMain.handle('auth:setToken', (_e, token: unknown) => loginWithToken(String(token ?? '')))
  ipcMain.handle('auth:logout', () => logout())

  ipcMain.handle(
    'api',
    (_e, method: ApiMethod, path: string, params?: Record<string, string>, body?: unknown, opts?: ApiOptions) => {
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return { ok: false, status: 0, error: 'bad method' }
      return apiRequest(method, String(path), params, body, false, opts?.quiet === true)
    }
  )
  const resolveNetwork = (req: StreamRequest): ReturnType<typeof resolveStream> =>
    req.audius ? resolveAudius(String(req.audius), req.fresh === true) : resolveStream(req)
  ipcMain.handle('stream:resolve', async (_e, req: StreamRequest) => {
    const key = cacheKey(req)
    if (req.fresh) await dropCached(key)
    else {
      const hit = await cachedStream(key)
      if (hit) return { ok: true, status: 200, data: hit }
    }
    const res = await resolveNetwork(req)
    if (res.ok) rememberStream(key, res.data, req.meta)
    return res
  })
  ipcMain.handle('cache:list', () => listCached())
  ipcMain.handle('cache:unpin', (_e, keys: unknown) => unpinTracks(Array.isArray(keys) ? keys.map(String) : []))
  ipcMain.handle('cache:download', (_e, reqs: unknown) => {
    const list = (Array.isArray(reqs) ? reqs : []).filter((r): r is StreamRequest => !!r && typeof (r as StreamRequest).id === 'number')
    void pinTracks(list, resolveNetwork, (p) => mainWindow?.webContents.send('cache:progress', p))
  })
  ipcMain.handle('cache:stats', () => cacheStats())
  ipcMain.handle('cache:clear', () => clearCache())

  ipcMain.handle('prefs:get', () => store.getPrefs())
  ipcMain.handle('prefs:set', (_e, patch: Record<string, unknown>) => {
    store.setPrefs(patch)
    if ('discordEnabled' in patch || 'discordAppId' in patch) configureDiscord()
    if ('cacheLimitMb' in patch) void applyCacheLimit()
    if (patch.cacheEnabled === false) void clearCache()
  })

  ipcMain.handle('shell:open', (_e, url: unknown) => {
    const u = String(url)
    if (/^https:\/\/([a-z0-9-]+\.)*(soundcloud\.com|discord\.com|music\.yandex\.ru|audius\.co)(\/|$)/i.test(u)) return shell.openExternal(u)
  })
  ipcMain.handle('logs:open', () => shell.openPath(join(app.getPath('userData'), 'logs')))

  ipcMain.on('window:theme', (_e, c: { bg?: unknown; symbol?: unknown }) => {
    const hex = /^#[0-9a-f]{6}$/i
    if (!mainWindow || typeof c?.bg !== 'string' || typeof c.symbol !== 'string') return
    if (!hex.test(c.bg) || !hex.test(c.symbol)) return
    mainWindow.setBackgroundColor(c.bg)
    mainWindow.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 56 })
  })

  ipcMain.handle('ya:headers', () => yandexHeaders)
  ipcMain.handle('ya:login', () => yandexLogin())
  ipcMain.handle('ya:logout', async () => {
    yandexHeaders = {}
    await session.fromPartition(YANDEX_PARTITION).clearStorageData()
  })

  ipcMain.on('player:state', (_e, s: { playing?: unknown; hasTrack?: unknown; title?: unknown }) => {
    thumbState = { playing: s?.playing === true, hasTrack: s?.hasTrack === true }
    updateTray({ ...thumbState, title: typeof s?.title === 'string' ? s.title.slice(0, 200) : '' })
    setMediaKeys(thumbState.hasTrack, () => mainWindow)
    updateThumbar()
  })

  ipcMain.on('discord:update', (_e, p: Presence | null) => discord.update(p))
  ipcMain.handle('discord:status', () => discord.status)
  discord.onError = (m) => log(`discord error: ${m}`)
  discord.onStatus = (s) => {
    if (s !== 'connecting') log(`discord: ${s}`)
    mainWindow?.webContents.send('discord:status', s)
  }
  configureDiscord()
  ipcMain.handle('update:get', () => updateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('clipboard:write', (_e, text: unknown) => clipboard.writeText(String(text ?? '')))
}
