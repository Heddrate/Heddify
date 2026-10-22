/**
 * VK Music (ВКонтакте), the way Yandex Music works here: the official vk.com page runs hidden
 * in the app, signed in with the user's own VK account, and plays the tracks itself.
 *
 * This module drives that page through VK's own player (`getAudioPlayer()`): it opens a
 * track's page and presses its play button, pauses, seeks, and mirrors what plays into our
 * player. Lists (search, the user's tracks) are read from the track rows the page draws.
 * No stream links and no keys: the sound never leaves VK's page.
 */
import { tx } from './i18n'
import type { Track } from './types'
import { useApp } from '@/store/app'
import { toast } from '@/store/ui'
import { externalEvents, registerExternal, upcomingPositions, usePlayer, type ExternalDriver } from '@/store/player'
import { engine } from '@/player/engine'
import { fadeGain } from '@/player/audioMath'
import { initialBass, stepBass, type BassState } from './bass'
import { pickTwin, twinQuery } from './twin'
import { VK, vkPlays, vkTrack, vkTrackFromState, type VkPageState, type VkRow } from './vkModel'
import { MEDIA_BRIDGE, type WebviewEl } from './yandex'
// circular with vkLibrary (which uses this page), fine: only read at call time
import { useVk } from './vkLibrary'

export const VK_HOME = `${VK}/audio`

/* ---------- the embedded page ---------- */

let view: WebviewEl | null = null
let markReady: (() => void) | null = null
let ready = new Promise<void>((r) => (markReady = r))

/** Level for the page (0..1, already curved): the player's volume, silent until it is known. */
let pageVolume = 0
/** The level the page's volume was last set to (its volume times the fade); -1 = unknown. */
let pageLevel = -1

/** VkHost calls this once its webview has loaded a page. */
export function attachView(el: WebviewEl): void {
  view = el
  markReady?.()
  // the level the user chose: a reloaded page must not play at the old or a full level
  const s = usePlayer.getState()
  pageVolume = s.muted ? 0 : s.volume * s.volume
  pageLevel = -1
  void el.executeJavaScript(MEDIA_BRIDGE).catch(() => undefined)
  void el.executeJavaScript(`window.__scVolume && window.__scVolume(${pageVolume})`).catch(() => undefined)
}

export function detachView(): void {
  view = null
  ready = new Promise<void>((r) => (markReady = r))
}

/** Last time anything needed the VK page; it is unloaded after a while without use. */
let lastUse = Date.now()
const IDLE_UNLOAD_MS = 15 * 60_000

setInterval(() => {
  // a SoundCloud DRM track may be playing from this page too (store/player.ts)
  const vkNow = usePlayer.getState().current?.origin === 'vk' || externalEvents.active(driver)
  if (vkNow) lastUse = Date.now()
  if (!useApp.getState().vkMounted || vkNow) return
  if (Date.now() - lastUse < IDLE_UNLOAD_MS) return
  // the user's tracks are remembered (localStorage); the page comes back on the next VK action
  trace('page unloaded after idle')
  useApp.setState({ vkMounted: false })
}, 60_000)

async function page(): Promise<WebviewEl> {
  lastUse = Date.now()
  if (!useApp.getState().vkMounted) useApp.setState({ vkMounted: true })
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(tx('ВКонтакте не загрузился'))), 20_000))
  await Promise.race([ready, timeout])
  if (!view) throw new Error(tx('ВКонтакте не загрузился'))
  return view
}

/** Runs a script inside the VK page (mounting it first if needed). */
export async function runInPage<T>(code: string): Promise<T> {
  const wv = await page()
  return (await wv.executeJavaScript(code)) as T
}

const run = <T,>(code: string): Promise<T | null> =>
  view ? (view.executeJavaScript(code) as Promise<T>).catch(() => null) : Promise.resolve(null)

/** A press on the page as the user's own click (lets its audio start). */
const press = <T,>(code: string): Promise<T | null> =>
  view ? (view.executeJavaScript(code, true) as Promise<T>).catch(() => null) : Promise.resolve(null)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Diagnostics into logs/api.log (main records renderer console errors). */
const trace = (msg: string): void => console.error(`vk: ${msg}`)

/** The page may start audio only for a moment after we ask for it (preload/yandex.ts). */
function allowPlay(ms: number): void {
  if (view) void view.executeJavaScript(`window.__scAllowPlay && window.__scAllowPlay(${ms})`, true).catch(() => undefined)
}

/**
 * One thing at a time moves the page around: a track start, a search, a read of the user's
 * tracks. Otherwise a search could take the page away from the track it is about to start.
 */
let busy: Promise<unknown> = Promise.resolve()
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = busy.then(job, job)
  busy = next.catch(() => undefined)
  return next
}

/**
 * Goes to a page of vk.com with VK's own router (no reload, the music keeps playing) and
 * waits until it is there. Only without the router does it load the address.
 */
async function goTo(wv: WebviewEl, path: string): Promise<boolean> {
  const target = path.split('?')[0]
  const routed = await run<boolean>(`(() => {
    if (location.pathname + location.search === ${JSON.stringify(path)}) return true
    if (!window.nav || typeof window.nav.go !== 'function') return false
    window.nav.go(${JSON.stringify(path)})
    return true
  })()`)
  if (!routed) await Promise.race([wv.loadURL(VK + path).catch(() => undefined), sleep(4000)])
  for (let i = 0; i < 40; i++) {
    if ((await run<string>('location.pathname')) === target) return true
    await sleep(150)
  }
  return false
}

/** Reloads the hidden page (e.g. after signing in, so it picks up the session). */
export async function reloadVkView(): Promise<void> {
  const wv = await page()
  await Promise.race([wv.loadURL(VK_HOME).catch(() => undefined), sleep(4000)])
}

/* ---------- page scripts ---------- */

const AP = '(window.getAudioPlayer && window.getAudioPlayer())'

/** Calls a method of VK's player; false when there is no player (yet). */
const apCall = (method: 'pause' | 'play' | 'playNext' | 'playPrev'): string =>
  `(() => { const ap = ${AP}; if (!ap || typeof ap.${method} !== 'function') return false; ap.${method}(); return true })()`

/** What VK's player plays: its current track, how far, and whether an ad plays first. */
const READ_STATE = `(() => {
  const ap = ${AP}
  if (!ap || typeof ap.getCurrentAudio !== 'function') return null
  const a = ap.getCurrentAudio()
  if (!Array.isArray(a) || !a[3]) return null
  const m = navigator.mediaSession && navigator.mediaSession.metadata
  const title = String(a[3])
  // the media session has the version too ("Title (Super Slowed)") and the cover
  const own = m && m.title && m.title.toLowerCase().indexOf(title.toLowerCase().slice(0, 12)) === 0
  const art = own && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : null
  let ad = 0
  try { ad = Number(ap.adsGetCurrentProgress()) || 0 } catch (e) {}
  const duration = Number(a[5]) || Number(ap.getCurrentDuration()) || 0
  return {
    key: a[1] + '_' + a[0],
    title: own ? m.title : title,
    artist: (own && m.artist) || String(a[4] || ''),
    artwork: art,
    duration,
    position: (Number(ap.getCurrentProgress()) || 0) * duration,
    playing: !!ap.isPlaying(),
    ad: ad > 0 && ad < 1
  }
})()`

/** The big play button of this track's own page (only once the page shows that track). */
const clickPlay = (key: string): string => `(() => {
  if (location.pathname !== ${JSON.stringify('/audio' + key)}) return false
  const b = document.querySelector('button[data-testid="MusicAudio_TogglePlaying"]')
  if (!b) return false
  b.click()
  return true
})()`

/** VK's own seek by a share of the track (its seek-by-seconds is broken on the site). */
const seekTo = (t: number): string => `(() => {
  const ap = ${AP}
  const a = ap && ap.getCurrentAudio()
  const d = (a && Number(a[5])) || (ap && Number(ap.getCurrentDuration())) || 0
  if (!ap || !(d > 0)) return false
  ap.seek(Math.max(0, Math.min(0.999, ${Math.max(0, Number(t) || 0)} / d)))
  return true
})()`

/**
 * The track rows of one block of the page: the rows after the block's header (`from`, a
 * data-testid) up to the next block. Each row carries its track's own data, as VK draws it.
 */
const readRows = (from: string): string => `(() => {
  const heads = [...document.querySelectorAll('[data-testid^="AudioCatalog_BlockHeader"]')]
  const start = heads.find((h) => h.getAttribute('data-testid') === ${JSON.stringify(from)})
  if (!start) return null
  const end = heads.find((h) => start.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)
  const out = []
  const seen = new Set()
  for (const row of document.querySelectorAll('[data-testid="MusicTrackRow"]')) {
    if (!(start.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
    if (end && !(row.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
    const fk = Object.keys(row).find((k) => k.startsWith('__reactFiber'))
    let f = fk ? row[fk] : null
    for (let i = 0; f && i < 40 && !(f.memoizedProps && f.memoizedProps.track); i++) f = f.return
    const t = f && f.memoizedProps && f.memoizedProps.track
    const e = t && t.entity
    if (!e || typeof t.pageHref !== 'string' || seen.has(t.pageHref)) continue
    seen.add(t.pageHref)
    const sizes = e.cover && e.cover.sizes ? Object.values(e.cover.sizes) : []
    const cover = sizes.find((s) => s && s.width >= 500) || sizes[sizes.length - 1]
    const names = (list) => (Array.isArray(list) ? list.map((a) => a && a.name).filter(Boolean) : [])
    out.push({
      href: t.pageHref,
      title: String(e.title || ''),
      subtitle: String(e.subtitle || ''),
      artists: names(e.authors && e.authors.main).concat(names(e.authors && e.authors.feat)),
      raw: String((e.authors && e.authors.raw) || ''),
      duration: Number(e.duration) || 0,
      cover: (cover && cover.src) || null,
      blocked: !!e.isBlocked
    })
  }
  return out
})()`

const toTracks = (rows: VkRow[] | null): Track[] => (rows ?? []).map(vkTrack).filter((t): t is Track => !!t)

/* ---------- lists ---------- */

/** The page's own idea of who is signed in: VK's user id, 0 when nobody is. */
export const SIGNED_IN = '(() => { try { return (window.vk && Number(window.vk.id)) || 0 } catch (e) { return 0 } })()'

/** Tracks from VK's music search ("Все треки"); empty when not signed in to VK. */
export function searchVk(q: string): Promise<Track[]> {
  const query = q.trim()
  if (!query || useVk.getState().status !== 'in') return Promise.resolve([])
  return exclusive(async () => {
    const wv = await page()
    await goTo(wv, `/audio?q=${encodeURIComponent(query)}`)
    // the results replace what the page showed before: wait until this query's rows stay put
    let last = ''
    for (let i = 0; i < 30; i++) {
      await sleep(250)
      const now = await run<string>(`(() => {
        const input = document.querySelector('input[data-testid="search_audio_input"]')
        if (!input || input.value.trim().toLowerCase() !== ${JSON.stringify(query.toLowerCase())}) return ''
        const head = document.querySelector('[data-testid="AudioCatalog_BlockHeaderAllTracks"]')
        return head ? String(document.querySelectorAll('[data-testid="MusicTrackRow"]').length) : ''
      })()`)
      if (now && now === last) break
      last = now ?? ''
    }
    return toTracks(await run<VkRow[]>(readRows('AudioCatalog_BlockHeaderAllTracks')))
  })
}

/**
 * The user's own tracks ("Моя музыка" → "Треки"), all of them: more rows come in as the page
 * scrolls. null when the page could not be read (the remembered list stays then).
 */
export function readVkMine(uid: number): Promise<Track[] | null> {
  return exclusive(async () => {
    const wv = await page()
    await goTo(wv, `/audios${uid}?section=all`)
    let state: 'tracks' | 'empty' | null = null
    for (let i = 0; i < 50 && !state; i++) {
      await sleep(200)
      state = await run<'tracks' | 'empty' | null>(`(() => {
        if (document.querySelector('[data-testid="AudioCatalog_BlockHeaderTracks"]')) return 'tracks'
        // the music page is there but has no tracks block after a while: nothing saved yet
        return ${i > 30} && document.querySelector('[data-testid="AudioCatalog_Tabs_Tab_all"]') ? 'empty' : null
      })()`)
    }
    if (state !== 'tracks') return state === 'empty' ? [] : null
    // read while scrolling: a long list may keep only the rows in view
    const found = new Map<string, Track>()
    let stable = 0
    for (let round = 0; round < 40 && stable < 3; round++) {
      const before = found.size
      for (const t of toTracks(await run<VkRow[]>(readRows('AudioCatalog_BlockHeaderTracks')))) if (!found.has(t.vk!.key)) found.set(t.vk!.key, t)
      stable = found.size === before ? stable + 1 : 0
      await run('(() => { const s = document.scrollingElement; if (s) s.scrollTop = s.scrollHeight })()')
      await sleep(500)
    }
    return [...found.values()]
  })
}

/**
 * Adds a track to the user's VK music or takes it out, with the button on the track's own
 * page. False when the page wouldn't do it.
 */
export function setVkOwned(track: Track, owned: boolean): Promise<boolean> {
  const key = track.vk?.key
  if (!key) return Promise.resolve(false)
  return exclusive(async () => {
    const wv = await page()
    await goTo(wv, `/audio${key}`)
    for (let i = 0; i < 30; i++) {
      const r = await press<string | null>(`(() => {
        if (location.pathname !== ${JSON.stringify('/audio' + key)}) return null
        const b = document.querySelector('button[data-testid="MusicAudio_ToggleOwning"]')
        if (!b) return null
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase()
        const has = /удал|remove|delete/.test(label)
        if (has === ${owned}) return 'already'
        b.click()
        return 'done'
      })()`)
      if (r === 'done' || r === 'already') return true
      await sleep(300)
    }
    return false
  })
}

/** The VK copy of a SoundCloud track that SoundCloud only gives out as DRM (lib/twin.ts). */
async function findTwin(track: Track): Promise<Track | null> {
  if (useVk.getState().status !== 'in') return null
  const found = await searchVk(twinQuery(track)).catch(() => [] as Track[])
  const twin = pickTwin(track, found)
  trace(`twin for soundcloud ${track.id}: ${twin ? twin.vk?.key : `none of ${found.length}`}`)
  return twin
}

/* ---------- driver: playback through the page, mirrored into our player ---------- */

let mirror: ReturnType<typeof setInterval> | null = null
let expected: Track | null = null
let endSignalled = false
/** Bumped on every play request; an older request stops as soon as it notices. */
let playToken = 0

/** VK may call a track playing while it never loads: where it was, and since when. */
let lastPos = -1
let lastMoveAt = 0
const STUCK_MS = 10_000
/** When the track was asked for, for one line in api.log once it really moves. */
let movedLog: { key: string; at: number } | null = null
let adNoted = false

let bass: BassState = initialBass()
let pollTimer: ReturnType<typeof setInterval> | null = null

/** Reads the page's sound about 20 times a second: the bass for the glow, and the fade of its volume. */
async function pollPage(): Promise<void> {
  if (!view || !externalEvents.active(driver)) return
  const r = await run<{ db: number; pos: number; dur: number }>(`window.__scBass ? window.__scBass() : null`)
  if (!r) return
  bass = stepBass(bass, r.db)
  const level = pageVolume * fadeGain(r.pos, r.dur, engine.fadeOn())
  if (Math.abs(level - pageLevel) > 0.005) {
    pageLevel = level
    void run(`window.__scVolume && window.__scVolume(${level})`)
  }
}

function stopMirror(): void {
  if (mirror) clearInterval(mirror)
  if (pollTimer) clearInterval(pollTimer)
  mirror = null
  pollTimer = null
  bass = initialBass()
  pageLevel = -1
}

function startMirror(): void {
  stopMirror()
  mirror = setInterval(() => void tick(), 1000)
  pollTimer = setInterval(() => void pollPage(), 50)
}

/** Without a subscription VK plays an ad first: said once, the player waits meanwhile. */
function noteAd(): void {
  lastMoveAt = Date.now()
  if (adNoted) return
  adNoted = true
  trace('ad before the track')
  toast(tx('Без подписки ВКонтакте включает рекламу перед треком'), 6000)
}

/** The track stands still although VK calls it playing: it never loaded. */
function watchProgress(st: VkPageState): void {
  if (!st.playing || Math.abs(st.position - lastPos) > 0.2) {
    if (st.playing && lastPos >= 0 && movedLog) {
      trace(`${movedLog.key}: moving after ${Date.now() - movedLog.at} ms`)
      movedLog = null
    }
    lastPos = st.position
    lastMoveAt = Date.now()
    return
  }
  if (Date.now() - lastMoveAt > STUCK_MS && !endSignalled) {
    trace(`${st.key}: stuck at ${st.position.toFixed(1)} s`)
    endSignalled = true
    externalEvents.error(tx('ВКонтакте не дал включить трек'))
  }
}

async function tick(): Promise<void> {
  if (!externalEvents.active(driver)) return stopMirror()
  // while a VK track is the current one, the page may carry on with its own list
  allowPlay(5000)
  const st = await run<VkPageState>(READ_STATE)
  if (!st || !expected) return

  if (!vkPlays(st, expected)) {
    // VK moved on by itself. If our queue has more, it decides what's next; otherwise follow VK.
    const s = usePlayer.getState()
    if (s.manual.length || upcomingPositions(s, 1).length > 0) {
      if (!endSignalled) {
        endSignalled = true
        externalEvents.ended()
      }
      return
    }
    const next = vkTrackFromState(st)
    if (!next) return
    expected = next
    lastPos = -1
    externalEvents.replaceCurrent(next)
  }

  if (st.ad) {
    noteAd()
    externalEvents.state({ playing: st.playing, loading: true })
    return
  }
  externalEvents.state({ playing: st.playing, loading: false })
  if (st.duration > 0) externalEvents.time(st.position, st.duration)
  watchProgress(st)
  // VK stopped at the very end (its own list is over)
  if (!st.playing && st.duration > 0 && st.position >= st.duration - 1 && !endSignalled) {
    endSignalled = true
    externalEvents.ended()
  }
}

/** The page plays `track` now: mirror it from here on. */
function started(track: Track, startAt: number, how: string): void {
  const key = track.vk?.key ?? ''
  trace(`play ${key}: playing after ${how}`)
  lastPos = -1
  lastMoveAt = Date.now()
  movedLog = { key, at: Date.now() }
  externalEvents.started(track)
  void run(`window.__scVolume && window.__scVolume(${pageVolume})`)
  externalEvents.state({ playing: true, loading: false })
  if (startAt > 0) setTimeout(() => void run(seekTo(startAt)), 1500)
  startMirror()
}

const driver: ExternalDriver = {
  async play(track, startAt) {
    const token = ++playToken
    const key = track.vk?.key
    if (!key) throw new Error(tx('у трека нет ссылки на ВКонтакте'))
    expected = track
    endSignalled = false
    stopMirror()
    await exclusive(async () => {
      const wv = await page()
      if (token !== playToken) return
      allowPlay(30_000)
      const plays = (st: VkPageState | null): st is VkPageState => !!st && vkPlays(st, track)

      // the page may hold this very track already (paused, or started a moment ago)
      const now = await run<VkPageState>(READ_STATE)
      if (plays(now) && (now.playing || now.ad || now.position > 0)) {
        if (!now.playing) await press(apCall('play'))
        return started(track, startAt, 'resume')
      }

      trace(`play ${key}: open`)
      if (!(await goTo(wv, `/audio${key}`))) trace(`play ${key}: its page did not open`)
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (token !== playToken) return
        const st = await run<VkPageState>(READ_STATE)
        if (plays(st)) {
          // already this track, only not going (still loading, or paused): no toggle, it would stop it
          await press(apCall('play'))
        } else {
          let clicked = false
          for (let i = 0; i < 30 && !clicked; i++) {
            clicked = (await press<boolean>(clickPlay(key))) === true
            if (token !== playToken) return
            if (!clicked) await sleep(300)
          }
          if (!clicked) break
        }
        for (let i = 0; i < 16; i++) {
          await sleep(500)
          if (token !== playToken) return
          const st = await run<VkPageState>(READ_STATE)
          if (plays(st) && (st.playing || st.ad)) return started(track, startAt, `${attempt} click(s)`)
        }
        trace(`play ${key}: click ${attempt} did not start it, retrying`)
      }
      if (token !== playToken) return
      throw new Error(tx('ВКонтакте не дал включить трек'))
    })
  },
  pause() {
    void run(apCall('pause'))
    externalEvents.state({ playing: false })
  },
  resume() {
    allowPlay(10_000)
    void press(apCall('play'))
    externalEvents.state({ playing: true })
  },
  seek(t) {
    lastMoveAt = Date.now()
    void run(seekTo(Number(t) || 0))
  },
  setVolume(volume, muted) {
    // same curve as our own engine; the page's audio goes through the hook in preload/yandex.ts
    pageVolume = muted ? 0 : volume * volume
    // while the poll runs it applies the new level with the fade; otherwise set it now
    pageLevel = -1
    if (!pollTimer) void run(`window.__scVolume && window.__scVolume(${pageVolume})`)
  },
  release() {
    playToken++
    stopMirror()
    expected = null
    void run(apCall('pause'))
  },
  next() {
    endSignalled = false
    allowPlay(15_000)
    void press(apCall('playNext'))
  },
  prev() {
    endSignalled = false
    allowPlay(15_000)
    void press(apCall('playPrev'))
  },
  twin: findTwin,
  glow: () => bass.level * engine.glowStrength()
}

registerExternal('vk', driver)
