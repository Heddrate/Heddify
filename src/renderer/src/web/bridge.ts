/**
 * The website (heddrate.com): the app's interface in a plain browser. This stands in for the
 * Electron bridge (preload/index.ts) with what a browser can do on its own:
 *
 *   - no SoundCloud, Yandex Music or VK: they need the desktop app (their own pages and session),
 *     so the site always runs as a guest — Audius, radio, lyrics and the visitor's own files;
 *   - Audius streams come straight from an Audius API node;
 *   - settings live in the browser (localStorage);
 *   - files are read from a folder the visitor picks, for as long as the tab is open (web/files.ts);
 *   - an open tab notices a new version of the site (version.json) and offers to reload.
 */
import type { ApiResult, ScBridge, StreamInfo, UpdateState } from '../../../shared/ipc'
import { tx } from '@/lib/i18n'
import { webFiles } from './files'

const PREFS_KEY = 'heddify-web-prefs'
/** A visitor is a guest from the first moment: no sign-in screen, no welcome dialog. */
const DEFAULT_PREFS = { guest: true, onboarded: true }

function readPrefs(): Record<string, unknown> {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

const onlyInApp = (): string => tx('Это работает в приложении Heddify для Windows')

/* ---------- Audius: a recommended API node, as main/audius.ts does in the app ---------- */

const AUDIUS = 'https://api.audius.co'
const AUDIUS_APP = 'SCPlayer'
let audiusNode: string | null = null
let audiusAt = 0

async function audiusHost(reroll: boolean): Promise<string> {
  if (audiusNode && !reroll && Date.now() - audiusAt < 3600_000) return audiusNode
  try {
    const j = (await (await fetch(AUDIUS)).json()) as { data?: string[] }
    const list = (j.data ?? []).filter((h) => /^https:\/\//.test(h))
    audiusNode = list[Math.floor(Math.random() * list.length)] ?? AUDIUS
  } catch {
    audiusNode = AUDIUS
  }
  audiusAt = Date.now()
  return audiusNode
}

async function resolveAudius(id: string, retry: boolean): Promise<ApiResult<StreamInfo>> {
  if (!/^[A-Za-z0-9]+$/.test(id)) return { ok: false, status: 400, error: 'bad id' }
  const base = await audiusHost(retry)
  return { ok: true, status: 200, data: { url: `${base}/v1/tracks/${id}/stream?app_name=${AUDIUS_APP}`, protocol: 'progressive', mime: 'audio/mpeg', snipped: false } }
}

/* ---------- a new version of the site: an open tab offers to reload ---------- */

let update: UpdateState = { status: 'latest', version: __APP_VERSION__ }
const updateListeners = new Set<(s: UpdateState) => void>()

async function checkVersion(): Promise<void> {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' })
    const { version } = (await r.json()) as { version?: string }
    const next: UpdateState = version && version !== __APP_VERSION__ ? { status: 'ready', version } : { status: 'latest', version: __APP_VERSION__ }
    if (next.status === update.status && next.version === update.version) return
    update = next
    for (const cb of updateListeners) cb(update)
  } catch {
    /* offline or the site is being updated right now: next time */
  }
}

export function installWebBridge(): void {
  let prefs = readPrefs()

  const bridge: ScBridge = {
    platform: 'web',
    auth: {
      status: async () => ({ loggedIn: false }),
      login: async () => ({ ok: false, error: onlyInApp() }),
      cancelLogin: async () => undefined,
      setToken: async () => ({ ok: false, error: onlyInApp() }),
      logout: async () => undefined
    },
    api: async () => ({ ok: false, status: 0, error: onlyInApp() }),
    resolveStream: async (req) => (req.audius ? resolveAudius(String(req.audius), req.fresh === true) : { ok: false, status: 0, error: onlyInApp() }),
    prefs: {
      get: async () => prefs,
      set: async (patch) => {
        prefs = { ...prefs, ...patch }
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
        } catch {
          /* private mode or full storage: kept for this visit */
        }
      }
    },
    openExternal: async (url) => void window.open(url, '_blank', 'noopener'),
    copyText: async (text) => navigator.clipboard?.writeText(text),
    openLogs: async () => undefined,
    win: { control: () => undefined, isMaximized: async () => false, onMaximized: () => () => undefined },
    cache: {
      stats: async () => ({ bytes: 0, count: 0, pinnedBytes: 0, pinnedCount: 0, limitMb: 0, enabled: false }),
      clear: async () => undefined,
      list: async () => [],
      download: async () => undefined,
      unpin: async () => undefined,
      onProgress: () => () => undefined
    },
    // the browser's own bar takes the page's colour where it can (mobile browsers)
    setWindowTheme: ({ bg }) => document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg),
    setFullScreen: (on) => {
      if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined)
      else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    },
    yandex: { headers: async () => ({}), onHeaders: () => () => undefined, login: async () => false, logout: async () => undefined },
    vk: { login: async () => false, logout: async () => undefined },
    playerState: () => undefined,
    onPlayerCommand: () => () => undefined,
    local: webFiles,
    update: {
      state: async () => update,
      check: checkVersion,
      install: async () => location.reload(),
      onState: (cb) => {
        updateListeners.add(cb)
        return () => updateListeners.delete(cb)
      }
    },
    discord: { update: () => undefined, status: async () => 'off', onStatus: () => () => undefined }
  }
  window.sc = bridge

  // an open tab checks for a new version now and then, and when the visitor comes back to it
  setInterval(() => void checkVersion(), 10 * 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkVersion()
  })
}
