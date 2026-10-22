/**
 * VK Music (ВКонтакте), like Yandex Music: the official vk.com page runs hidden in its own
 * session and plays the tracks itself (see renderer lib/vk.ts). Here: which pages may run
 * as that engine, the sign-in window, and signing out.
 */
import { BrowserWindow, session } from 'electron'

export const VK_PARTITION = 'persist:vk'

/** vk.com and vk.ru (VK moved there; vk.com still answers and sends Russian users on). */
export const isVk = (url?: string): boolean => /^https:\/\/(m\.)?vk\.(com|ru)(\/|$)/i.test(url ?? '')

/** VK and VK ID (id.vk.com, login.vk.ru …): sign-in pages and their popups. */
export const isVkFamily = (url?: string): boolean => /^https:\/\/([a-z0-9-]+\.)*vk\.(com|ru)(\/|$)/i.test(url ?? '')

/** The page's own idea of who is signed in: VK's user id, 0 when nobody is. */
const SIGNED_IN = '(() => { try { return (window.vk && Number(window.vk.id)) || 0 } catch (e) { return 0 } })()'

let loginWin: BrowserWindow | null = null

/**
 * VK sign-in in its own window (same session as the hidden VK page). It closes by itself
 * once the page there says someone is signed in.
 */
export function vkLogin(parent: BrowserWindow | null, english: boolean): Promise<boolean> {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus()
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent ?? undefined,
      title: english ? 'Sign in to VK' : 'Вход во ВКонтакте',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: VK_PARTITION, sandbox: true, contextIsolation: true }
    })
    loginWin = win
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      loginWin = null
      if (!win.isDestroyed()) win.close()
      resolve(ok)
    }
    const check = (): void => {
      if (done || win.isDestroyed() || !isVk(win.webContents.getURL())) return
      void win.webContents
        .executeJavaScript(SIGNED_IN)
        .then((id: unknown) => {
          if (Number(id) > 0) finish(true)
        })
        .catch(() => undefined)
    }
    win.webContents.on('did-stop-loading', check)
    win.webContents.on('did-navigate-in-page', check)
    win.webContents.setWindowOpenHandler(({ url }) =>
      isVkFamily(url)
        ? { action: 'allow', overrideBrowserWindowOptions: { parent: win, width: 500, height: 700, autoHideMenuBar: true } }
        : { action: 'deny' }
    )
    win.on('closed', () => finish(false))
    // signed out, vk.com shows its sign-in form; signed in, it moves on to the feed
    void win.loadURL('https://vk.com/').catch(() => undefined)
  })
}

export async function vkLogout(): Promise<void> {
  await session.fromPartition(VK_PARTITION).clearStorageData()
}

/**
 * Nobody sees the hidden VK page: pictures and fonts are not loaded there (the covers we
 * show come from the track data). The sign-in window loads everything as usual.
 */
const SKIP_TYPES = new Set(['image', 'font'])

export function lightenVkEngine(engineId: () => number | null): void {
  session.fromPartition(VK_PARTITION).webRequest.onBeforeRequest((details, callback) => {
    const id = engineId()
    callback({ cancel: id !== null && details.webContentsId === id && SKIP_TYPES.has(details.resourceType) })
  })
}
