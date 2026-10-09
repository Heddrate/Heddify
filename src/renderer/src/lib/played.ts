/**
 * Listening history kept by the app itself: every track that starts playing, from any
 * service. SoundCloud's own history (plays on other devices) is mixed in by useHistory.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import type { Track } from './types'
import { api, tracksOf } from './api'
import { useAsync } from './hooks'
import { slim, usePlayer } from '@/store/player'
import { useApp } from '@/store/app'

interface Played {
  track: Track
  at: number
}

const KEY = 'played'
const MAX = 400

function read(): Played[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Played[]
    return Array.isArray(list) ? list.filter((p) => p?.track?.id && typeof p.at === 'number') : []
  } catch {
    return []
  }
}

export const usePlayed = create<{ items: Played[] }>(() => ({ items: read() }))

let last = 0

usePlayer.subscribe((s) => {
  const t = s.current
  if (!t || !s.playing || t.id === last) return
  last = t.id
  const items = [{ track: slim(t), at: Date.now() }, ...usePlayed.getState().items.filter((p) => p.track.id !== t.id)].slice(0, MAX)
  usePlayed.setState({ items })
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* storage full: history just isn't kept */
  }
})

export function clearPlayed(): void {
  usePlayed.setState({ items: [] })
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Everything listened to, newest first: the app's own history plus SoundCloud's. */
export function useHistory(): { tracks: Track[]; dates: number[]; loading: boolean } {
  const own = usePlayed((s) => s.items)
  const scIn = useApp((s) => s.auth === 'in')
  const meId = useApp((s) => s.me?.id)
  const sc = useAsync(
    () =>
      scIn
        ? api.history(100).then((r) =>
            r.collection.flatMap((i) =>
              tracksOf([i]).map((track) => ({
                track,
                at: typeof i.played_at === 'number' ? i.played_at : Date.parse(String(i.played_at ?? '')) || 0
              }))
            )
          )
        : Promise.resolve([] as Played[]),
    [scIn],
    scIn ? `p:history100:${meId}` : null
  )
  return useMemo(() => {
    const seen = new Set<number>()
    const all = [...own, ...(sc.data ?? [])].sort((a, b) => b.at - a.at).filter((p) => !seen.has(p.track.id) && seen.add(p.track.id))
    return { tracks: all.map((p) => p.track), dates: all.map((p) => p.at), loading: sc.loading && !own.length && !sc.data }
  }, [own, sc.data, sc.loading])
}
