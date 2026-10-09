import type { ApiMethod } from '../../../shared/ipc'
import { tx } from './i18n'
import type {
  AnyPlaylist,
  Collection,
  HistoryItem,
  LikeItem,
  Playlist,
  Selection,
  StreamItem,
  SystemPlaylist,
  Track,
  User
} from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** refused by SoundCloud's anti-bot (captcha/block), not by the API itself */
    public blocked = false
  ) {
    super(message)
  }
}

type Params = Record<string, string | number | boolean | undefined>

let onAuthLost: (() => void) | null = null
export const setAuthLostHandler = (fn: () => void): void => {
  onAuthLost = fn
}

async function request<T>(method: ApiMethod, path: string, params?: Params, body?: unknown, quiet = false): Promise<T> {
  const r = await window.sc.api<T>(method, path, params, body, { quiet })
  if (!r.ok) {
    if (r.auth) onAuthLost?.()
    throw new ApiError(tx(r.error), r.status, !!r.blocked)
  }
  return r.data
}

const cache = new Map<string, { at: number; promise: Promise<unknown> }>()
const TTL = 90_000

function get<T>(path: string, params?: Params, ttl = TTL): Promise<T> {
  const key = path + '|' + JSON.stringify(params ?? {})
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.promise as Promise<T>
  const promise = request<T>('GET', path, params)
  cache.set(key, { at: Date.now(), promise })
  promise.catch(() => cache.delete(key))
  return promise
}

export function invalidate(fragment: string): void {
  for (const key of cache.keys()) if (key.includes(fragment)) cache.delete(key)
}

/** Pulls track objects out of the many collection shapes api-v2 returns. */
export function tracksOf(items: unknown[]): Track[] {
  const out: Track[] = []
  for (const raw of items) {
    const it = raw as { kind?: string; track?: Track } | null
    if (!it) continue
    if (it.kind === 'track') out.push(it as Track)
    else if (it.track && typeof it.track.id === 'number') out.push(it.track)
  }
  return out
}

function idsOf(data: unknown): number[] {
  const list = Array.isArray(data) ? data : ((data as { collection?: unknown[] })?.collection ?? [])
  return list
    .map((x) => (typeof x === 'number' ? x : (x as { id?: number })?.id))
    .filter((x): x is number => typeof x === 'number')
}

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

/** Playlist responses contain only ids for most tracks; fetch the rest in batches. */
export async function hydrate(tracks: Track[]): Promise<Track[]> {
  const missing = tracks.filter((t) => !t.title).map((t) => t.id)
  if (!missing.length) return tracks
  const found = new Map<number, Track>()
  const batches = chunk(missing, 50)
  for (let i = 0; i < batches.length; i += 3) {
    const results = await Promise.all(
      batches.slice(i, i + 3).map((ids) =>
        get<Track[] | Collection<Track>>('/tracks', { ids: ids.join(',') }).catch(() => [] as Track[])
      )
    )
    for (const r of results) {
      const list = Array.isArray(r) ? r : (r.collection ?? [])
      for (const t of list) found.set(t.id, t)
    }
  }
  return tracks.map((t) => (t.title ? t : found.get(t.id))).filter((t): t is Track => !!t)
}

const PAGE = 50

export const api = {
  me: () => request<User>('GET', '/me'),

  page: <T,>(href: string) => get<Collection<T>>(href),

  likes: (userId: number, limit = PAGE) =>
    get<Collection<LikeItem>>(`/users/${userId}/track_likes`, { limit, linked_partitioning: 1 }, 20_000),
  likedIds: () => request<unknown>('GET', '/me/track_likes/ids', { limit: 5000 }).then(idsOf),
  followingIds: () => request<unknown>('GET', '/me/followings/ids', { limit: 5000 }).then(idsOf),

  libraryPlaylists: (userId: number) =>
    get<Collection<{ playlist?: Playlist; system_playlist?: SystemPlaylist; type?: string }>>(
      `/users/${userId}/playlists_liked_and_owned`,
      { limit: 200, linked_partitioning: 1 },
      20_000
    ).catch(() =>
      get<Collection<{ playlist?: Playlist; system_playlist?: SystemPlaylist; type?: string }>>('/me/library/all', {
        limit: 200,
        linked_partitioning: 1
      })
    ),

  followings: (userId: number) => get<Collection<User>>(`/users/${userId}/followings`, { limit: PAGE, linked_partitioning: 1 }),
  history: (limit = PAGE) => get<Collection<HistoryItem>>('/me/play-history/tracks', { limit, linked_partitioning: 1 }, 15_000),
  stream: () => get<Collection<StreamItem>>('/stream', { limit: 40, promoted_playlist: false, linked_partitioning: 1 }),
  selections: () => get<Collection<Selection>>('/mixed-selections', { limit: 10, linked_partitioning: 1 }),

  searchTracks: (q: string, limit = 30) => get<Collection<Track>>('/search/tracks', { q, limit, linked_partitioning: 1 }),
  searchUsers: (q: string, limit = 30) => get<Collection<User>>('/search/users', { q, limit, linked_partitioning: 1 }),
  searchPlaylists: (q: string, limit = 30) =>
    get<Collection<Playlist>>('/search/playlists_without_albums', { q, limit, linked_partitioning: 1 }),
  searchAlbums: (q: string, limit = 30) => get<Collection<Playlist>>('/search/albums', { q, limit, linked_partitioning: 1 }),
  resolve: (url: string) => request<Track | User | Playlist>('GET', '/resolve', { url }),

  user: (id: number) => get<User>(`/users/${id}`),
  userTop: (id: number) => get<Collection<Track>>(`/users/${id}/toptracks`, { limit: 10, linked_partitioning: 1 }),
  userTracks: (id: number) => get<Collection<Track>>(`/users/${id}/tracks`, { limit: PAGE, linked_partitioning: 1 }),
  userAlbums: (id: number) => get<Collection<Playlist>>(`/users/${id}/albums`, { limit: 24, linked_partitioning: 1 }),
  userPlaylists: (id: number) =>
    get<Collection<Playlist>>(`/users/${id}/playlists_without_albums`, { limit: 24, linked_partitioning: 1 }),
  userReposts: (id: number) => get<Collection<StreamItem>>(`/stream/users/${id}/reposts`, { limit: PAGE, linked_partitioning: 1 }),

  playlist: (id: number) => get<Playlist>(`/playlists/${id}`, { representation: 'full' }),
  systemPlaylist: (urn: string) => get<SystemPlaylist>(`/system-playlists/${encodeURIComponent(urn)}`),
  related: (trackId: number, limit = 30) => request<Collection<Track>>('GET', `/tracks/${trackId}/related`, { limit }),

  likeTrack: (meId: number, trackId: number, on: boolean, quiet = false) =>
    request(on ? 'PUT' : 'DELETE', `/users/${meId}/track_likes/${trackId}`, undefined, undefined, quiet),
  likePlaylist: (meId: number, playlistId: number, on: boolean) =>
    request(on ? 'PUT' : 'DELETE', `/users/${meId}/playlist_likes/${playlistId}`),
  follow: (userId: number, on: boolean, quiet = false) =>
    request(on ? 'POST' : 'DELETE', `/me/followings/${userId}`, undefined, undefined, quiet),
  reportPlay: (trackId: number) =>
    request('POST', '/me/play-history', undefined, { track_urn: `soundcloud:tracks:${trackId}` }, true).catch(() => undefined)
}

/** Follows next_href until `max` tracks are collected (for "shuffle everything"). */
export async function collectTracks(first: Collection<unknown>, max = 1500): Promise<Track[]> {
  const out = tracksOf(first.collection)
  let next = first.next_href
  while (next && out.length < max) {
    const page = await api.page<unknown>(next)
    out.push(...tracksOf(page.collection))
    next = page.next_href
  }
  return out
}

export const isPlaylist = (x: unknown): x is AnyPlaylist =>
  !!x && ((x as AnyPlaylist).kind === 'playlist' || (x as AnyPlaylist).kind === 'system-playlist')
