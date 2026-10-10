import { BrowserWindow, type WebContents } from 'electron'
import { store } from './store'
import {
  SC_PARTITION,
  apiRequest,
  clearWebSession,
  closeWebBridge,
  hasFirefoxIdentity,
  isSniffing,
  sniff,
  useFirefoxIdentity
} from './soundcloud'

type LoginResult = { ok: boolean; error?: string }

let loginWin: BrowserWindow | null = null
let pending: Promise<LoginResult> | null = null

/**
 * Opens the regular soundcloud.com sign-in page in its own window. Once the web app
 * starts making authorised requests we take the session token and close the window.
 */
export function login(parent: BrowserWindow): Promise<LoginResult> {
  if (loginWin && pending) {
    loginWin.focus()
    return pending
  }
  if (isSniffing()) return Promise.resolve({ ok: false, error: 'Подождите пару секунд и попробуйте снова' })

  pending = new Promise<LoginResult>((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 780,
      parent,
      title: store.getPrefs().lang === 'en' ? 'Sign in to SoundCloud' : 'Вход в SoundCloud',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: SC_PARTITION, sandbox: true, contextIsolation: true }
    })
    loginWin = win
    let done = false

    const finish = (result: LoginResult): void => {
      if (done) return
      done = true
      stop()
      loginWin = null
      pending = null
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }

    const stop = sniff((d) => {
      if (d.clientId) store.setClient(d.clientId, d.appVersion)
      if (d.token) {
        store.setToken(d.token)
        finish({ ok: true })
      }
    })

    // Google / Apple / Facebook sign-in opens popups; keep them in the same session.
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: { parent: win, width: 500, height: 700, autoHideMenuBar: true }
    }))
    routeGoogleThroughFirefox(win.webContents)
    win.webContents.on('did-create-window', (child, { url }) => {
      routeGoogleThroughFirefox(child.webContents)
      if (isGoogleSignIn(url)) {
        useFirefoxIdentity(child.webContents)
        void child.webContents.loadURL(url).catch(() => undefined)
      }
    })

    win.on('closed', () => finish({ ok: false, error: 'cancelled' }))
    win.loadURL('https://soundcloud.com/signin').catch(() => {
      /* the window shows Chromium's own error page */
    })
  })
  return pending
}

const isGoogleSignIn = (url: string): boolean => {
  try {
    const host = new URL(url).hostname
    return host === 'accounts.google.com' || host.endsWith('.accounts.google.com')
  } catch {
    return false
  }
}

/** Before a window enters Google sign-in, switch it to the Firefox identity and reload. */
function routeGoogleThroughFirefox(wc: WebContents): void {
  const handler = (e: Electron.Event, url: string): void => {
    if (!isGoogleSignIn(url) || hasFirefoxIdentity(wc)) return
    e.preventDefault()
    useFirefoxIdentity(wc)
    void wc.loadURL(url).catch(() => undefined)
  }
  wc.on('will-navigate', handler)
  wc.on('will-redirect', handler)
}

export function cancelLogin(): void {
  if (loginWin && !loginWin.isDestroyed()) loginWin.close()
}

export async function loginWithToken(raw: string): Promise<LoginResult> {
  // accepts the bare token, "OAuth <token>", or a pasted cookie string with oauth_token=…
  const fromCookie = raw.match(/oauth_token=([^;\s"']+)/i)?.[1]
  const token = (fromCookie ?? raw).trim().replace(/^["']|["']$/g, '').replace(/^(OAuth|Bearer)\s+/i, '')
  // old tokens look like 2-123456-…; newer ones are JWTs (eyJ….….…) with dots in them
  if (!/^[\w.-]{10,}$/.test(token)) return { ok: false, error: 'Токен выглядит некорректно' }
  const previous = store.getToken()
  store.setToken(token)
  const me = await apiRequest('GET', '/me')
  if (!me.ok) {
    store.setToken(previous)
    return { ok: false, error: me.status === 401 ? 'Токен не подошёл' : me.error }
  }
  return { ok: true }
}

export async function logout(): Promise<void> {
  store.setToken(null)
  closeWebBridge()
  await clearWebSession()
}
