/**
 * Yandex Music, two-in-one with SoundCloud.
 *
 * No private API and no keys: search results come from the public search page's HTML,
 * and Yandex tracks are played by the official music.yandex.ru player running in the
 * embedded tab (signed in with the user's own Yandex account). This module drives that
 * page — start a track, pause, seek, next — and mirrors its state into our player, so a
 * queue can mix SoundCloud and Yandex tracks freely.
 */
import { create } from 'zustand'
import type { PlaySource, Track } from './types'
import { useApp } from '@/store/app'
import { externalEvents, player, registerExternal, usePlayer, type ExternalDriver, mediaCommand } from '@/store/player'
import { tx } from '@/lib/i18n'
// circular with yandexApi (which uses this page), fine: only read at call time
import { useYa } from './yandexApi'

export const YA_HOME = 'https://music.yandex.ru/'
const YA = 'https://music.yandex.ru'

/** The bits of Electron's <webview> element we use. */
export interface WebviewEl extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>
  loadURL(url: string): Promise<void>
  goBack(): void
  goForward(): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
}

/* ---------- the embedded page ---------- */

let view: WebviewEl | null = null
let markReady: (() => void) | null = null
let ready = new Promise<void>((r) => (markReady = r))

/** YandexHost calls this once its webview has loaded a page. */
/** Level last set by our volume slider (0..1, already curved), re-applied to the page. */
let pageVolume = 1

export function attachView(el: WebviewEl): void {
  view = el
  markReady?.()
  void el.executeJavaScript(MEDIA_BRIDGE).catch(() => undefined)
  // a reloaded page starts at full volume
  void el.executeJavaScript(`window.__scVolume && window.__scVolume(${pageVolume})`).catch(() => undefined)
}

/**
 * Media keys and the Windows media overlay talk to whichever page plays audio — for
 * Yandex tracks that is the hidden Yandex page. Re-route its media-session actions to
 * our player (via console messages picked up by YandexHost), so next / previous follow
 * our queue just like for SoundCloud.
 */
const MEDIA_BRIDGE = `(() => {
  if (window.__scMedia) return
  window.__scMedia = true
  const send = (a) => console.log('__sc_media:' + a)
  const ours = { play: () => send('play'), pause: () => send('pause'), stop: () => send('pause'),
    nexttrack: () => send('next'), previoustrack: () => send('prev') }
  const orig = MediaSession.prototype.setActionHandler
  MediaSession.prototype.setActionHandler = function (action, handler) {
    return orig.call(this, action, ours[action] || handler)
  }
  for (const a of Object.keys(ours)) { try { orig.call(navigator.mediaSession, a, ours[a]) } catch (e) {} }
})()`

/** A media key pressed while the Yandex page owned the media session. */
export function onPageMediaKey(action: string): void {
  if (action === 'next' || action === 'prev' || action === 'play' || action === 'pause') mediaCommand(action)
}

export function detachView(): void {
  view = null
  ready = new Promise<void>((r) => (markReady = r))
}

async function page(): Promise<WebviewEl> {
  if (!useApp.getState().yandexMounted) useApp.setState({ yandexMounted: true })
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(tx("Яндекс Музыка не загрузилась"))), 20_000)
  )
  await Promise.race([ready, timeout])
  if (!view) throw new Error(tx("Яндекс Музыка не загрузилась"))
  return view
}

/** Runs a script inside the Yandex page (mounting it first if needed). */
export async function runInPage<T>(code: string): Promise<T> {
  const wv = await page()
  return (await wv.executeJavaScript(code)) as T
}

const run = <T,>(code: string): Promise<T | null> =>
  view ? (view.executeJavaScript(code) as Promise<T>).catch(() => null) : Promise.resolve(null)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Diagnostics into logs/api.log (main records renderer console errors). */
const trace = (msg: string): void => console.error(`yandex: ${msg}`)

/**
 * Goes to a page of the Yandex app with the app's own client-side router (no reload,
 * ~0.4 s). Only if that's unavailable does it load the URL — without waiting for "load
 * finished", which Yandex's app may never report; the play-button polling waits instead.
 */
async function navigateTo(wv: WebviewEl, url: string): Promise<void> {
  if (wv.getURL() === url) return
  const u = new URL(url)
  const routed = await run<boolean>(`(() => {
    const r = window.next && window.next.router
    if (!r || typeof r.push !== 'function') return false
    r.push(${JSON.stringify(u.pathname + u.search)})
    return true
  })()`)
  if (routed) return
  await Promise.race([wv.loadURL(url).catch(() => undefined), sleep(4000)])
}

/** Reloads the hidden page (e.g. after signing in, so it picks up the session). */
export async function reloadView(): Promise<void> {
  const wv = await page()
  await Promise.race([wv.loadURL(YA_HOME).catch(() => undefined), sleep(4000)])
}

/* ---------- page scripts ---------- */

const PLAY_LABELS = ['Воспроизведение', 'Play', 'Слушать']
const NEXT_LABELS = ['Следующая песня', 'Next song', 'Следующий трек']
const PREV_LABELS = ['Предыдущая песня', 'Previous song', 'Предыдущий трек']

const selector = (labels: string[]): string => labels.map((l) => `button[aria-label="${l}"]`).join(', ')

/**
 * Starts this track: a track URL opens Yandex's track card (TrackModal) with its own
 * play button; album-style pages have a row per track instead. Never clicks a random
 * play button — that would start something else.
 */
const clickPlay = (trackId: number, title = ''): string => `(() => {
  const sel = ${JSON.stringify(selector(PLAY_LABELS))}
  const want = ${JSON.stringify(norm(title).slice(0, 14))}
  const modal = document.querySelector('[class*="TrackModal_root"]')
  const fresh = modal && (!want || modal.textContent.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, '').includes(want))
  let btn = fresh ? modal.querySelector(sel) : null
  if (!btn) {
    const link = document.querySelector('a[href$="/track/${trackId}"]')
    let row = link
    while (row && !(row.querySelector && row.querySelector(sel))) row = row.parentElement
    btn = row ? row.querySelector(sel) : null
  }
  if (!btn) return false
  btn.click()
  return true
})()`

const clickButton = (labels: string[]): string =>
  `(() => { const b = document.querySelector(${JSON.stringify(selector(labels))}); if (b) b.click(); return !!b })()`

/**
 * Yandex plays through Web Audio, not a page <audio>: the position lives in the
 * player bar's timecode slider (value / max in seconds), play state in the media session.
 */
const BAR = `(() => {
  const r = document.querySelector('input[aria-label="Управление таймкодом"], input[aria-label="Timecode control"]')
  let b = r
  while (b && !(b.querySelector && b.querySelector(${JSON.stringify(selector(NEXT_LABELS))}))) b = b.parentElement
  return { range: r, bar: b }
})()`

/** Presses the bar's play/pause button only if the state differs. */
const setPlaying = (play: boolean): string => `(() => {
  const playing = navigator.mediaSession && navigator.mediaSession.playbackState === 'playing'
  if (playing === ${play}) return true
  const { bar } = ${BAR}
  const scope = bar || document
  const b = scope.querySelector(${JSON.stringify(selector(play ? PLAY_LABELS : ['Пауза', 'Pause']))})
  if (b) b.click()
  return !!b
})()`

const seekTo = (t: number): string => `(() => {
  const { range } = ${BAR}
  if (!range) return false
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(range, String(${Math.max(0, Math.floor(t))}))
  range.dispatchEvent(new Event('input', { bubbles: true }))
  range.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`

interface PageState {
  title: string
  artist: string
  artwork: string | null
  position: number
  duration: number
  paused: boolean
  href: string
}

const READ_STATE = `(() => {
  const m = navigator.mediaSession && navigator.mediaSession.metadata
  if (!m || !m.title) return null
  const { range } = ${BAR}
  const art = m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : null
  return { title: m.title, artist: m.artist || '', artwork: art,
    position: range ? Number(range.value) || 0 : 0, duration: range ? Number(range.max) || 0 : 0,
    paused: navigator.mediaSession.playbackState !== 'playing', href: location.href }
})()`
/* ---------- mapping to our track model ---------- */

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

/** Yandex ids are stored negative so they never collide with SoundCloud ids. */
export function yandexTrack(t: {
  trackId: number
  albumId?: number
  title: string
  artists: { id?: number; name: string }[]
  cover?: string | null
  durationSec?: number
}): Track {
  const artist = t.artists.map((a) => a.name).join(', ')
  return {
    id: -t.trackId,
    kind: 'track',
    origin: 'yandex',
    ya: { trackId: t.trackId, albumId: t.albumId, artistId: t.artists[0]?.id },
    title: t.title,
    user: { id: 0, kind: 'user', username: artist || tx("Яндекс Музыка") },
    artwork_url: t.cover ?? null,
    duration: (t.durationSec ?? 0) * 1000,
    full_duration: (t.durationSec ?? 0) * 1000,
    permalink_url: t.albumId ? `${YA}/album/${t.albumId}/track/${t.trackId}` : `${YA}/track/${t.trackId}`,
    policy: 'ALLOW'
  }
}

function trackFromPage(st: PageState): Track {
  const m = st.href.match(/\/album\/(\d+)\/track\/(\d+)/)
  const trackId = m ? Number(m[2]) : hash(st.title + '|' + st.artist)
  return yandexTrack({
    trackId,
    albumId: m ? Number(m[1]) : undefined,
    title: st.title,
    artists: [{ name: st.artist }],
    cover: st.artwork,
    durationSec: st.duration
  })
}

const norm = (s?: string): string => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const sameTitle = (a?: string, b?: string): boolean => {
  const x = norm(a)
  const y = norm(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

/* ---------- search (public page HTML, no API) ---------- */

const durationOf = (text: string): number => {
  const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return 0
  return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

export async function searchYandex(q: string): Promise<Track[]> {
  const res = await fetch(`${YA}/search?text=${encodeURIComponent(q)}`, { credentials: 'omit' })
  if (!res.ok) throw new Error(tx("Яндекс Музыка: {0}", res.status))
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  const seen = new Set<number>()
  const out: Track[] = []
  for (const link of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/track/"]'))) {
    const m = link.getAttribute('href')?.match(/\/album\/(\d+)\/track\/(\d+)/)
    if (!m || seen.has(Number(m[2]))) continue
    // the card: the widest ancestor that still holds only this one track
    let row: Element = link
    while (row.parentElement && row.parentElement.querySelectorAll('a[href*="/track/"]').length === 1) row = row.parentElement
    const title = link.textContent?.trim()
    if (!title) continue
    seen.add(Number(m[2]))
    const artists = Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href^="/artist/"]')).map((a) => ({
      id: Number(a.getAttribute('href')!.match(/\/artist\/(\d+)/)?.[1]) || undefined,
      name: a.textContent?.trim() ?? ''
    }))
    const img = row.querySelector('img')?.getAttribute('src') ?? null
    out.push(
      yandexTrack({
        trackId: Number(m[2]),
        albumId: Number(m[1]),
        title,
        artists: artists.length ? artists : [{ name: '' }],
        cover: img ? img.replace(/\/\d+x\d+$/, '/400x400') : null,
        durationSec: durationOf(row.textContent ?? '')
      })
    )
  }
  return out
}

/* ---------- driver: playback through the page, mirrored into our player ---------- */

let mirror: ReturnType<typeof setInterval> | null = null
let expected: Track | null = null
let matched = false
let startedAt = 0
let endSignalled = false
/** Bumped on every play request; an older request stops as soon as it notices. */
let playToken = 0

function stopMirror(): void {
  if (mirror) clearInterval(mirror)
  mirror = null
}

function startMirror(): void {
  stopMirror()
  mirror = setInterval(() => void tick(), 1000)
}

async function tick(): Promise<void> {
  if (!externalEvents.active()) return stopMirror()
  const st = await run<PageState>(READ_STATE)
  if (!st || !expected) return

  if (!matched) {
    if (sameTitle(st.title, expected.title)) {
      trace(`now playing: ${st.title}`)
      matched = true
      externalEvents.started(expected)
    } else {
      if (Date.now() - startedAt > 20_000) trace(`no match: page plays "${st.title}", expected "${expected.title}", paused=${st.paused}`)
      if (Date.now() - startedAt > 20_000) externalEvents.error(tx("трек не запустился в Яндекс Музыке"))
      return
    }
  } else if (!sameTitle(st.title, expected.title)) {
    // The page moved on by itself. If our queue has more, it decides what's next;
    // otherwise follow Yandex's own queue.
    const s = usePlayer.getState()
    if (s.manual.length || s.index + 1 < s.context.length) {
      if (!endSignalled) {
        endSignalled = true
        externalEvents.ended()
      }
      return
    }
    if (expected) pushHistory(expected)
    expected = trackFromPage(st)
    externalEvents.replaceCurrent(expected)
  }

  externalEvents.state({ playing: !st.paused, loading: false })
  if (st.duration > 0) externalEvents.time(st.position, st.duration)
  // the page stopped at the very end (its own queue is over)
  if (st.paused && st.duration > 0 && st.position >= st.duration - 1 && !endSignalled) {
    endSignalled = true
    externalEvents.ended()
  }
}

const driver: ExternalDriver = {
  async play(track, startAt) {
    const token = ++playToken
    const wv = await page()
    const id = track.ya?.trackId
    if (!id) throw new Error(tx('у трека нет ссылки на Яндекс Музыку'))
    expected = track
    matched = false
    endSignalled = false
    startedAt = Date.now()
    stopMirror()
    const url = track.permalink_url ?? `${YA}/track/${id}`
    trace(`play ${id}: open ${url}`)
    await navigateTo(wv, url)
    if (token !== playToken) return // another track was requested meanwhile

    // Press play, then make sure it is really this track that plays; the page may
    // still be hydrating and swallow the first click.
    for (let attempt = 1; attempt <= 4; attempt++) {
      let clicked = false
      for (let i = 0; i < 30 && !clicked; i++) {
        clicked = (await run<boolean>(clickPlay(id, track.title?.replace(/\s*\(.*\)$/, '')))) === true
        if (token !== playToken) return
        if (!clicked) await sleep(500)
      }
      if (!clicked) break
      for (let i = 0; i < 10; i++) {
        await sleep(500)
        if (token !== playToken) return
        const st = await run<PageState>(READ_STATE)
        if (st && !st.paused && sameTitle(st.title, track.title)) {
          trace(`play ${id}: playing after ${attempt} click(s)`)
          matched = true
          externalEvents.started(track)
          void run(`window.__scVolume && window.__scVolume(${pageVolume})`)
          externalEvents.state({ playing: true, loading: false })
          if (startAt > 0) setTimeout(() => void run(seekTo(startAt)), 1500)
          startMirror()
          return
        }
      }
      trace(`play ${id}: click ${attempt} did not start it, retrying`)
    }
    if (token !== playToken) return
    throw new Error(tx('Яндекс Музыка не дала запустить трек'))
  },  pause() {
    void run(setPlaying(false))
    externalEvents.state({ playing: false })
  },
  resume() {
    void run(setPlaying(true))
    externalEvents.state({ playing: true })
  },
  seek(t) {
    void run(seekTo(Number(t) || 0))
  },
  setVolume(volume, muted) {
    // same curve as our own engine; the page's audio goes through the hook in preload/yandex.ts
    pageVolume = muted ? 0 : volume * volume
    void run(`window.__scVolume && window.__scVolume(${pageVolume})`)
  },
  release() {
    playToken++
    stopMirror()
    expected = null
    void run(setPlaying(false))
  },
  next() {
    endSignalled = false
    void run(clickButton(NEXT_LABELS))
  },
  prev() {
    endSignalled = false
    void run(clickButton(PREV_LABELS))
  }
}

registerExternal(driver)

/* ---------- Yandex's own "Моя волна" ---------- */

export const yaWaveSource = (): PlaySource => ({ label: tx('Моя волна · Яндекс'), route: { name: 'ya-wave' } })

/** Tracks the Yandex wave has played in this session, newest first. */
export const useYaWave = create<{ history: Track[]; starting: boolean }>(() => ({ history: [], starting: false }))

function pushHistory(t: Track): void {
  if (usePlayer.getState().source?.route?.name !== 'ya-wave') return
  const prev = useYaWave.getState().history.filter((x) => x.id !== t.id)
  useYaWave.setState({ history: [t, ...prev].slice(0, 50) })
}

const VIBE_PLAY = `(() => {
  const sel = ${JSON.stringify(selector(PLAY_LABELS))}
  const root = document.querySelector('[class*="VibePage_root"], [class*="vibeWidget"], [class*="VibeWidget"]')
  const b = root && root.querySelector(sel)
  if (!b) return false
  b.click()
  return true
})()`

/**
 * Starts Yandex's own wave in the page (so likes, skips and "не нравится" teach
 * Yandex as usual) and mirrors it into our player.
 */
/** Is the page already on Yandex's home with the wave player rendered? */
const VIBE_READY = `(() => !!document.querySelector('[class*="VibePage_root"], [class*="vibeWidget"], [class*="VibeWidget"]'))()`

let warming: Promise<void> | null = null

/**
 * Gets the hidden page onto Yandex's home (where the wave player lives) ahead of time,
 * so pressing play only has to click. Harmless while a Yandex track plays: the site keeps
 * playing across its own page changes.
 */
export function warmYandexWave(): Promise<void> {
  if (useYa.getState().status !== 'in') return Promise.resolve()
  warming ??= (async () => {
    try {
      const wv = await page()
      if ((await run<boolean>(VIBE_READY)) !== true) await navigateTo(wv, YA_HOME)
    } catch {
      /* the real start will report it */
    } finally {
      warming = null
    }
  })()
  return warming
}

/**
 * Starts Yandex's own wave in the page (so likes, skips and "не нравится" teach
 * Yandex as usual) and mirrors it into our player.
 */
export async function startYandexWave(): Promise<void> {
  if (useYaWave.getState().starting) return
  useYaWave.setState({ starting: true })
  const t0 = Date.now()
  const at = (): string => `+${Date.now() - t0} ms`
  try {
    const wv = await page()
    stopMirror()
    await warming
    if ((await run<boolean>(VIBE_READY)) !== true) await navigateTo(wv, YA_HOME)
    trace(`wave: page ready ${at()}`)

    // the wave may already be playing in the page (e.g. paused from the Yandex side)
    let st = await run<PageState>(READ_STATE)
    const onVibe = (await run<boolean>(VIBE_READY)) === true
    if (!(st && !st.paused && onVibe)) {
      st = null
      // click; if the site swallowed it (still hydrating) click again, up to 4 times
      for (let attempt = 0; attempt < 4 && !st; attempt++) {
        let clicked = false
        for (let i = 0; i < 40 && !clicked; i++) {
          clicked = (await run<boolean>(VIBE_PLAY)) === true
          if (!clicked) await sleep(150)
        }
        if (!clicked) break
        trace(`wave: click ${attempt + 1} ${at()}`)
        for (let i = 0; i < 20; i++) {
          await sleep(150)
          const now = await run<PageState>(READ_STATE)
          if (now && !now.paused) {
            st = now
            break
          }
        }
      }
    }
    if (!st) throw new Error(tx('Яндекс Музыка не дала запустить волну'))
    trace(`wave: playing ${at()}`)
    expected = trackFromPage(st)
    matched = true
    endSignalled = false
    useYaWave.setState({ history: [] })
    externalEvents.adopt(expected, yaWaveSource())
    externalEvents.state({ playing: true, loading: false })
    startMirror()
  } finally {
    useYaWave.setState({ starting: false })
  }
}
/** "Не нравится" in the Yandex player: it skips and learns from it. */
export function dislikeYandex(): void {
  endSignalled = false
  void run(clickButton(['Не нравится', 'Dislike']))
}

/**
 * The page started playing because the user pressed play inside the Yandex tab:
 * adopt it as the current track so our player bar mirrors and controls it.
 */
export async function onPageStartedPlaying(): Promise<void> {
  if (externalEvents.active()) return
  const st = await run<PageState>(READ_STATE)
  if (!st) return
  expected = trackFromPage(st)
  matched = true
  endSignalled = false
  externalEvents.adopt(expected)
  externalEvents.state({ playing: true, loading: false })
  startMirror()
}
