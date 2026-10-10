import { app, BrowserWindow, net, session, type Cookie, type Session, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { store } from './store'
import type { ApiMethod, ApiResult, StreamInfo, StreamRequest, Transcoding } from '../shared/ipc'

/**
 * Persistent browser partition that holds the user's soundcloud.com web session.
 * Our own API calls go through the default session so the sniffer below
 * only ever sees traffic made by the SoundCloud web app itself.
 */
export const SC_PARTITION = 'persist:soundcloud'
const API_HOST = 'api-v2.soundcloud.com'
const API = `https://${API_HOST}`

export const scSession = (): Session => session.fromPartition(SC_PARTITION)

export interface Sniffed {
  token?: string
  clientId?: string
  appVersion?: string
}

/**
 * Google refuses to sign in inside embedded Chromium ("this browser or app may not be
 * secure"), so windows showing Google sign-in present themselves as a current Firefox:
 * UA string, no Chromium client-hint headers, no navigator.userAgentData (preload/login.ts).
 * Only those windows — soundcloud.com itself must see the real Chromium identity, or its
 * anti-bot protection starts demanding captchas.
 * The version follows Firefox's 4-week release train so it never looks outdated.
 */
function firefoxUA(): string {
  const weeks = (Date.now() - Date.UTC(2022, 4, 3)) / (7 * 86400_000)
  const version = 100 + Math.floor(weeks / 4) - 1
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`
}

const firefoxContents = new Set<number>()

export function useFirefoxIdentity(wc: WebContents): void {
  if (firefoxContents.has(wc.id)) return
  const id = wc.id
  firefoxContents.add(id)
  wc.setUserAgent(firefoxUA())
  wc.once('destroyed', () => firefoxContents.delete(id))
}

export const hasFirefoxIdentity = (wc: WebContents): boolean => firefoxContents.has(wc.id)

let onSniff: ((d: Sniffed) => void) | null = null

/** Call once after app 'ready', before any sign-in window is created. */
export function prepareWebSession(preloadPath: string): void {
  const ses = scSession()
  ses.registerPreloadScript({ type: 'frame', filePath: preloadPath })

  // The only onBeforeSendHeaders listener for this session (Electron allows one).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    if (details.webContentsId !== undefined && firefoxContents.has(details.webContentsId)) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith('sec-ch-ua')) delete headers[key]
      }
    }
    callback({ requestHeaders: headers })

    if (!onSniff || !details.url.startsWith(`${API}/`)) return
    const found: Sniffed = {}
    try {
      const u = new URL(details.url)
      found.clientId = u.searchParams.get('client_id') ?? undefined
      found.appVersion = u.searchParams.get('app_version') ?? undefined
    } catch {
      /* ignore malformed url */
    }
    const auth = headers['Authorization'] ?? headers['authorization']
    const m = auth?.match(/^(?:OAuth|Bearer)\s+(\S+)/i)
    if (m) found.token = m[1]
    if (found.clientId || found.token) onSniff(found)
  })
}

/**
 * Watches requests the SoundCloud web app makes inside our partition and reports
 * the OAuth token and client id it uses. Returns a function that stops watching.
 */
export function sniff(onData: (d: Sniffed) => void): () => void {
  const ses = scSession()
  onSniff = onData

  const onCookie = (_e: unknown, cookie: Cookie, _cause: string, removed: boolean): void => {
    if (removed || cookie.name !== 'oauth_token' || !cookie.value) return
    if (!cookie.domain?.endsWith('soundcloud.com')) return
    onData({ token: decodeURIComponent(cookie.value) })
  }
  ses.cookies.on('changed', onCookie)

  return () => {
    if (onSniff === onData) onSniff = null
    ses.cookies.removeListener('changed', onCookie)
  }
}

export const isSniffing = (): boolean => onSniff !== null

let syncing: Promise<boolean> | null = null
let lastSync = 0

/**
 * Opens soundcloud.com in a hidden window using the stored web session and picks up
 * the client id (and refreshed token, if the web session is signed in) it uses.
 */
export function syncSession(timeoutMs = 25000): Promise<boolean> {
  if (syncing) return syncing
  if (isSniffing()) return Promise.resolve(false)
  lastSync = Date.now()

  syncing = new Promise<boolean>((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { partition: SC_PARTITION, sandbox: true, contextIsolation: true }
    })
    win.webContents.setAudioMuted(true)
    let gotClient = false

    const finish = (ok: boolean): void => {
      clearTimeout(timer)
      stop()
      if (!win.isDestroyed()) win.destroy()
      syncing = null
      resolve(ok)
    }

    const stop = sniff((d) => {
      if (d.token && store.getToken()) store.setToken(d.token)
      if (d.clientId) {
        store.setClient(d.clientId, d.appVersion)
        gotClient = true
        // give the page a moment to issue an authorised request too
        setTimeout(() => finish(true), 1500)
      }
    })
    const timer = setTimeout(() => finish(gotClient), timeoutMs)
    win.loadURL('https://soundcloud.com/discover').catch(() => {
      /* navigation errors are reported via timeout */
    })
  })
  return syncing
}

const canResync = (): boolean => Date.now() - lastSync > 60_000

type Params = Record<string, string | number | boolean | undefined>

export async function apiRequest<T = unknown>(
  method: ApiMethod,
  pathOrUrl: string,
  params?: Params,
  body?: unknown,
  retried = false,
  quiet = false
): Promise<ApiResult<T>> {
  let url: URL
  try {
    url = new URL(pathOrUrl.startsWith('https://') ? pathOrUrl : API + pathOrUrl)
  } catch {
    return { ok: false, status: 0, error: 'Некорректный адрес запроса' }
  }
  if (url.hostname !== API_HOST) return { ok: false, status: 0, error: 'Запрещённый хост' }

  if (!store.getClient().clientId) await syncSession()
  const { clientId, appVersion } = store.getClient()

  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  if (clientId) url.searchParams.set('client_id', clientId)
  if (appVersion) url.searchParams.set('app_version', appVersion)
  if (!url.searchParams.has('app_locale')) url.searchParams.set('app_locale', 'ru')

  const headers: Record<string, string> = { Accept: 'application/json, text/javascript, */*; q=0.01' }
  const token = store.getToken()
  if (token) headers.Authorization = `OAuth ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const payload = body !== undefined ? JSON.stringify(body) : undefined
  let res: { status: number; text: string; via: string }
  try {
    res =
      method === 'GET'
        ? await fetchDirect(method, url.toString(), headers, payload)
        : await fetchWrite(method, url.toString(), headers, payload, quiet)
  } catch (e) {
    log(`${method} ${url.pathname} -> network error: ${e instanceof Error ? e.message : e}`)
    return { ok: false, status: 0, error: 'Нет соединения с SoundCloud' }
  }

  let data: unknown = null
  if (res.text) {
    try {
      data = JSON.parse(res.text)
    } catch {
      data = res.text
    }
  }

  const ok = res.status >= 200 && res.status < 300
  if (!ok || method !== 'GET') {
    log(`${method} ${url.pathname} [${res.via}] -> ${res.status}${ok ? '' : ' ' + res.text.slice(0, 300).replace(/\s+/g, ' ')}`)
  }
  if (ok) return { ok: true, status: res.status, data: data as T }

  // A stale client id also yields 401: refresh it from the web session once and retry.
  // Writes don't trigger this — a 401 there is usually about the endpoint, not the session.
  if (res.status === 401 && method === 'GET' && !retried && canResync()) {
    await syncSession()
    return apiRequest<T>(method, pathOrUrl, params, body, true, quiet)
  }

  return {
    ok: false,
    status: res.status,
    error:
      antiBot(res) === 'blocked'
        ? ANTIBOT_BLOCKED
        : isCaptcha(res)
          ? 'SoundCloud попросил подтвердить, что вы не робот — попробуйте ещё раз'
          : errorText(res.status),
    auth: res.status === 401,
    blocked: isCaptcha(res)
  }
}

/**
 * DataDome (SoundCloud's anti-bot service) answers 403 with a link: `t=fe` is a captcha the
 * user can solve, `t=bv` is a temporary block of the network/session that nothing can lift.
 */
function antiBot(r: { status: number; text: string }): 'captcha' | 'blocked' | null {
  if (r.status !== 403 || !r.text.includes('captcha-delivery.com')) return null
  try {
    const link = new URL((JSON.parse(r.text) as { url: string }).url)
    return link.searchParams.get('t') === 'bv' ? 'blocked' : 'captcha'
  } catch {
    return 'captcha'
  }
}

const isCaptcha = (r: { status: number; text: string }): boolean => antiBot(r) !== null

const ANTIBOT_BLOCKED =
  'SoundCloud временно ограничил лайки и подписки для вашей сети. Часто так бывает с VPN — попробуйте без него или позже. Слушать музыку это не мешает'

async function fetchDirect(
  method: ApiMethod,
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; text: string; via: string }> {
  const r = await net.fetch(url, { method, headers, body })
  return { status: r.status, text: await r.text().catch(() => ''), via: 'direct' }
}

/**
 * SoundCloud only accepts likes/follows that come from soundcloud.com itself. Writes are
 * sent from a hidden soundcloud.com page in the user's web session — same origin, cookies,
 * browser identity and anti-bot script as the real website. If SoundCloud still asks for
 * a captcha, that page is shown so the user can answer it, then the request is repeated.
 */
async function fetchWrite(
  method: ApiMethod,
  url: string,
  headers: Record<string, string>,
  body?: string,
  quiet = false
): Promise<{ status: number; text: string; via: string }> {
  let win: BrowserWindow
  try {
    win = await webBridge()
  } catch (e) {
    log(`${method} ${new URL(url).pathname} web bridge failed: ${e instanceof Error ? e.message : e}`)
    return fetchDirect(method, url, headers, body)
  }
  touchBridge()

  const script = `(async () => {
    const r = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      headers: ${JSON.stringify(headers)},
      body: ${body === undefined ? 'undefined' : JSON.stringify(body)}
    });
    return { status: r.status, text: await r.text() };
  })()`
  const run = async (): Promise<{ status: number; text: string; via: string }> => {
    const r = (await win.webContents.executeJavaScript(script, true)) as { status: number; text: string }
    return { ...r, via: 'web' }
  }

  let res = await run()
  const kind = antiBot(res)
  if (kind === 'blocked') {
    log(`${method} ${new URL(url).pathname} -> blocked by SoundCloud anti-bot (DataDome t=bv)`)
  } else if (kind === 'captcha' && quiet) {
    log(`${method} ${new URL(url).pathname} -> captcha (background request, not shown)`)
  } else if (kind === 'captcha') {
    log(`${method} ${new URL(url).pathname} -> captcha, showing it to the user`)
    if (await askUserForCaptcha(win)) res = await run()
  }
  return res
}

let uiParent: BrowserWindow | null = null
export const setUiParent = (win: BrowserWindow | null): void => {
  uiParent = win
}

let bridge: BrowserWindow | null = null
let bridgeReady: Promise<BrowserWindow> | null = null
let bridgeIdle: ReturnType<typeof setTimeout> | null = null
let captchaWait: Promise<boolean> | null = null

const BRIDGE_IDLE_MS = 3 * 60_000

/** The hidden page is a full soundcloud.com tab; drop it after a few quiet minutes. */
function touchBridge(): void {
  if (bridgeIdle) clearTimeout(bridgeIdle)
  bridgeIdle = setTimeout(() => {
    if (!captchaWait) closeWebBridge()
  }, BRIDGE_IDLE_MS)
}

function webBridge(): Promise<BrowserWindow> {
  if (bridge && !bridge.isDestroyed()) return Promise.resolve(bridge)
  if (bridgeReady) return bridgeReady

  bridgeReady = new Promise<BrowserWindow>((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 520,
      height: 720,
      parent: uiParent ?? undefined,
      title: 'SoundCloud',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: SC_PARTITION, sandbox: true, contextIsolation: true }
    })
    win.webContents.setAudioMuted(true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const timer = setTimeout(() => fail('timeout'), 30_000)
    const fail = (why: string): void => {
      clearTimeout(timer)
      bridgeReady = null
      if (!win.isDestroyed()) win.destroy()
      reject(new Error(why))
    }
    win.on('closed', () => {
      if (bridge === win) bridge = null
    })

    // A real page, so SoundCloud's anti-bot script runs and vouches for the session.
    // The load may be "aborted" by the site's own client-side redirects; that's fine.
    win
      .loadURL('https://soundcloud.com/discover')
      .catch(() => undefined)
      .then(() => new Promise((r) => setTimeout(r, 1500)))
      .then(() => {
        if (win.isDestroyed()) return fail('closed')
        clearTimeout(timer)
        bridge = win
        bridgeReady = null
        resolve(win)
      })
  })
  return bridgeReady
}

/**
 * Shows the hidden soundcloud.com page: SoundCloud's own anti-bot script renders the
 * captcha there. Resolves true once its cookie is renewed (solved) or the user closes
 * the window, false after 5 minutes.
 */
function askUserForCaptcha(win: BrowserWindow): Promise<boolean> {
  if (captchaWait) return captchaWait
  captchaWait = new Promise<boolean>((resolve) => {
    const ses = scSession()
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      ses.cookies.removeListener('changed', onCookie)
      if (!win.isDestroyed()) {
        win.removeListener('close', onClose)
        win.hide()
      }
      captchaWait = null
      resolve(ok)
    }
    const onCookie = (_e: unknown, cookie: Cookie, _cause: string, removed: boolean): void => {
      if (!removed && cookie.name === 'datadome') setTimeout(() => finish(true), 800)
    }
    // closing means "done" here; the page itself stays alive for the next write
    const onClose = (e: Electron.Event): void => {
      e.preventDefault()
      finish(true)
    }
    const timer = setTimeout(() => finish(false), 5 * 60_000)
    ses.cookies.on('changed', onCookie)
    win.on('close', onClose)
    win.setTitle(
      store.getPrefs().lang === 'en'
        ? 'SoundCloud: confirm you are not a robot, then close this window'
        : 'SoundCloud: подтвердите, что вы не робот, и закройте окно'
    )
    win.center()
    win.show()
    win.focus()
  })
  return captchaWait
}

export function closeWebBridge(): void {
  if (bridgeIdle) clearTimeout(bridgeIdle)
  bridgeIdle = null
  if (bridge && !bridge.isDestroyed()) bridge.destroy()
  bridge = null
}

/** Append-only diagnostics without tokens or query strings: userData/logs/api.log. */
export function log(line: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'api.log')
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.writeFileSync(file, '')
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* logging must never break requests */
  }
}

function errorText(status: number): string {
  if (status === 401) return 'Сессия истекла, войдите заново'
  if (status === 403) return 'Недоступно'
  if (status === 404) return 'Не найдено'
  if (status === 429) return 'Слишком много запросов, подождите немного'
  if (status >= 500) return 'SoundCloud временно недоступен'
  return `Ошибка ${status}`
}

const UNPLAYABLE = Number.NEGATIVE_INFINITY

/** Higher is better. Previews (snipped) rank below every full stream. */
function scoreTranscoding(t: Transcoding): number {
  const protocol = t.format?.protocol ?? ''
  const mime = t.format?.mime_type ?? ''
  if (protocol.includes('encrypted')) return UNPLAYABLE

  let score: number
  if (protocol === 'progressive') score = 3.5
  else if (protocol === 'hls' && mime.includes('mp4')) score = 3
  else if (protocol === 'hls' && mime.includes('mpeg')) score = 2
  // Ogg/Opus HLS: hls.js can't play it, the renderer downloads and joins the segments
  else if (protocol === 'hls' && (mime.includes('ogg') || mime.includes('opus'))) score = 1
  else return UNPLAYABLE

  if (t.quality === 'hq') score += 2
  if (t.snipped) score -= 10
  return score
}

interface FullTrack extends StreamRequest {
  policy?: string
}

export async function resolveStream(req: StreamRequest): Promise<ApiResult<StreamInfo>> {
  // Track objects from lists carry a track_authorization that expires; try it first,
  // then fall back to a freshly fetched track.
  if (req.media?.transcodings?.length && req.track_authorization) {
    const r = await resolveFrom(req as FullTrack)
    if (r.ok || (req as FullTrack).policy === 'BLOCK') return r
  }

  const full = await apiRequest<FullTrack>('GET', `/tracks/${req.id}`)
  if (!full.ok) return full
  const r = await resolveFrom(full.data)
  if (!r.ok) {
    const formats = (full.data.media?.transcodings ?? [])
      .map((t) => `${t.format?.protocol}|${t.format?.mime_type}|${t.quality ?? ''}${t.snipped ? '|snip' : ''}`)
      .join(', ')
    log(`stream ${req.id} policy=${full.data.policy ?? '?'} formats=[${formats || 'none'}] -> ${r.error}`)
  }
  return r
}

async function resolveFrom(track: FullTrack): Promise<ApiResult<StreamInfo>> {
  if (track.policy === 'BLOCK') {
    return { ok: false, status: 403, error: 'Трек недоступен в вашем регионе' }
  }

  const all = track.media?.transcodings ?? []
  const candidates = all
    .map((t) => ({ t, score: scoreTranscoding(t) }))
    .filter((c) => c.score !== UNPLAYABLE)
    .sort((a, b) => b.score - a.score)

  const drm = all.some((t) => t.format?.protocol?.includes('encrypted'))
  const drmError = 'SoundCloud отдаёт этот трек только в зашифрованном виде (DRM) для своего плеера'
  if (!candidates.length) {
    return { ok: false, status: 415, error: drm ? drmError : 'нет поддерживаемого формата' }
  }

  for (const { t } of candidates) {
    // retried=true: a 401 here means an expired track_authorization, not a stale client id
    const res = await apiRequest<{ url?: string }>('GET', t.url, { track_authorization: track.track_authorization }, undefined, true)
    if (res.ok && res.data?.url) {
      return {
        ok: true,
        status: 200,
        data: {
          url: res.data.url,
          protocol: t.format.protocol === 'progressive' ? 'progressive' : 'hls',
          mime: t.format.mime_type,
          snipped: t.snipped
        }
      }
    }
  }

  // Monetised tracks often still list MP3 formats that just 404: only the DRM copies exist.
  return { ok: false, status: drm ? 415 : 404, error: drm ? drmError : 'Нет доступного аудиопотока' }
}

export async function clearWebSession(): Promise<void> {
  await scSession().clearStorageData()
}
