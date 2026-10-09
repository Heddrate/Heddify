/**
 * Yandex Music library inside our UI: account, likes, playlists.
 *
 * Requests are made from inside the embedded music.yandex.ru page with the same
 * headers the site itself sends to its API (captured by main) and the session's own
 * cookies — exactly what the website does. No keys of our own.
 */
import { create } from 'zustand'
import { tx } from './i18n'
import type { Track } from './types'
import { reloadView, runInPage, yandexTrack } from './yandex'
import { useApp } from '@/store/app'
import { toast } from '@/store/ui'

const API = 'https://api.music.yandex.ru'

export interface YaPlaylist {
  uid: number
  kind: number
  title: string
  trackCount: number
  cover: string | null
  owner: string
}

interface YaState {
  status: 'unknown' | 'out' | 'in'
  uid: number | null
  name: string | null
  likes: Set<number>
  likeOrder: number[]
  /** When each like was made (ms), to sort likes from all services together. */
  likeAt: Record<number, number>
  playlists: YaPlaylist[]
}

/* The library is remembered between launches, so Yandex sections show up instantly while
   the hidden Yandex page is still loading (it then refreshes everything). */
const SAVED_KEY = 'ya-state'
/** Set once we know whether this user has Yandex at all; until then the page is checked. */
const CHECKED_KEY = 'ya-checked'

interface Saved {
  uid: number
  name: string | null
  likeOrder: number[]
  likeAt?: Record<number, number>
  playlists: YaPlaylist[]
}

function readSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as Saved | null
    return s && typeof s.uid === 'number' ? s : null
  } catch {
    return null
  }
}

const saved = readSaved()

export const useYa = create<YaState>(() =>
  saved
    ? { status: 'in', uid: saved.uid, name: saved.name, likes: new Set(saved.likeOrder), likeOrder: saved.likeOrder, likeAt: saved.likeAt ?? {}, playlists: saved.playlists }
    : {
        status: localStorage.getItem(CHECKED_KEY) ? 'out' : 'unknown',
        uid: null,
        name: null,
        likes: new Set(),
        likeOrder: [],
        likeAt: {},
        playlists: []
      }
)

useYa.subscribe((s, prev) => {
  if (s.status === prev.status && s.likeOrder === prev.likeOrder && s.likeAt === prev.likeAt && s.playlists === prev.playlists && s.name === prev.name) return
  try {
    if (s.status === 'in' && s.uid) {
      const data: Saved = { uid: s.uid, name: s.name, likeOrder: s.likeOrder, likeAt: s.likeAt, playlists: s.playlists }
      localStorage.setItem(SAVED_KEY, JSON.stringify(data))
    } else if (s.status === 'out') {
      localStorage.removeItem(SAVED_KEY)
    }
    if (s.status !== 'unknown') localStorage.setItem(CHECKED_KEY, '1')
  } catch {
    /* storage full or unavailable: just no instant start */
  }
})

/* Track metadata cache: lists of likes and playlists open without asking the page again. */
const TRACKS_KEY = 'ya-tracks'
const TRACKS_MAX = 5000
const trackCache = new Map<number, Track>()
try {
  for (const t of JSON.parse(localStorage.getItem(TRACKS_KEY) ?? '[]') as Track[]) if (t?.ya) trackCache.set(t.ya.trackId, t)
} catch {
  /* start empty */
}
let tracksTimer: number | undefined

function rememberTracks(list: Track[]): void {
  for (const t of list) {
    if (!t.ya) continue
    trackCache.delete(t.ya.trackId) // re-insert: newest last, oldest dropped first
    trackCache.set(t.ya.trackId, t)
  }
  while (trackCache.size > TRACKS_MAX) trackCache.delete(trackCache.keys().next().value as number)
  window.clearTimeout(tracksTimer)
  tracksTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(TRACKS_KEY, JSON.stringify([...trackCache.values()]))
    } catch {
      /* over quota: keep it in memory only */
    }
  }, 2000)
}

let headers: Record<string, string> = {}

export class YaError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

async function yaApi<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
  const h: Record<string, string> = { ...headers, Accept: 'application/json' }
  let body: string | undefined
  if (form) {
    h['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(form).toString()
  }
  const code = `(async () => {
    try {
      const r = await fetch(${JSON.stringify(API + path)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(h)},
        credentials: 'include',
        body: ${body === undefined ? 'undefined' : JSON.stringify(body)}
      })
      return { status: r.status, text: await r.text() }
    } catch (e) { return { status: 0, text: String(e) } }
  })()`
  const r = await runInPage<{ status: number; text: string }>(code)
  if (r.status === 401 || r.status === 403) throw new YaError(tx('Войдите в Яндекс Музыку'), r.status)
  if (r.status < 200 || r.status >= 300) throw new YaError(tx('Яндекс Музыка: {0}', r.status || tx('ошибка')), r.status)
  const json = JSON.parse(r.text) as { result?: T }
  // the web API sometimes answers without the { result } wrapper
  return (json.result !== undefined ? json.result : json) as T
}

/* ---------- mapping ---------- */

interface ApiTrack {
  id: number | string
  title?: string
  version?: string
  durationMs?: number
  artists?: { id: number; name: string }[]
  albums?: { id: number }[]
  coverUri?: string
  available?: boolean
}

const cover = (uri?: string | null): string | null => (uri ? 'https://' + uri.replace('%%', '400x400') : null)

function toTrack(t: ApiTrack): Track | null {
  if (!t.title) return null
  return yandexTrack({
    trackId: Number(t.id),
    albumId: t.albums?.[0]?.id,
    title: t.version ? `${t.title} (${t.version})` : t.title,
    artists: (t.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
    cover: cover(t.coverUri),
    durationSec: (t.durationMs ?? 0) / 1000
  })
}

/** Pulls a track array out of whatever shape an endpoint returned. */
function asTracks(r: unknown): ApiTrack[] | null {
  if (Array.isArray(r)) return r as ApiTrack[]
  const o = r as { tracks?: unknown; result?: unknown } | null
  if (Array.isArray(o?.tracks)) return o!.tracks as ApiTrack[]
  if (Array.isArray(o?.result)) return o!.result as ApiTrack[]
  return null
}

/** One chunk of tracks; tries the request shapes the API is known to accept. */
async function fetchChunk(ids: number[]): Promise<ApiTrack[]> {
  const list = ids.join(',')
  const attempts: [string, () => Promise<unknown>][] = [
    ['POST /tracks', () => yaApi('POST', '/tracks', { 'track-ids': list, 'with-positions': 'false' })],
    ['GET /tracks?trackIds', () => yaApi('GET', `/tracks?trackIds=${list}`)],
    ['GET /tracks?track-ids', () => yaApi('GET', `/tracks?track-ids=${list}`)]
  ]
  for (const [name, attempt] of attempts) {
    try {
      const r = await attempt()
      const arr = asTracks(r)
      if (arr) return arr
      console.error(`yandex ${name}: unexpected shape ${JSON.stringify(r).slice(0, 300)}`)
    } catch (e) {
      console.error(`yandex ${name}: ${e instanceof Error ? e.message : e}`)
    }
  }
  throw new YaError(tx('Не удалось загрузить треки'), 0)
}

/** Full track objects for ids, in the same order; only ids not cached yet are fetched. */
export async function fetchTracks(ids: number[]): Promise<Track[]> {
  const missing = ids.filter((id) => !trackCache.has(id))
  for (let i = 0; i < missing.length; i += 100) {
    const res = await fetchChunk(missing.slice(i, i + 100))
    rememberTracks(res.map(toTrack).filter((t): t is Track => !!t))
  }
  return ids.map((id) => trackCache.get(id)).filter((t): t is Track => !!t)
}
/* ---------- account & library ---------- */

export async function loadYandex(): Promise<void> {
  try {
    headers = await window.sc.yandex.headers()
    const st = await yaApi<{ account?: { uid?: number; displayName?: string; login?: string } }>('GET', '/account/status')
    const uid = st.account?.uid
    if (!uid) {
      useYa.setState({ status: 'out', uid: null })
      return
    }
    useYa.setState({ status: 'in', uid, name: st.account?.displayName ?? st.account?.login ?? null })
    void loadLikes()
    void loadPlaylists()
  } catch (e) {
    // signed out → 'out'; anything else (page still loading, network) keeps a known library
    const signedOut = e instanceof YaError && (e.status === 401 || e.status === 403)
    // never connected and the page can't be reached: offer sign-in instead of spinning forever
    useYa.setState({ status: signedOut ? 'out' : useYa.getState().uid ? 'in' : 'out' })
  }
}

export async function loadLikes(): Promise<void> {
  const uid = useYa.getState().uid
  if (!uid) return
  try {
    const res = await yaApi<{ library?: { tracks?: { id: string | number; timestamp?: string }[] } }>('GET', `/users/${uid}/likes/tracks`)
    const list = res.library?.tracks ?? []
    const order = list.map((t) => Number(t.id))
    const likeAt: Record<number, number> = {}
    for (const t of list) {
      const at = t.timestamp ? Date.parse(t.timestamp) : NaN
      if (at) likeAt[Number(t.id)] = at
    }
    useYa.setState({ likes: new Set(order), likeOrder: order, likeAt })
  } catch {
    /* hearts stay as they were */
  }
}

export async function loadPlaylists(): Promise<void> {
  const uid = useYa.getState().uid
  if (!uid) return
  try {
    const list = await yaApi<
      {
        uid?: number
        kind: number
        title: string
        trackCount?: number
        cover?: { uri?: string; itemsUri?: string[] }
        ogImage?: string
        owner?: { uid?: number; login?: string; name?: string }
      }[]
    >('GET', `/users/${uid}/playlists/list`)
    useYa.setState({
      playlists: list.map((p) => ({
        uid: p.owner?.uid ?? p.uid ?? uid,
        kind: p.kind,
        title: p.title,
        trackCount: p.trackCount ?? 0,
        cover: cover(p.cover?.uri ?? p.cover?.itemsUri?.[0] ?? p.ogImage),
        owner: p.owner?.name ?? p.owner?.login ?? ''
      }))
    })
  } catch {
    /* keep the old list */
  }
}

export async function fetchPlaylist(uid: number, kind: number): Promise<{ title: string; cover: string | null; tracks: Track[] }> {
  const res = await yaApi<{
    title: string
    cover?: { uri?: string; itemsUri?: string[] }
    ogImage?: string
    tracks?: { id: number | string; track?: ApiTrack }[]
  }>('GET', `/users/${uid}/playlists/${kind}?rich-tracks=true`)
  const items = res.tracks ?? []
  const full = items.map((i) => (i.track ? toTrack(i.track) : null))
  const missing = items.filter((_, i) => !full[i]).map((i) => Number(i.id))
  const fetched = missing.length ? new Map((await fetchTracks(missing)).map((t) => [t.ya!.trackId, t])) : new Map()
  const tracks = items
    .map((i, idx) => full[idx] ?? fetched.get(Number(i.id)) ?? null)
    .filter((t): t is Track => !!t)
  return { title: res.title, cover: cover(res.cover?.uri ?? res.cover?.itemsUri?.[0] ?? res.ogImage), tracks }
}

export async function toggleYaLike(track: Track): Promise<void> {
  const { uid, likes, likeOrder } = useYa.getState()
  const id = track.ya?.trackId
  if (!uid || !id) {
    toast(tx('Войдите в Яндекс Музыку'))
    return
  }
  const on = !likes.has(id)
  const apply = (value: boolean): void => {
    const next = new Set(useYa.getState().likes)
    if (value) next.add(id)
    else next.delete(id)
    useYa.setState({
      likes: next,
      likeOrder: value ? [id, ...likeOrder] : likeOrder.filter((x) => x !== id),
      likeAt: { ...useYa.getState().likeAt, [id]: Date.now() }
    })
  }
  apply(on)
  try {
    await yaApi('POST', `/users/${uid}/likes/tracks/${on ? 'add-multiple' : 'remove'}`, { 'track-ids': String(id) })
    toast(on ? tx('Добавлено в «Мне нравится»') : tx('Удалено из «Мне нравится»'))
  } catch (e) {
    apply(!on)
    toast(tx('Не получилось: {0}', e instanceof Error ? e.message : tx('ошибка')))
  }
}

/* ---------- lifecycle ---------- */

// The page sends its API headers once it loads (or after the user signs in there).
window.sc?.yandex.onHeaders((h) => {
  const hadAuth = !!headers.authorization || !!headers.Authorization
  headers = h
  const hasAuth = !!h.authorization || !!h.Authorization
  if (hasAuth && (!hadAuth || useYa.getState().status !== 'in')) void loadYandex()
})

// Bring the Yandex page up as soon as the app opens — but only for users who have Yandex
// connected (or on the very first run, to find out). Others never pay for the hidden page.
useApp.subscribe((s, prev) => {
  const entered = (s.auth === 'in' || s.auth === 'guest') && prev.auth !== s.auth
  if (!entered || (!readSaved() && localStorage.getItem(CHECKED_KEY))) return
  if (!useApp.getState().yandexMounted) useApp.setState({ yandexMounted: true })
  setTimeout(() => void loadYandex(), 2500)
})

/** Sign-in window (like SoundCloud's); on success the hidden page reloads signed in. */
export async function loginYandex(): Promise<void> {
  if (!useApp.getState().yandexMounted) useApp.setState({ yandexMounted: true })
  useYa.setState({ status: 'unknown' })
  const ok = await window.sc.yandex.login()
  if (!ok) {
    void loadYandex()
    return
  }
  await reloadView()
  // give the page a moment to start talking to its API with the new session
  setTimeout(() => void loadYandex(), 3000)
}

/* ---------- tracks for the shared "Моя волна" ---------- */

/**
 * Yandex picks for our mixed wave: Yandex's own wave stream ("rotor") first, then tracks
 * similar to the user's Yandex likes, then the likes themselves.
 */
export async function yandexWaveTracks(count: number, exclude: Set<number>): Promise<Track[]> {
  const fresh = (list: Track[]): Track[] => list.filter((t) => !exclude.has(t.id))
  try {
    const r = await yaApi<{ sequence?: { track?: ApiTrack }[] }>('GET', '/rotor/station/user:onyourwave/tracks?settings2=true')
    const list = fresh((r.sequence ?? []).map((x) => (x.track ? toTrack(x.track) : null)).filter((t): t is Track => !!t))
    if (list.length) return list.slice(0, count)
  } catch {
    /* fall through */
  }
  const likes = useYa.getState().likeOrder
  if (!likes.length) return []
  const seeds = [...likes].sort(() => Math.random() - 0.5).slice(0, 3)
  const out: Track[] = []
  for (const id of seeds) {
    try {
      const r = await yaApi<{ similarTracks?: ApiTrack[] }>('GET', `/tracks/${id}/similar`)
      out.push(...fresh((r.similarTracks ?? []).map(toTrack).filter((t): t is Track => !!t)))
    } catch {
      /* next seed */
    }
    if (out.length >= count) break
  }
  if (out.length) return out.slice(0, count)
  return fresh(await fetchTracks(seeds)).slice(0, count)
}

/* ---------- artists & albums ---------- */

export interface YaAlbum {
  id: number
  title: string
  year?: number
  cover: string | null
  artist: string
  trackCount?: number
}

interface ApiAlbum {
  id: number
  title: string
  year?: number
  coverUri?: string
  trackCount?: number
  artists?: { name: string }[]
}

const toAlbum = (a: ApiAlbum): YaAlbum => ({
  id: a.id,
  title: a.title,
  year: a.year,
  cover: cover(a.coverUri),
  artist: (a.artists ?? []).map((x) => x.name).join(', '),
  trackCount: a.trackCount
})

export async function fetchArtist(id: number): Promise<{
  name: string
  cover: string | null
  tracks: Track[]
  albums: YaAlbum[]
}> {
  const res = await yaApi<{
    artist: { name: string; cover?: { uri?: string }; ogImage?: string }
    popularTracks?: ApiTrack[]
    albums?: ApiAlbum[]
  }>('GET', `/artists/${id}/brief-info`)
  return {
    name: res.artist.name,
    cover: cover(res.artist.cover?.uri ?? res.artist.ogImage),
    tracks: (res.popularTracks ?? []).map(toTrack).filter((t): t is Track => !!t),
    albums: (res.albums ?? []).map(toAlbum)
  }
}

export async function fetchAlbum(id: number): Promise<YaAlbum & { tracks: Track[] }> {
  const res = await yaApi<ApiAlbum & { volumes?: ApiTrack[][] }>('GET', `/albums/${id}/with-tracks`)
  return {
    ...toAlbum(res),
    tracks: (res.volumes ?? []).flat().map(toTrack).filter((t): t is Track => !!t)
  }
}

export async function logoutYandex(): Promise<void> {
  await window.sc.yandex.logout()
  headers = {}
  useYa.setState({ status: 'out', uid: null, name: null, likes: new Set(), likeOrder: [], likeAt: {}, playlists: [] })
}
