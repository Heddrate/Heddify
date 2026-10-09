import { create } from 'zustand'
import { api, tracksOf } from '@/lib/api'
import { trackArt } from '@/lib/artwork'
import type { PlaySource, Route, Track, User } from '@/lib/types'
import { engine } from '@/player/engine'
import { toast } from './ui'
import { tx } from '@/lib/i18n'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  current: Track | null
  /** The list being played through (shuffled order when shuffle is on). */
  context: Track[]
  /** Unshuffled copy of `context` while shuffle is on. */
  original: Track[] | null
  /** Position in `context` of the last context track played. */
  index: number
  /** True when `current` was taken from the manual queue. */
  fromManual: boolean
  /** "Play next" / "Add to queue" tracks; they play before the context continues. */
  manual: Track[]
  source: PlaySource | null
  playing: boolean
  loading: boolean
  position: number
  duration: number
  buffered: number
  preview: boolean
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  autoplay: boolean
  /** Tracks that failed to play this session (DRM-only, region-locked…). */
  unplayable: Set<number>
}

export const usePlayer = create<PlayerState>(() => ({
  current: null,
  context: [],
  original: null,
  index: -1,
  fromManual: false,
  manual: [],
  source: null,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  buffered: 0,
  preview: false,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  autoplay: true,
  unplayable: new Set()
}))

const set = usePlayer.setState
const get = usePlayer.getState

engine.setVolume(get().volume, false)

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ---------------- persistence ---------------- */

const slimUser = (u?: User): User | undefined =>
  u && { id: u.id, kind: 'user', username: u.username, avatar_url: u.avatar_url, permalink_url: u.permalink_url }

/** Just what lists need to show a track; small enough to keep in saved settings. */
export const slim = (t: Track): Track => ({
  id: t.id,
  kind: 'track',
  title: t.title,
  user: slimUser(t.user),
  artwork_url: t.artwork_url,
  duration: t.duration,
  full_duration: t.full_duration,
  permalink_url: t.permalink_url,
  policy: t.policy,
  playback_count: t.playback_count,
  created_at: t.created_at,
  origin: t.origin,
  ya: t.ya,
  au: t.au,
  genre: t.genre
})

interface SavedSession {
  current: Track
  context: Track[]
  index: number
  manual: Track[]
  source: PlaySource | null
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persistQueue(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = get()
    if (!s.current) return
    const from = Math.max(0, s.index - 50)
    const session: SavedSession = {
      current: slim(s.current),
      context: s.context.slice(from, from + 400).map(slim),
      index: s.index - from,
      manual: s.manual.slice(0, 100).map(slim),
      source: s.source
    }
    void window.sc.prefs.set({ session, sessionPosition: s.position })
  }, 1500)
}

let lastPosSave = 0
function persistPosition(position: number): void {
  if (Date.now() - lastPosSave < 10_000) return
  lastPosSave = Date.now()
  void window.sc.prefs.set({ sessionPosition: position })
}

let prefTimer: ReturnType<typeof setTimeout> | null = null
function persistPrefs(): void {
  if (prefTimer) clearTimeout(prefTimer)
  prefTimer = setTimeout(() => {
    const { volume, muted, shuffle, repeat, autoplay } = get()
    void window.sc.prefs.set({ volume, muted, shuffle, repeat, autoplay })
  }, 400)
}

export async function restoreSession(): Promise<void> {
  const prefs = await window.sc.prefs.get()
  const volume = typeof prefs.volume === 'number' ? prefs.volume : 0.8
  const muted = prefs.muted === true
  set({
    volume,
    muted,
    shuffle: prefs.shuffle === true,
    repeat: prefs.repeat === 'all' || prefs.repeat === 'one' ? prefs.repeat : 'off',
    autoplay: prefs.autoplay !== false
  })
  engine.setVolume(volume, muted)
  engine.setLeveling(prefs.leveling === true)

  const session = prefs.session as SavedSession | undefined
  if (!session?.current || get().current) return
  const position = typeof prefs.sessionPosition === 'number' ? prefs.sessionPosition : 0
  set({
    current: session.current,
    context: session.context ?? [],
    original: null,
    index: session.index ?? 0,
    manual: session.manual ?? [],
    source: session.source ?? null,
    fromManual: false,
    position,
    duration: (session.current.duration ?? 0) / 1000,
    playing: false
  })
  updateMediaSession(session.current)
}

/* ---------------- media session (media keys, Windows overlay) ---------------- */

function updateMediaSession(t: Track): void {
  if (!('mediaSession' in navigator)) return
  const artwork = trackArt(t, 't500x500')
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title ?? '',
    artist: t.user?.username ?? '',
    album: get().source?.label ?? '',
    artwork: artwork ? [{ src: artwork, sizes: '500x500', type: 'image/jpeg' }] : []
  })
}

let lastPositionState = 0
function updatePositionState(position: number, duration: number): void {
  if (!('mediaSession' in navigator) || !duration || Date.now() - lastPositionState < 1000) return
  lastPositionState = Date.now()
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 })
  } catch {
    /* invalid state during track switch */
  }
}

/* ---------------- core playback ---------------- */

let failStreak = 0

/* ---------- external player (Yandex Music page), see lib/yandex.ts ---------- */

export interface ExternalDriver {
  play(track: Track, startAt: number): Promise<void>
  pause(): void
  resume(): void
  seek(t: number): void
  setVolume(v: number, muted: boolean): void
  /** Stop mirroring and pause the page (another track takes over). */
  release(): void
  /** Ask the page for its own next / previous track (when our queue has none). */
  next(): void
  prev(): void
}

let external: ExternalDriver | null = null
/** True while `current` is played by the external driver. */
let externalActive = false

export function registerExternal(d: ExternalDriver): void {
  external = d
}

const isExternal = (t: Track | null | undefined): boolean => !!t && t.origin === 'yandex'

async function playTrack(track: Track, startAt = 0, autoplay = true): Promise<void> {
  set({
    current: track,
    position: startAt,
    duration: (track.duration ?? 0) / 1000,
    buffered: 0,
    preview: track.policy === 'SNIP'
  })
  updateMediaSession(track)
  persistQueue()

  if (isExternal(track)) {
    engine.stop()
    externalActive = true
    if (!external) return onFail(track, tx("Яндекс Музыка не подключена"))
    set({ loading: true, playing: autoplay })
    try {
      await external.play(track, startAt)
      const { volume, muted } = get()
      external.setVolume(volume, muted)
    } catch (e) {
      onFail(track, e instanceof Error ? e.message : tx("ошибка"))
    }
    return
  }
  if (externalActive) {
    externalActive = false
    external?.release()
  }

  try {
    const stream = await engine.load(track, { autoplay, startAt })
    if (stream) set({ preview: stream.snipped })
  } catch (e) {
    onFail(track, e instanceof Error ? e.message : tx("ошибка"))
  }
}

function onFail(track: Track, message: string): void {
  // lands in logs/api.log via main's console listener
  console.error(`playback failed [${track.origin ?? 'soundcloud'} ${track.id}]: ${message}`)
  set({ unplayable: new Set(get().unplayable).add(track.id) })
  toast(tx('«{0}» не играет: {1}', track.title ?? tx('Трек'), tx(message)))
  failStreak++
  if (failStreak >= 5) {
    failStreak = 0
    set({ playing: false, loading: false })
    toast(tx("Несколько треков подряд недоступны — воспроизведение остановлено"))
    return
  }
  setTimeout(() => {
    if (get().current?.id === track.id) void next(true)
  }, 800)
}

type Generator = () => Promise<Track[]>
const generators = new Map<NonNullable<PlaySource['kind']>, Generator>()

/** Endless sources (see lib/wave.ts) register how to produce their next batch. */
export function registerGenerator(kind: NonNullable<PlaySource['kind']>, fn: Generator): void {
  generators.set(kind, fn)
}

const canGrow = (src: PlaySource | null): boolean => !!src && (!!src.next || (!!src.kind && generators.has(src.kind)))

let loadingMore: Promise<boolean> | null = null
function loadMoreContext(): Promise<boolean> {
  const src = get().source
  if (!src || !canGrow(src)) return Promise.resolve(false)
  if (loadingMore) return loadingMore
  loadingMore = (async () => {
    try {
      let tracks: Track[]
      let next: string | null | undefined = src.next
      if (src.kind && generators.has(src.kind)) {
        tracks = await generators.get(src.kind)!()
      } else {
        const page = await api.page<unknown>(src.next!)
        tracks = tracksOf(page.collection)
        next = page.next_href ?? null
      }
      const s = get()
      if (s.source !== src) return false
      const added = s.shuffle && !src.kind ? shuffled(tracks) : tracks
      set({
        context: [...s.context, ...added],
        original: s.original ? [...s.original, ...tracks] : null,
        source: { ...src, next }
      })
      persistQueue()
      return tracks.length > 0
    } catch {
      return false
    } finally {
      loadingMore = null
    }
  })()
  return loadingMore
}

async function appendRelated(seed: Track): Promise<boolean> {
  try {
    const r = await api.related(seed.id, 30)
    const s = get()
    const have = new Set(s.context.map((t) => t.id))
    const fresh = tracksOf(r.collection).filter((t) => !have.has(t.id) && t.policy !== 'BLOCK')
    if (!fresh.length) return false
    set({
      context: [...s.context, ...fresh],
      original: s.original ? [...s.original, ...fresh] : null,
      source: { label: tx("Похожие на «{0}»", seed.title ?? ''), next: null }
    })
    return true
  } catch {
    return false
  }
}

function prefetch(): void {
  const s = get()
  if (canGrow(s.source) && s.context.length - s.index <= 3) void loadMoreContext()
}

async function next(auto = false): Promise<void> {
  const s = get()
  if (auto && s.repeat === 'one' && s.current) {
    if (externalActive) {
      external?.seek(0)
      external?.resume()
    } else {
      engine.seek(0)
      void engine.play()
    }
    return
  }
  if (s.manual.length) {
    const [t, ...rest] = s.manual
    set({ manual: rest, fromManual: true })
    void playTrack(t)
    return
  }
  // known-unplayable tracks are stepped over instead of failing again
  let i = s.index + 1
  while (i < s.context.length && s.unplayable.has(s.context[i].id)) i++
  if (i < s.context.length) {
    set({ index: i, fromManual: false })
    prefetch()
    void playTrack(s.context[i])
    return
  }
  if (canGrow(s.source) && (await loadMoreContext())) return next(auto)
  if (s.repeat === 'all' && s.context.length) {
    set({ index: 0, fromManual: false })
    void playTrack(s.context[0])
    return
  }
  // our queue is done but Yandex is playing: let its own player continue
  if (externalActive && external) {
    external.next()
    return
  }
  const seed = get().current
  if (get().autoplay && seed && !isExternal(seed) && (await appendRelated(seed))) {
    const j = get().index + 1
    set({ index: j, fromManual: false })
    void playTrack(get().context[j])
    return
  }
  if (auto) {
    engine.pause()
    engine.seek(0)
    set({ playing: false, position: 0 })
  }
}

const events: Parameters<typeof engine.bind>[0] = {
  time(position, duration) {
    set({ position, duration })
    updatePositionState(position, duration)
    if (get().playing) persistPosition(position)
  },
  buffered(end) {
    set({ buffered: end })
  },
  state(st) {
    set(st)
    if ('mediaSession' in navigator && st.playing !== undefined) {
      navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused'
    }
  },
  started(track) {
    failStreak = 0
    if (!isExternal(track)) void api.reportPlay(track.id)
  },
  ended() {
    void next(true)
  },
  error(message) {
    const t = get().current
    if (t) onFail(t, message)
  }
}

engine.bind(events)

/** The external driver reports its playback through the same events as our engine. */
export const externalEvents = {
  ...events,
  active: (): boolean => externalActive,
  /**
   * The Yandex page started playing on its own (user pressed play there): make it
   * the current track so the player bar mirrors and controls it.
   */
  adopt(track: Track, source: PlaySource = { label: tx('Яндекс Музыка'), route: { name: 'yandex' } }): void {
    if (engine.hasSource() && !engine.isPaused()) engine.pause()
    externalActive = true
    set({
      current: track,
      context: [track],
      original: null,
      index: 0,
      fromManual: false,
      source,
      duration: (track.duration ?? 0) / 1000
    })
    updateMediaSession(track)
  },
  /** The page moved on to another track by itself: update what we show. */
  replaceCurrent(track: Track): void {
    set({ current: track, duration: (track.duration ?? 0) / 1000 })
    updateMediaSession(track)
  }
}

/* ---------------- public API ---------------- */

export const player = {
  /** Start playing `tracks` from `start`. With `shuffle: true` a random track starts. */
  playContext(tracks: Track[], start: number, source: PlaySource, opts: { shuffle?: boolean } = {}): void {
    const list = tracks.filter((t) => t && typeof t.id === 'number')
    if (!list.length) return
    // generated sources (the wave) are already ordered on purpose: never shuffle them
    const generated = !!source.kind
    const shuffle = generated ? false : (opts.shuffle ?? get().shuffle)
    let index = Math.max(0, Math.min(start, list.length - 1))
    if (opts.shuffle) index = Math.floor(Math.random() * list.length)
    let context = list
    let original: Track[] | null = null
    if (shuffle) {
      original = list
      context = [list[index], ...shuffled(list.filter((_, i) => i !== index))]
      index = 0
    }
    failStreak = 0
    set({ context, original, index, fromManual: false, source, ...(generated ? {} : { shuffle }) })
    if (opts.shuffle !== undefined) persistPrefs()
    prefetch()
    void playTrack(context[index])
  },

  /** Appends tracks to the queue if it is still playing from `route`. */
  extendContext(route: Route, tracks: Track[]): void {
    const s = get()
    if (!tracks.length || JSON.stringify(s.source?.route) !== JSON.stringify(route)) return
    set({
      context: [...s.context, ...(s.shuffle ? shuffled(tracks) : tracks)],
      original: s.original ? [...s.original, ...tracks] : null
    })
    persistQueue()
  },

  /** Swaps everything after the current context track (used when wave settings change). */
  replaceUpcoming(tracks: Track[]): void {
    const s = get()
    const head = s.context.slice(0, s.index + 1)
    set({ context: [...head, ...tracks], original: s.original ? [...head, ...tracks] : null })
    persistQueue()
  },

  /** Pauses whatever is playing. */
  pause(): void {
    if (externalActive) external?.pause()
    else if (!engine.isPaused()) engine.pause()
  },

  toggle(): void {
    const s = get()
    if (!s.current) return
    if (externalActive && external) {
      if (s.playing) external.pause()
      else external.resume()
      return
    }
    if (isExternal(s.current)) {
      // restored session ended on a Yandex track
      void playTrack(s.current, s.position)
      return
    }
    if (!engine.hasSource()) {
      void playTrack(s.current, s.position)
      return
    }
    engine.toggle()
  },

  next: () => void next(false),

  prev(): void {
    const s = get()
    if (!s.current) return
    const restart = (): void => (externalActive ? external?.seek(0) : engine.seek(0))
    if (s.position > 3) {
      restart()
      return
    }
    if (s.fromManual && s.context[s.index]) {
      set({ fromManual: false })
      void playTrack(s.context[s.index])
      return
    }
    if (s.index > 0) {
      set({ index: s.index - 1 })
      void playTrack(s.context[s.index - 1])
      return
    }
    if (externalActive && external) external.prev()
    else restart()
  },

  seek(t: number): void {
    if (externalActive) external?.seek(t)
    else if (engine.hasSource()) engine.seek(t)
    set({ position: t })
  },

  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume))
    set({ volume: v, muted: false })
    engine.setVolume(v, false)
    if (externalActive) external?.setVolume(v, false)
    persistPrefs()
  },

  toggleMute(): void {
    const s = get()
    const muted = !s.muted
    const volume = !muted && s.volume === 0 ? 0.5 : s.volume
    set({ muted, volume })
    engine.setVolume(volume, muted)
    if (externalActive) external?.setVolume(volume, muted)
    persistPrefs()
  },

  toggleShuffle(): void {
    const s = get()
    const anchor = s.context[s.index]
    if (!s.shuffle) {
      const rest = s.context.filter((_, i) => i !== s.index)
      set({
        shuffle: true,
        original: s.context,
        context: anchor ? [anchor, ...shuffled(rest)] : shuffled(s.context),
        index: anchor ? 0 : -1
      })
    } else {
      const orig = s.original ?? s.context
      const i = anchor ? orig.findIndex((t) => t.id === anchor.id) : -1
      set({ shuffle: false, context: orig, original: null, index: i })
    }
    persistPrefs()
    persistQueue()
  },

  cycleRepeat(): void {
    const order: RepeatMode[] = ['off', 'all', 'one']
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] })
    persistPrefs()
  },

  toggleAutoplay(): void {
    set({ autoplay: !get().autoplay })
    persistPrefs()
  },

  /** Plays a track right now without leaving the current queue. */
  playNow(track: Track): void {
    if (!get().current) return player.playContext([track], 0, { label: tx("Очередь") })
    set({ manual: [track, ...get().manual] })
    void next(false)
  },

  playNext(track: Track): void {
    if (!get().current) return player.playContext([track], 0, { label: tx("Очередь") })
    set({ manual: [track, ...get().manual] })
    persistQueue()
    toast(tx("Будет следующим"))
  },

  enqueue(track: Track): void {
    if (!get().current) return player.playContext([track], 0, { label: tx("Очередь") })
    set({ manual: [...get().manual, track] })
    persistQueue()
    toast(tx("Добавлено в очередь"))
  },

  removeManual(i: number): void {
    set({ manual: get().manual.filter((_, j) => j !== i) })
    persistQueue()
  },

  clearManual(): void {
    set({ manual: [] })
    persistQueue()
  },

  jumpContext(i: number): void {
    const t = get().context[i]
    if (!t) return
    set({ index: i, fromManual: false })
    prefetch()
    void playTrack(t)
  },

  jumpManual(i: number): void {
    const s = get()
    const t = s.manual[i]
    if (!t) return
    set({ manual: s.manual.slice(i + 1), fromManual: true })
    void playTrack(t)
  },

  async startRadio(track: Track): Promise<void> {
    toast(tx("Собираю похожие треки…"))
    try {
      const r = await api.related(track.id, 40)
      const related = tracksOf(r.collection).filter((t) => t.id !== track.id && t.policy !== 'BLOCK')
      player.playContext([track, ...related], 0, { label: tx("Радио: {0}", track.title ?? '') })
    } catch {
      toast(tx("Не удалось собрать радио"))
    }
  },

  reset(): void {
    engine.stop()
    if (externalActive) external?.release()
    externalActive = false
    set({
      current: null,
      context: [],
      original: null,
      index: -1,
      fromManual: false,
      manual: [],
      source: null,
      playing: false,
      loading: false,
      position: 0,
      duration: 0,
      buffered: 0,
      preview: false
    })
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null
    void window.sc.prefs.set({ session: null, sessionPosition: 0 })
  }
}

// Windows taskbar thumbnail buttons
usePlayer.subscribe((s, prev) => {
  if (s.playing === prev.playing && s.current?.id === prev.current?.id) return
  const t = s.current
  const title = t ? [t.user?.username, t.title].filter(Boolean).join(' — ') : ''
  window.sc?.playerState({ playing: s.playing, hasTrack: !!t, title })
})
/* ---------- media keys ---------- */

export type MediaCommand = 'toggle' | 'play' | 'pause' | 'next' | 'prev'

let lastMedia = { kind: '', at: 0 }

/**
 * One entry point for every source of media commands: keyboard media keys (grabbed by
 * main), the Windows media overlay, taskbar buttons, the tray and the Yandex page. A key
 * press can arrive through two of them at once, so a repeat within 400 ms is dropped.
 */
export function mediaCommand(cmd: MediaCommand): void {
  const kind = cmd === 'next' || cmd === 'prev' ? cmd : 'playback'
  const now = Date.now()
  if (lastMedia.kind === kind && now - lastMedia.at < 400) return
  lastMedia = { kind, at: now }
  const playing = usePlayer.getState().playing
  if (cmd === 'next') player.next()
  else if (cmd === 'prev') player.prev()
  else if (cmd === 'toggle' || (cmd === 'play') !== playing) player.toggle()
}

window.sc?.onPlayerCommand((cmd) => mediaCommand(cmd))

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => mediaCommand('play'))
  ms.setActionHandler('pause', () => mediaCommand('pause'))
  ms.setActionHandler('stop', () => mediaCommand('pause'))
  ms.setActionHandler('previoustrack', () => mediaCommand('prev'))
  ms.setActionHandler('nexttrack', () => mediaCommand('next'))
  ms.setActionHandler('seekto', (d) => d.seekTime != null && player.seek(d.seekTime))
  // Windows shows play or pause in its media overlay from this, for Yandex tracks too
  usePlayer.subscribe((s, prev) => {
    if (s.playing === prev.playing && !!s.current === !!prev.current) return
    ms.playbackState = s.playing ? 'playing' : s.current ? 'paused' : 'none'
  })
}
