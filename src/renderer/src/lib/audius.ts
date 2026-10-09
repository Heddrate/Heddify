/**
 * Audius (audius.co): an open music catalogue with a public API. Works for everyone —
 * no account, no key, no VPN — so the app is useful even without SoundCloud or Yandex.
 *
 * Tracks play through our own engine (stream URLs come from main, which also caches
 * them). Likes are kept locally: Audius accounts are wallets, not something to sign in to.
 */
import { create } from 'zustand'
import type { Track } from './types'
import { tx } from './i18n'
import { toast } from '@/store/ui'
import { whenBridge } from './bridge'

const APP = 'SCPlayer'
const DISCOVERY = 'https://api.audius.co'

/** Audius ids live in their own range of our numeric Track ids (SoundCloud > 0, Yandex < 0). */
const ID_BASE = 1e12

export const AUDIUS_GENRES = [
  'Electronic',
  'Hip-Hop/Rap',
  'Pop',
  'Lo-Fi',
  'House',
  'Techno',
  'Drum & Bass',
  'Dubstep',
  'Trap',
  'Alternative',
  'Rock',
  'Metal',
  'R&B/Soul',
  'Ambient',
  'Jazz',
  'Experimental',
  'Hyperpop',
  'Classical'
]

let host: string | null = null

async function base(): Promise<string> {
  if (host) return host
  try {
    const j = (await fetch(DISCOVERY).then((r) => r.json())) as { data?: string[] }
    const list = (j.data ?? []).filter((h) => /^https:\/\//.test(h))
    host = list[Math.floor(Math.random() * list.length)] ?? DISCOVERY
  } catch {
    host = DISCOVERY
  }
  return host
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const u = new URL(path, await base())
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
  u.searchParams.set('app_name', APP)
  let r: Response
  try {
    r = await fetch(u)
  } catch {
    host = null // that node may be down: pick another next time
    throw new Error(tx('Audius недоступен, проверьте интернет'))
  }
  if (!r.ok) {
    if (r.status >= 500) host = null
    throw new Error(tx('Audius: ошибка {0}', r.status))
  }
  return ((await r.json()) as { data: T }).data
}

/* ---------- mapping ---------- */

interface ApiUser {
  id: string
  handle: string
  name: string
  follower_count?: number
  track_count?: number
  bio?: string | null
  profile_picture?: Record<string, string> | null
  cover_photo?: Record<string, string> | null
}

interface ApiTrack {
  id: string
  track_id?: number
  title: string
  duration: number
  genre?: string
  mood?: string | null
  permalink: string
  play_count?: number
  favorite_count?: number
  repost_count?: number
  release_date?: string | null
  created_at?: string | null
  artwork?: Record<string, string> | null
  user: ApiUser
  is_streamable?: boolean
  is_delete?: boolean
  stream_conditions?: unknown
  access?: { stream?: boolean }
}

export interface AudiusUser {
  id: string
  handle: string
  name: string
  avatar: string | null
  cover: string | null
  followers: number
  tracks: number
  bio: string | null
}

/** Numeric part of an Audius hash id, used to give the track a stable numeric id. */
function numericId(t: ApiTrack): number {
  if (t.track_id) return t.track_id
  let h = 0
  for (const c of t.id) h = (h * 62 + c.charCodeAt(0)) % 1e11
  return h
}

const playable = (t: ApiTrack): boolean =>
  !!t && t.is_streamable !== false && !t.is_delete && !t.stream_conditions && t.access?.stream !== false

function toTrack(t: ApiTrack): Track {
  return {
    id: ID_BASE + numericId(t),
    kind: 'track',
    origin: 'audius',
    au: { id: t.id, userId: t.user.id, handle: t.user.handle },
    title: t.title,
    user: {
      id: 0,
      kind: 'user',
      username: t.user.name || t.user.handle,
      avatar_url: t.user.profile_picture?.['150x150'],
      permalink_url: `https://audius.co/${t.user.handle}`
    },
    artwork_url: t.artwork?.['480x480'] ?? t.artwork?.['150x150'] ?? null,
    duration: t.duration * 1000,
    full_duration: t.duration * 1000,
    permalink_url: `https://audius.co${t.permalink}`,
    genre: t.genre ?? null,
    playback_count: t.play_count,
    likes_count: t.favorite_count,
    reposts_count: t.repost_count,
    created_at: t.release_date ?? t.created_at ?? undefined,
    policy: 'ALLOW'
  }
}

const tracks = (list: ApiTrack[] | null | undefined): Track[] => (list ?? []).filter(playable).map(toTrack)

function toUser(u: ApiUser): AudiusUser {
  return {
    id: u.id,
    handle: u.handle,
    name: u.name || u.handle,
    avatar: u.profile_picture?.['480x480'] ?? u.profile_picture?.['150x150'] ?? null,
    cover: u.cover_photo?.['2000x'] ?? u.cover_photo?.['640x'] ?? null,
    followers: u.follower_count ?? 0,
    tracks: u.track_count ?? 0,
    bio: u.bio ?? null
  }
}

/* ---------- catalogue ---------- */

export type AudiusTime = 'week' | 'month' | 'allTime'

export const audius = {
  trending: (genre?: string, time: AudiusTime = 'week'): Promise<Track[]> =>
    get<ApiTrack[]>('/v1/tracks/trending', { genre, time, limit: 50 }).then(tracks),
  underground: (): Promise<Track[]> => get<ApiTrack[]>('/v1/tracks/trending/underground', { limit: 50 }).then(tracks),
  search: (q: string): Promise<Track[]> => get<ApiTrack[]>('/v1/tracks/search', { query: q, limit: 40 }).then(tracks),
  searchUsers: (q: string): Promise<AudiusUser[]> =>
    get<ApiUser[]>('/v1/users/search', { query: q, limit: 12 }).then((l) => (l ?? []).map(toUser)),
  user: (id: string): Promise<AudiusUser> => get<ApiUser>(`/v1/users/${encodeURIComponent(id)}`).then(toUser),
  userTracks: (id: string): Promise<Track[]> =>
    get<ApiTrack[]>(`/v1/users/${encodeURIComponent(id)}/tracks`, { sort: 'plays', limit: 50 }).then(tracks),
  relatedArtists: (id: string): Promise<AudiusUser[]> =>
    get<ApiUser[]>(`/v1/users/${encodeURIComponent(id)}/related`, { limit: 12 }).then((l) => (l ?? []).map(toUser))
}

/* ---------- local likes ---------- */

interface AudiusState {
  likes: Track[]
  likeIds: Set<number>
}

export const useAudius = create<AudiusState>(() => ({ likes: [], likeIds: new Set() }))

const LIKES_KEY = 'audiusLikes'

whenBridge(() => {
  void window.sc.prefs.get().then((p) => {
    const list = Array.isArray(p[LIKES_KEY]) ? (p[LIKES_KEY] as Track[]).filter((t) => t?.au?.id) : []
    useAudius.setState({ likes: list, likeIds: new Set(list.map((t) => t.id)) })
  })
})

export function toggleAudiusLike(track: Track): void {
  if (!track.au) return
  const { likes } = useAudius.getState()
  const on = !likes.some((t) => t.id === track.id)
  const next = on ? [{ ...track, liked_at: new Date().toISOString() }, ...likes].slice(0, 2000) : likes.filter((t) => t.id !== track.id)
  useAudius.setState({ likes: next, likeIds: new Set(next.map((t) => t.id)) })
  void window.sc.prefs.set({ [LIKES_KEY]: next })
  toast(on ? tx('Добавлено в «Мне нравится»') : tx('Удалено из «Мне нравится»'))
}

/* ---------- picks for the shared wave ---------- */

/**
 * Tracks for "Моя волна": trending in the genres of the user's Audius likes (or overall
 * trending when there are none), never repeating what the wave already played.
 */
export async function audiusWaveTracks(count: number, exclude: Set<number>): Promise<Track[]> {
  const likes = useAudius.getState().likes
  const genres = [...new Set(likes.map((t) => t.genre).filter((g): g is string => !!g))]
  const pick = genres.length ? genres.sort(() => Math.random() - 0.5).slice(0, 2) : [undefined]
  const lists = await Promise.all(pick.map((g) => audius.trending(g, Math.random() < 0.5 ? 'week' : 'month').catch(() => [])))
  const pool = lists.flat().filter((t) => !exclude.has(t.id) && !useAudius.getState().likeIds.has(t.id))
  // trending is ordered; shuffle within it so each batch differs
  return pool.sort(() => Math.random() - 0.5).slice(0, count)
}
