import { create } from 'zustand'
import { api, ApiError, invalidate, isPlaylist, setAuthLostHandler, tracksOf } from '@/lib/api'
import type { AnyPlaylist, Playlist, Route, Track, User } from '@/lib/types'
import { toast } from './ui'
import { player, restoreSession, slim } from './player'
import { tx } from '@/lib/i18n'
import { clearListCache } from '@/lib/listCache'

/** 'guest': using the app without SoundCloud (Yandex / Audius only). */
type AuthState = 'checking' | 'out' | 'in' | 'offline' | 'guest'

interface AppState {
  auth: AuthState
  bootError: string | null
  me: User | null
  route: Route
  backStack: Route[]
  fwdStack: Route[]
  likes: Set<number>
  follows: Set<number>
  followsKnown: boolean
  library: AnyPlaylist[]
  libraryLoaded: boolean
  likedPlaylists: Set<number>
  /** Right-hand panel: the queue or the now-playing view. */
  panel: 'queue' | 'now' | 'lyrics' | null
  /** The Yandex Music page is created on first use and then kept alive. */
  yandexMounted: boolean
  /** Likes/follows SoundCloud refused for now (anti-bot); applied locally, re-sent later. */
  pending: Record<string, PendingOp>
}

export interface PendingOp {
  kind: 'like' | 'follow'
  id: number
  on: boolean
  at: number
  track?: Track
  user?: Pick<User, 'id' | 'kind' | 'username' | 'avatar_url' | 'permalink_url'>
}

const initial = (): Omit<AppState, 'auth'> => ({
  pending: {},
  bootError: null,
  me: null,
  route: { name: 'home' },
  backStack: [],
  fwdStack: [],
  likes: new Set(),
  follows: new Set(),
  followsKnown: false,
  library: [],
  libraryLoaded: false,
  likedPlaylists: new Set(),
  panel: null,
  yandexMounted: false
})

export const useApp = create<AppState>(() => ({ auth: 'checking', ...initial() }))

const set = useApp.setState
const get = useApp.getState

/* ---------------- navigation ---------------- */

const sameRoute = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b)

export function navigate(route: Route, replace = false): void {
  const s = get()
  if (sameRoute(s.route, route)) return
  if (replace) set({ route })
  else set({ route, backStack: [...s.backStack.slice(-60), s.route], fwdStack: [] })
}

export function goBack(): void {
  const s = get()
  const prev = s.backStack[s.backStack.length - 1]
  if (!prev) return
  set({ route: prev, backStack: s.backStack.slice(0, -1), fwdStack: [s.route, ...s.fwdStack] })
}

export function goForward(): void {
  const s = get()
  const [next, ...rest] = s.fwdStack
  if (!next) return
  set({ route: next, backStack: [...s.backStack, s.route], fwdStack: rest })
}

export const toggleQueue = (): void => set({ panel: get().panel === 'queue' ? null : 'queue' })
export const toggleNowPlaying = (): void => set({ panel: get().panel === 'now' ? null : 'now' })
export const toggleLyrics = (): void => set({ panel: get().panel === 'lyrics' ? null : 'lyrics' })
export const closePanel = (): void => set({ panel: null })

/* ---------------- session ---------------- */

export async function boot(): Promise<void> {
  set({ auth: 'checking', bootError: null })
  const [status, prefs] = await Promise.all([window.sc.auth.status(), window.sc.prefs.get()])
  if (!status.loggedIn) {
    if (prefs.guest === true) enterGuest()
    else set({ auth: 'out' })
    return
  }
  await enter()
}

function enterGuest(): void {
  set({ ...initial(), auth: 'guest' })
  void restoreSession()
}

/** Use the app without SoundCloud: Yandex Music and Audius only. Remembered across starts. */
export function continueAsGuest(): void {
  void window.sc.prefs.set({ guest: true })
  enterGuest()
}

/** No connection to SoundCloud: open the app anyway on the downloaded tracks (not remembered). */
export function listenOffline(): void {
  enterGuest()
  set({ route: { name: 'offline' } })
}

/** Sign in to SoundCloud from inside the app (guest mode, Settings). */
export async function signInSoundcloud(): Promise<void> {
  const err = await login()
  if (err) toast(err)
}

async function enter(): Promise<string | null> {
  try {
    const me = await api.me()
    set({ ...initial(), me, auth: 'in' })
    await loadPending(me.id)
    void loadLibrary()
    void loadLikes()
    void loadFollows()
    void restoreSession()
    return null
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0
    if (status === 401) {
      set({ auth: 'out' })
      return tx("Не удалось подтвердить вход, попробуйте ещё раз")
    }
    set({ auth: 'offline', bootError: e instanceof Error ? e.message : tx("Ошибка сети") })
    return null
  }
}

/** Returns an error message, or null on success / user cancel. */
export async function login(): Promise<string | null> {
  const r = await window.sc.auth.login()
  if (!r.ok) return r.error === 'cancelled' ? null : (r.error ?? tx("Не удалось войти"))
  return enter()
}

export async function loginWithToken(token: string): Promise<string | null> {
  const r = await window.sc.auth.setToken(token)
  if (!r.ok) return r.error ?? tx("Не удалось войти")
  return enter()
}

export const cancelLogin = (): Promise<void> => window.sc.auth.cancelLogin()

export async function logout(): Promise<void> {
  stopSync()
  player.reset()
  await window.sc.auth.logout()
  invalidate('')
  clearListCache()
  set({ ...initial(), auth: 'out' })
}

let verifying = false
setAuthLostHandler(async () => {
  if (verifying || get().auth !== 'in') return
  verifying = true
  try {
    await api.me()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // Keep the web session: signing in again is usually one click.
      stopSync()
      player.reset()
      invalidate('')
      set({ ...initial(), auth: 'out' })
      toast(tx("Сессия истекла, войдите снова"))
    }
  } finally {
    verifying = false
  }
})

/* ---------------- library ---------------- */

export async function loadLibrary(): Promise<void> {
  const me = get().me
  if (!me) return
  try {
    const r = await api.libraryPlaylists(me.id)
    const items: AnyPlaylist[] = []
    const liked = new Set<number>()
    for (const raw of r.collection) {
      const item = raw as { playlist?: Playlist; system_playlist?: AnyPlaylist; type?: string }
      const p = item.playlist ?? item.system_playlist ?? (raw as unknown)
      if (!isPlaylist(p)) continue
      items.push(p)
      if (p.kind === 'playlist' && (item.type?.includes('like') || p.user?.id !== me.id)) liked.add(p.id)
    }
    set({ library: items, likedPlaylists: liked, libraryLoaded: true })
  } catch {
    set({ libraryLoaded: true })
  }
}

async function loadLikes(): Promise<void> {
  const me = get().me
  if (!me) return
  try {
    set({ likes: withPending(await api.likedIds(), 'like') })
  } catch {
    // Fallback: walk the likes list (first ~1000).
    try {
      let page = await api.likes(me.id)
      const ids = tracksOf(page.collection).map((t) => t.id)
      while (page.next_href && ids.length < 1000) {
        page = await api.page(page.next_href)
        ids.push(...tracksOf(page.collection).map((t) => t.id))
      }
      set({ likes: withPending(ids, 'like') })
    } catch {
      set({ likes: withPending([], 'like') })
    }
  }
}

async function loadFollows(): Promise<void> {
  try {
    set({ follows: withPending(await api.followingIds(), 'follow'), followsKnown: true })
  } catch {
    // /me/followings/ids is 404 for some accounts: walk the followings list instead
    const me = get().me
    if (!me) return
    try {
      let page = await api.followings(me.id)
      const ids = page.collection.map((u) => u.id)
      while (page.next_href && ids.length < 5000) {
        page = await api.page(page.next_href)
        ids.push(...(page.collection as User[]).map((u) => u.id))
      }
      set({ follows: withPending(ids, 'follow'), followsKnown: true })
    } catch {
      set({ followsKnown: false })
    }
  }
}

/* ---------------- likes & follows (with deferred sending) ---------------- */

const opKey = (kind: PendingOp['kind'], id: number): string => `${kind}:${id}`
const pendingPref = (meId: number): string => `pendingOps:${meId}`

async function loadPending(meId: number): Promise<void> {
  const prefs = await window.sc.prefs.get()
  const raw = prefs[pendingPref(meId)]
  const pending = raw && typeof raw === 'object' ? (raw as Record<string, PendingOp>) : {}
  set({ pending })
  if (Object.keys(pending).length) startSync(15_000)
}

function setPending(key: string, op: PendingOp | null): void {
  const me = get().me
  if (!me) return
  const pending = { ...get().pending }
  if (op) pending[key] = op
  else delete pending[key]
  set({ pending })
  void window.sc.prefs.set({ [pendingPref(me.id)]: pending })
}

/** SoundCloud's state with the not-yet-delivered local changes applied on top. */
function withPending(ids: Iterable<number>, kind: PendingOp['kind']): Set<number> {
  const result = new Set(ids)
  for (const op of Object.values(get().pending)) {
    if (op.kind !== kind) continue
    if (op.on) result.add(op.id)
    else result.delete(op.id)
  }
  return result
}

function flip(field: 'likes' | 'follows', id: number, on: boolean): void {
  const next = new Set(get()[field])
  if (on) next.add(id)
  else next.delete(id)
  set(field === 'likes' ? { likes: next } : { follows: next })
}

interface ToggleSpec {
  kind: PendingOp['kind']
  id: number
  on: boolean
  send: (quiet: boolean) => Promise<unknown>
  extra: Pick<PendingOp, 'track' | 'user'>
  done: string
  queued: string
}

/**
 * Applies a like/follow locally right away. If SoundCloud's anti-bot refuses it (common
 * behind VPNs), it stays applied in the app and is re-sent later instead of being lost.
 */
async function toggleRemote(spec: ToggleSpec): Promise<void> {
  const field = spec.kind === 'like' ? 'likes' : 'follows'
  const key = opKey(spec.kind, spec.id)
  flip(field, spec.id, spec.on)

  // Undoing a change SoundCloud never received: nothing to send.
  if (get().pending[key]) {
    setPending(key, null)
    toast(spec.done)
    return
  }

  try {
    await spec.send(false)
    invalidate(spec.kind === 'like' ? '/track_likes' : '/followings')
    toast(spec.done)
    // SoundCloud accepts writes again: a good moment to deliver older ones.
    if (Object.keys(get().pending).length) void syncPending()
  } catch (e) {
    if (e instanceof ApiError && e.blocked) {
      setPending(key, { kind: spec.kind, id: spec.id, on: spec.on, at: Date.now(), ...spec.extra })
      toast(spec.queued)
      startSync()
      return
    }
    flip(field, spec.id, !spec.on)
    toast(tx("Не получилось: {0}", failText(e)))
  }
}

const queuedNote = (): string =>
  tx('Сохранено, отправлю в SoundCloud позже')

export function toggleLike(track: Track): Promise<void> {
  const me = get().me
  if (!me) return Promise.resolve()
  const on = !get().likes.has(track.id)
  return toggleRemote({
    kind: 'like',
    id: track.id,
    on,
    send: (quiet) => api.likeTrack(me.id, track.id, on, quiet),
    extra: { track: slim(track) },
    done: on ? tx("Добавлено в «Мне нравится»") : tx("Удалено из «Мне нравится»"),
    queued: `${on ? tx("Лайк") : tx("Снятие лайка")}: ${queuedNote()}`
  })
}

export function toggleFollow(user: User): Promise<void> {
  const on = !get().follows.has(user.id)
  return toggleRemote({
    kind: 'follow',
    id: user.id,
    on,
    send: (quiet) => api.follow(user.id, on, quiet),
    extra: {
      user: { id: user.id, kind: 'user', username: user.username, avatar_url: user.avatar_url, permalink_url: user.permalink_url }
    },
    done: on ? tx("Вы подписались на {0}", user.username) : tx("Вы отписались от {0}", user.username),
    queued: `${on ? tx("Подписка") : tx("Отписка")}: ${queuedNote()}`
  })
}

const SYNC_EVERY = 30 * 60_000
let syncTimer: ReturnType<typeof setInterval> | null = null
let syncing = false

function startSync(firstIn?: number): void {
  if (firstIn !== undefined) setTimeout(() => void syncPending(), firstIn)
  if (!syncTimer) syncTimer = setInterval(() => void syncPending(), SYNC_EVERY)
}

function stopSync(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
}

/** Re-sends queued likes/follows, oldest first; stops at the first refusal and waits. */
export async function syncPending(): Promise<void> {
  const me = get().me
  if (!me || syncing) return
  const ops = Object.entries(get().pending).sort((a, b) => a[1].at - b[1].at)
  if (!ops.length) return stopSync()

  syncing = true
  let sent = 0
  try {
    for (const [key, op] of ops) {
      try {
        if (op.kind === 'like') await api.likeTrack(me.id, op.id, op.on, true)
        else await api.follow(op.id, op.on, true)
        setPending(key, null)
        sent++
      } catch (e) {
        const retryLater = e instanceof ApiError && (e.blocked || e.status === 0 || e.status === 429 || e.status >= 500)
        if (retryLater) break
        setPending(key, null) // refused for good (e.g. the track was deleted)
      }
    }
  } finally {
    syncing = false
  }
  if (sent) {
    invalidate('/track_likes')
    invalidate('/followings')
    toast(tx("Отправлено в SoundCloud: {0}", sent))
  }
  if (!Object.keys(get().pending).length) stopSync()
}

export async function togglePlaylistLike(p: Playlist): Promise<void> {
  const me = get().me
  if (!me) return
  const on = !get().likedPlaylists.has(p.id)
  const prev = { likedPlaylists: get().likedPlaylists, library: get().library }
  const liked = new Set(prev.likedPlaylists)
  if (on) liked.add(p.id)
  else liked.delete(p.id)
  const library = on
    ? [p, ...prev.library.filter((x) => !(x.kind === 'playlist' && x.id === p.id))]
    : prev.library.filter((x) => !(x.kind === 'playlist' && x.id === p.id))
  set({ likedPlaylists: liked, library })
  try {
    await api.likePlaylist(me.id, p.id, on)
    invalidate('/playlists_liked_and_owned')
    toast(on ? tx("Добавлено в медиатеку") : tx("Удалено из медиатеки"))
  } catch (e) {
    set(prev)
    toast(tx("Не получилось: {0}", failText(e)))
  }
}

const failText = (e: unknown): string =>
  e instanceof ApiError ? `${e.message}${e.status ? ` (${e.status})` : ''}` : e instanceof Error ? e.message : tx("ошибка")

export function openUrl(url?: string): void {
  if (url) void window.sc.openExternal(url)
}

export function copyLink(url?: string): void {
  if (!url) return
  void window.sc.copyText(url)
  toast(tx("Ссылка скопирована"))
}
