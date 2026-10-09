/**
 * "Моя волна": an endless queue built from the user's likes.
 *
 * Each batch takes a few seed tracks (recent likes weigh more, plus whatever the user
 * liked or listened through during this wave), pulls SoundCloud's related tracks for
 * every seed and interleaves them so no seed or artist dominates. Quick skips push an
 * artist out of the wave; tracks liked mid-wave become seeds for the next batch.
 *
 * The wave is shared between services: SoundCloud picks are mixed with Yandex's own wave
 * (or tracks similar to the Yandex likes) and Audius trending in the genres the user likes.
 * Without SoundCloud the wave runs on Yandex and / or Audius alone.
 */
import { create } from 'zustand'
import { api, collectTracks, tracksOf } from './api'
import type { PlaySource, Track } from './types'
import { useApp } from '@/store/app'
import { player, registerGenerator, usePlayer } from '@/store/player'
import { toast } from '@/store/ui'
import { tx } from '@/lib/i18n'
import { useYa, yandexWaveTracks } from './yandexApi'
import { audiusWaveTracks, useAudius } from './audius'

export type WaveMode = 'mix' | 'new' | 'favorite'

/** Where the wave takes tracks from. */
type Src = 'sc' | 'ya' | 'au'
export type WaveSources = 'all' | Src

export const waveSources = (): [WaveSources, string][] => [
  ['all', tx("Всё вместе")],
  ['sc', 'SoundCloud'],
  ['ya', tx("Яндекс")],
  ['au', 'Audius']
]

interface WaveState {
  mode: WaveMode
  sources: WaveSources
  building: boolean
  /** First batch prepared while the wave is off, so the page can show what's coming. */
  preview: Track[] | null
  /** Tracks played in the current wave run, oldest first. */
  played: Track[]
}

export const useWave = create<WaveState>(() => ({ mode: 'mix', sources: 'all', building: false, preview: null, played: [] }))

const BATCH = 20
const SKIP_SECONDS = 30
const MAX_LENGTH_MS = 20 * 60_000

/**
 * Artist key for skip / dislike / spread logic. Yandex tracks carry no SoundCloud user,
 * so they get negative keys from the Yandex artist id (or the artist name).
 */
function artistKey(t: Track): number | undefined {
  if (t.origin === 'yandex') {
    if (t.ya?.artistId) return -t.ya.artistId
    const name = t.user?.username ?? ''
    let h = 7
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
    return name ? -Math.abs(h) - 1 : undefined
  }
  return t.user?.id
}

/* ---------- likes pool ---------- */

let pool: Track[] = []
let poolAt = 0
let poolFull = false

async function loadPool(): Promise<Track[]> {
  const me = useApp.getState().me
  if (!me) return []
  if (pool.length && Date.now() - poolAt < 15 * 60_000) return pool

  const first = await api.likes(me.id, 200)
  pool = tracksOf(first.collection)
  poolAt = Date.now()
  poolFull = !first.next_href
  // The rest of the likes arrive in the background; the first batch only needs recent ones.
  if (first.next_href) {
    void collectTracks(first, 1500).then(
      (all) => {
        pool = all
        poolFull = true
      },
      () => undefined
    )
  }
  if (!pool.length) {
    // No likes yet: fall back to listening history.
    pool = tracksOf((await api.history(100)).collection)
  }
  return pool
}

/* ---------- session state (one wave run) ---------- */

interface Session {
  seen: Set<number>
  usedSeeds: Set<number>
  played: Track[]
  /** tracks listened through: good seeds */
  good: Track[]
  /** quick skips per artist */
  skips: Map<number, number>
}

/** Artists the user said "не нравится" to; kept for a while across launches. */
let disliked: { key: number; at: number }[] = []
const DISLIKE_DAYS = 60

function newSession(): Session {
  const fresh = Date.now() - DISLIKE_DAYS * 86_400_000
  const skips = new Map<number, number>(disliked.filter((d) => d.at > fresh).map((d) => [d.key, 2]))
  return { seen: new Set(), usedSeeds: new Set(), played: [], good: [], skips }
}

let session: Session = newSession()

const isWave = (src: PlaySource | null | undefined): boolean => src?.kind === 'wave'

// Learn from what happens in the player while the wave is on.
usePlayer.subscribe((s, prev) => {
  const t = prev.current
  if (!t || s.current?.id === t.id || !isWave(prev.source)) return
  session.played.push(t)
  session.seen.add(t.id)
  useWave.setState({ played: session.played.slice(-50) })
  const listened = prev.position
  const length = prev.duration || (t.duration ?? 0) / 1000
  if (listened < SKIP_SECONDS && length > 45) {
    const artist = artistKey(t)
    if (artist) session.skips.set(artist, (session.skips.get(artist) ?? 0) + 1)
  } else if (listened > Math.min(90, length * 0.6)) {
    session.good.push(t)
  }
})

/* ---------- batch building ---------- */

function weightedPick(list: Track[], count: number, exclude: Set<number>): Track[] {
  // index 0 is the most recent like; recent likes are several times more likely
  const candidates = list.map((t, i) => ({ t, w: 1 / (1 + i / 40) })).filter(({ t }) => !exclude.has(t.id))
  const out: Track[] = []
  while (out.length < count && candidates.length) {
    const total = candidates.reduce((sum, c) => sum + c.w, 0)
    let r = Math.random() * total
    let i = 0
    while (i < candidates.length - 1 && (r -= candidates[i].w) > 0) i++
    out.push(candidates[i].t)
    candidates.splice(i, 1)
  }
  return out
}

/** Likes as the app sees them: SoundCloud's, plus likes still waiting to be delivered. */
function seedPool(): Track[] {
  const ops = Object.values(useApp.getState().pending).filter((op) => op.kind === 'like')
  const removed = new Set(ops.filter((op) => !op.on).map((op) => op.id))
  const local = ops.filter((op) => op.on && op.track).map((op) => op.track!)
  const localIds = new Set(local.map((t) => t.id))
  return [...local, ...pool.filter((t) => !removed.has(t.id) && !localIds.has(t.id))]
}

function pickSeeds(count: number, base: Track[]): Track[] {
  const likes = useApp.getState().likes
  const seeds: Track[] = []
  const add = (t?: Track): void => {
    if (t && !seeds.some((x) => x.id === t.id)) seeds.push(t)
  }

  // strongest signal: liked during this wave
  session.played
    .filter((t) => likes.has(t.id))
    .slice(-2)
    .forEach(add)
  // then: the last track listened through
  add(session.good[session.good.length - 1])

  if (session.usedSeeds.size > base.length * 0.8) session.usedSeeds.clear()
  for (const t of weightedPick(base, count - seeds.length, new Set([...session.usedSeeds, ...seeds.map((s) => s.id)]))) add(t)

  seeds.forEach((t) => session.usedSeeds.add(t.id))
  return seeds.slice(0, count)
}

/** Monetised tracks that also ship DRM copies usually play only in SoundCloud's own player. */
const likelyDrmOnly = (t: Track): boolean =>
  t.policy === 'MONETIZE' && !!t.media?.transcodings?.some((x) => x.format?.protocol?.includes('encrypted'))

function acceptable(t: Track, seedLong: boolean): boolean {
  if (!t.title || t.policy === 'BLOCK' || session.seen.has(t.id)) return false
  if (usePlayer.getState().unplayable.has(t.id)) return false
  const artist = artistKey(t)
  if (artist && (session.skips.get(artist) ?? 0) >= 2) return false
  const length = t.full_duration || t.duration || 0
  if (t.origin === 'yandex' && !length) return true
  if (!seedLong && length > MAX_LENGTH_MS) return false
  return length > 30_000
}

/** Reorders so the same artist doesn't play twice in a row when avoidable. */
function spreadArtists(list: Track[]): Track[] {
  const out = list.slice()
  for (let i = 1; i < out.length; i++) {
    const prev = artistKey(out[i - 1])
    if (artistKey(out[i]) !== prev) continue
    const j = out.findIndex((t, k) => k > i && artistKey(t) !== prev)
    if (j > 0) [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Share of a shared batch per service: SoundCloud leads, Yandex every ~3rd, Audius a spice. */
const WEIGHT: Record<Src, number> = { sc: 3, ya: 2, au: 1 }

/** Services feeding the wave right now, given what's connected and the user's choice. */
export function waveServices(): Src[] {
  const pick = useWave.getState().sources
  const connected: Src[] = []
  if (useApp.getState().auth === 'in') connected.push('sc')
  if (useYa.getState().status === 'in') connected.push('ya')
  if (pick === 'au') return ['au']
  if (pick !== 'all' && connected.includes(pick)) return [pick]
  // Audius joins once the user liked something there, or when nothing else is connected
  return useAudius.getState().likes.length > 0 || !connected.length ? [...connected, 'au'] : connected
}

/** Picks from another service's wave; never fails, an empty list just leaves them out. */
async function servicePicks(
  fetch: (count: number, exclude: Set<number>) => Promise<Track[]>,
  count: number,
  allowLong: boolean
): Promise<Track[]> {
  if (count <= 0) return []
  try {
    const list = await fetch(count + 5, session.seen)
    return list.filter((t) => acceptable(t, allowLong)).slice(0, count)
  } catch {
    return []
  }
}

/** Smooth weighted round-robin: services alternate in proportion to their weight. */
function mixWeighted(parts: { items: Track[]; w: number }[]): Track[] {
  const live = parts.filter((p) => p.items.length).map((p) => ({ ...p, cur: 0, i: 0 }))
  const out: Track[] = []
  for (;;) {
    const open = live.filter((p) => p.i < p.items.length)
    if (!open.length) return out
    const total = open.reduce((s, p) => s + p.w, 0)
    for (const p of open) p.cur += p.w
    const best = open.reduce((a, b) => (b.cur > a.cur ? b : a))
    best.cur -= total
    out.push(best.items[best.i++])
  }
}

async function buildBatch(): Promise<Track[]> {
  const services = waveServices()
  const total = services.reduce((s, x) => s + WEIGHT[x], 0)
  const count = (x: Src): number => (services.includes(x) ? Math.round((BATCH * WEIGHT[x]) / total) : 0)
  const [sc, ya, au] = await Promise.all([
    count('sc') ? buildScBatch(count('sc')).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
    servicePicks(yandexWaveTracks, count('ya'), true),
    servicePicks(audiusWaveTracks, count('au'), false)
  ])
  for (const t of [...ya, ...au]) session.seen.add(t.id)
  return mixWeighted([
    { items: sc, w: WEIGHT.sc },
    { items: ya, w: WEIGHT.ya },
    { items: au, w: WEIGHT.au }
  ])
}
async function buildScBatch(size: number): Promise<Track[]> {
  const mode = useWave.getState().mode
  const likes = useApp.getState().likes
  await loadPool()
  const base = seedPool()
  if (!base.length) return []

  const seeds = pickSeeds(mode === 'favorite' ? 3 : 4, base)
  const lists = await Promise.all(
    seeds.map((s) =>
      api.related(s.id, 25).then(
        (r) => tracksOf(r.collection),
        () => [] as Track[]
      )
    )
  )
  const seedLong = seeds.some((s) => (s.full_duration || s.duration || 0) > MAX_LENGTH_MS)

  const familiarCount = mode === 'favorite' ? Math.round(size * 0.4) : mode === 'mix' ? 2 : 0
  const freshTarget = size - familiarCount
  const perArtist = new Map<number, number>()
  const fresh: Track[] = []
  const take = (t: Track): void => {
    fresh.push(t)
    session.seen.add(t.id)
    const a = artistKey(t)
    if (a) perArtist.set(a, (perArtist.get(a) ?? 0) + 1)
  }

  // round-robin over the seeds' related lists; likely-DRM tracks only if nothing else is left
  for (const allowDrmRisk of [false, true]) {
    const cursors = lists.map(() => 0)
    let progress = true
    while (fresh.length < freshTarget && progress) {
      progress = false
      lists.forEach((list, i) => {
        while (cursors[i] < list.length) {
          const t = list[cursors[i]++]
          if (!acceptable(t, seedLong)) continue
          if (!allowDrmRisk && likelyDrmOnly(t)) continue
          const a = artistKey(t)
          if (a && (perArtist.get(a) ?? 0) >= 2) continue
          if (mode !== 'favorite' && likes.has(t.id)) continue
          if (fresh.length < freshTarget) take(t)
          progress = true
          break
        }
      })
    }
    if (fresh.length >= freshTarget) break
  }

  // a few known favourites, dropped in at random places (never first)
  const familiar = weightedPick(base, familiarCount, session.seen).filter((t) => acceptable(t, true))
  const batch = fresh.slice()
  for (const t of familiar) {
    session.seen.add(t.id)
    batch.splice(1 + Math.floor(Math.random() * batch.length), 0, t)
  }

  if (!batch.length) {
    // related lookups failed: play unheard likes rather than nothing
    return weightedPick(base, size, session.seen).map((t) => (session.seen.add(t.id), t))
  }
  return spreadArtists(batch)
}

registerGenerator('wave', buildBatch)

/* ---------- public ---------- */

export const waveSource = (): PlaySource => ({ label: tx("Моя волна"), kind: 'wave', route: { name: 'wave' } })

export function useWaveActive(): boolean {
  return usePlayer((s) => isWave(s.source))
}

export function useWavePlaying(): boolean {
  return usePlayer((s) => isWave(s.source) && s.playing)
}

/** Start the wave, or pause / resume it if it is already on. */
export async function toggleWave(): Promise<void> {
  const s = usePlayer.getState()
  if (isWave(s.source) && s.current) {
    player.toggle()
    return
  }
  await startWave()
}

let previewAt = 0

/**
 * Prepares the first batch while the wave is off so its page can list what will play.
 * The preview owns a fresh session; starting the wave just continues it.
 */
export async function ensurePreview(force = false): Promise<void> {
  const st = useWave.getState()
  if (st.building || isWave(usePlayer.getState().source)) return
  if (!force && st.preview && Date.now() - previewAt < 10 * 60_000) return
  useWave.setState({ building: true })
  try {
    session = newSession()
    const batch = await buildBatch()
    previewAt = Date.now()
    useWave.setState({ preview: batch, played: [] })
  } catch {
    useWave.setState({ preview: [] })
  } finally {
    useWave.setState({ building: false })
  }
}

/** Starts the wave (optionally from a given track of the preview). */
export async function startWave(from = 0): Promise<void> {
  if (useWave.getState().building) return
  let batch = useWave.getState().preview
  if (!batch?.length || Date.now() - previewAt > 10 * 60_000) {
    useWave.setState({ building: true })
    try {
      session = newSession()
      batch = await buildBatch()
    } catch {
      batch = []
    } finally {
      useWave.setState({ building: false })
    }
  }
  if (!batch.length) {
    toast(tx("Лайкните несколько треков — волна строится по ним"))
    return
  }
  useWave.setState({ preview: null, played: [] })
  // start at the chosen track but keep the ones above it: «назад» still reaches them
  player.playContext(batch, from, waveSource())
}

/** Rebuilds what's coming next (after a mode change or on request). */
export async function refreshWave(): Promise<void> {
  const s = usePlayer.getState()
  if (!isWave(s.source)) return ensurePreview(true)
  for (const t of s.context.slice(s.index + 1)) session.seen.delete(t.id)
  useWave.setState({ building: true })
  try {
    const batch = await buildBatch()
    if (batch.length && isWave(usePlayer.getState().source)) player.replaceUpcoming(batch)
  } finally {
    useWave.setState({ building: false })
  }
}

/** "Не нравится": skip now and keep this artist out of the rest of the wave. */
export function dislikeCurrent(): void {
  const s = usePlayer.getState()
  const t = s.current
  if (!t || !isWave(s.source)) return
  const artist = artistKey(t)
  if (artist) {
    session.skips.set(artist, 2)
    disliked = [{ key: artist, at: Date.now() }, ...disliked.filter((d) => d.key !== artist)].slice(0, 300)
    void window.sc.prefs.set({ waveDislikes: disliked })
    const upcoming = s.context.slice(s.index + 1).filter((x) => artistKey(x) !== artist)
    player.replaceUpcoming(upcoming)
  }
  session.seen.add(t.id)
  toast(t.user ? tx('{0} больше не попадётся в волне', t.user.username) : tx('Пропущено'))
  player.next()
}

export async function setWaveMode(mode: WaveMode): Promise<void> {
  if (useWave.getState().mode === mode) return
  useWave.setState({ mode })
  void window.sc.prefs.set({ waveMode: mode })
  await refreshWave()
}

export async function setWaveSources(sources: WaveSources): Promise<void> {
  if (useWave.getState().sources === sources) return
  useWave.setState({ sources })
  void window.sc.prefs.set({ waveSources: sources })
  await refreshWave()
}

export async function loadWavePrefs(): Promise<void> {
  const prefs = await window.sc.prefs.get()
  if (Array.isArray(prefs.waveDislikes)) {
    disliked = (prefs.waveDislikes as { key: number; at: number }[]).filter((d) => typeof d?.key === 'number')
    for (const d of disliked) if (!session.skips.has(d.key)) session.skips.set(d.key, 2)
  }
  // the wave always mixes every connected service (the per-service chips are gone)
  if (prefs.waveSources && prefs.waveSources !== 'all') void window.sc.prefs.set({ waveSources: 'all' })
}

/** Forget cached likes (after logout or account switch). */
export function resetWave(): void {
  pool = []
  poolAt = 0
  poolFull = false
  previewAt = 0
  session = newSession()
  useWave.setState({ preview: null, played: [] })
}

export const wavePoolComplete = (): boolean => poolFull

// Settings load on sign-in; cached likes are dropped on sign-out.
useApp.subscribe((s, prev) => {
  if ((s.auth === 'in' || s.auth === 'guest') && prev.auth !== s.auth) void loadWavePrefs()
  if (s.auth !== 'in' && prev.auth === 'in') resetWave()
})

// A freshly connected Yandex account joins the wave: the next preview is rebuilt with it.
useYa.subscribe((s, prev) => {
  if (s.status === 'in' && prev.status !== 'in') {
    void loadWavePrefs()
    previewAt = 0
  }
})
