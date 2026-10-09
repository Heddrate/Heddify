/** "Недавние запросы": what the user opened or played from search, newest first. */
import { create } from 'zustand'
import type { Playlist, Track, User } from './types'
import { useApp } from '@/store/app'
import { slim } from '@/store/player'

export type RecentItem =
  | { type: 'user'; item: User }
  | { type: 'playlist'; item: Playlist }
  | { type: 'track'; item: Track }

const MAX = 18
const pref = (meId: number): string => `recentSearches:${meId}`

export const useRecent = create<{ items: RecentItem[] }>(() => ({ items: [] }))

const keyOf = (r: RecentItem): string => `${r.type}:${r.item.id}`

function save(items: RecentItem[]): void {
  useRecent.setState({ items })
  const me = useApp.getState().me
  if (me) void window.sc.prefs.set({ [pref(me.id)]: items })
}

const slimUser = (u: User): User => ({
  id: u.id,
  kind: 'user',
  username: u.username,
  avatar_url: u.avatar_url,
  permalink_url: u.permalink_url
})

const slimPlaylist = (p: Playlist): Playlist => ({
  id: p.id,
  kind: 'playlist',
  title: p.title,
  user: p.user && slimUser(p.user),
  artwork_url: p.artwork_url ?? p.tracks?.find((t) => t.artwork_url)?.artwork_url ?? null,
  track_count: p.track_count,
  is_album: p.is_album,
  set_type: p.set_type,
  permalink_url: p.permalink_url,
  release_date: p.release_date,
  published_at: p.published_at,
  created_at: p.created_at
})

export function addRecent(entry: RecentItem): void {
  const clean: RecentItem =
    entry.type === 'user'
      ? { type: 'user', item: slimUser(entry.item) }
      : entry.type === 'playlist'
        ? { type: 'playlist', item: slimPlaylist(entry.item) }
        : { type: 'track', item: slim(entry.item) }
  const key = keyOf(clean)
  save([clean, ...useRecent.getState().items.filter((r) => keyOf(r) !== key)].slice(0, MAX))
}

export function removeRecent(entry: RecentItem): void {
  const key = keyOf(entry)
  save(useRecent.getState().items.filter((r) => keyOf(r) !== key))
}

export const clearRecent = (): void => save([])

useApp.subscribe((s, prev) => {
  if (s.auth === 'in' && prev.auth !== 'in' && s.me) {
    const key = pref(s.me.id)
    void window.sc.prefs.get().then((prefs) => {
      const items = prefs[key]
      useRecent.setState({ items: Array.isArray(items) ? (items as RecentItem[]) : [] })
    })
  }
  if (s.auth !== 'in' && prev.auth === 'in') useRecent.setState({ items: [] })
})
