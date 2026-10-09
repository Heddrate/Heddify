/**
 * Internet radio from Radio Browser (radio-browser.info): an open, community-run catalogue
 * of stations, no key and no account. Stations play as live streams in our own engine;
 * only https streams are used (the app's CSP allows media over https only). Favourite
 * stations are kept in the app (pref `radioFavs`).
 */
import { create } from 'zustand'
import type { Track } from './types'
import { whenBridge } from './bridge'
import { tx } from './i18n'
import { usePlayer } from '@/store/player'
import { toast } from '@/store/ui'

const SERVERS = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://de2.api.radio-browser.info']
let server = 0

interface Station {
  stationuuid: string
  name: string
  url_resolved?: string
  favicon?: string
  homepage?: string
  tags?: string
  country?: string
  codec?: string
  bitrate?: number
  hls?: number
  lastcheckok?: number
}

async function get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  let lastError: unknown = null
  // mirrors of the same catalogue: stay on the one that answered last
  for (let n = 0; n < SERVERS.length; n++) {
    const i = (server + n) % SERVERS.length
    try {
      const r = await fetch(`${SERVERS[i]}${path}?${q}`, { signal: AbortSignal.timeout(10_000) })
      if (!r.ok) throw new Error(String(r.status))
      server = i
      return (await r.json()) as T
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? new Error(tx('Радио недоступно: {0}', lastError.message)) : new Error(tx('Радио недоступно'))
}

/** Station ids live above Audius' (1e12+) so they never clash with other services. */
const ID_BASE = 2e12

function hashId(uuid: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return ID_BASE + h
}

const https = (u?: string): string | null => (u && u.startsWith('https://') ? u : null)

const tagsOf = (s: Station): string[] =>
  (s.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && t.length < 24)

function toTrack(s: Station): Track | null {
  const url = https(s.url_resolved)
  if (!url || s.lastcheckok === 0 || !s.name?.trim()) return null
  const sub = [s.country, ...tagsOf(s).slice(0, 2), s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean).join(' · ')
  return {
    id: hashId(s.stationuuid),
    kind: 'track',
    title: s.name.trim(),
    user: { id: 0, kind: 'user', username: sub || tx('Радио') },
    artwork_url: https(s.favicon),
    duration: 0,
    permalink_url: https(s.homepage) ?? undefined,
    genre: tagsOf(s)[0] ?? null,
    origin: 'radio',
    radio: { uuid: s.stationuuid, url, hls: s.hls === 1 }
  }
}

/** The catalogue repeats popular stations under several entries: keep one per name. */
function stations(list: Station[]): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  for (const s of list) {
    const t = toTrack(s)
    const key = t?.title?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    if (!t || !key || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

const BASE = { hidebroken: true, order: 'clickcount', reverse: true, is_https: true }

/** Genres for the chips: tag as Radio Browser knows it + label (computed in render). */
export const RADIO_TAGS = (): [string, string][] => [
  ['', tx('Популярные')],
  ['pop', tx('Поп')],
  ['rock', tx('Рок')],
  ['electronic', tx('Электроника')],
  ['hip hop', tx('Хип-хоп')],
  ['dance', tx('Танцевальная')],
  ['jazz', tx('Джаз')],
  ['classical', tx('Классика')],
  ['chillout', tx('Чилаут')],
  ['lofi', 'Lo-Fi'],
  ['news', tx('Новости')]
]

export const radio = {
  /** Popular stations; in the Russian UI first those from Russia. */
  top: (country?: string, limit = 60) => get<Station[]>('/json/stations/search', { ...BASE, countrycode: country, limit: limit * 2 }).then(stations).then((l) => l.slice(0, limit)),
  byTag: (tag: string, limit = 60) => get<Station[]>('/json/stations/search', { ...BASE, tag, limit: limit * 2 }).then(stations).then((l) => l.slice(0, limit)),
  search: (name: string, limit = 24) => get<Station[]>('/json/stations/search', { ...BASE, name, limit: limit * 2 }).then(stations).then((l) => l.slice(0, limit))
}

/* ---------- favourite stations ---------- */

const FAVS_KEY = 'radioFavs'

export const useRadio = create<{ favs: Track[]; favIds: Set<number> }>(() => ({ favs: [], favIds: new Set() }))

whenBridge(() => {
  void window.sc.prefs.get().then((p) => {
    const list = Array.isArray(p[FAVS_KEY]) ? (p[FAVS_KEY] as Track[]).filter((t) => t?.radio?.url) : []
    useRadio.setState({ favs: list, favIds: new Set(list.map((t) => t.id)) })
  })
})

export function toggleRadioFav(track: Track): void {
  if (!track.radio) return
  const { favs } = useRadio.getState()
  const on = !favs.some((t) => t.id === track.id)
  const next = on ? [{ ...track, liked_at: new Date().toISOString() }, ...favs].slice(0, 500) : favs.filter((t) => t.id !== track.id)
  useRadio.setState({ favs: next, favIds: new Set(next.map((t) => t.id)) })
  void window.sc.prefs.set({ [FAVS_KEY]: next })
  toast(on ? tx('Станция добавлена в избранное') : tx('Станция убрана из избранного'))
}

/* Radio Browser asks clients to report a play: it ranks stations by these clicks. */
let lastClick = 0
usePlayer.subscribe((s) => {
  const t = s.current
  if (!t?.radio || !s.playing || t.id === lastClick) return
  lastClick = t.id
  void get(`/json/url/${encodeURIComponent(t.radio.uuid)}`).catch(() => undefined)
})
