/**
 * "Мне нравится" from every service as one list, newest like first: SoundCloud likes
 * (paged, with likes still waiting to be delivered on top), Yandex likes and Audius likes.
 */
import { useMemo, useState } from 'react'
import { api, collectTracks } from './api'
import { useAsync, usePaged } from './hooks'
import type { LikeItem, Track } from './types'
import { fetchTracks, useYa } from './yandexApi'
import { useAudius } from './audius'
import { useLocal } from './local'
import { useApp } from '@/store/app'
import { tx } from './i18n'

interface Row {
  track: Track
  at: number
  /** Shown instead of the date (a like that isn't delivered yet). */
  note?: string
}

const YA_PAGE = 100

/** Times in newest-first order; a missing one takes its newer neighbour's, so order holds. */
function timed(tracks: Track[], at: (t: Track) => number | undefined): Row[] {
  let prev = Date.now()
  return tracks.map((track) => {
    const t = at(track)
    prev = t && t <= prev ? t : prev
    return { track, at: prev }
  })
}

const byTime = (a: Row, b: Row): number => b.at - a.at

function uniqRows(rows: Row[]): Row[] {
  const seen = new Set<number>()
  return rows.filter((r) => !seen.has(r.track.id) && seen.add(r.track.id))
}

export interface AllLikes {
  tracks: Track[]
  /** Date labels for the "Добавлено" column. */
  dates: (string | undefined)[]
  total: number
  loading: boolean
  hasMore: boolean
  error: string | null
  loadMore: () => void
  /** Every like (for shuffle / download), not only the loaded part. */
  loadAll: () => Promise<Track[]>
  reload: () => void
}

export function useAllLikes(): AllLikes {
  const me = useApp((s) => s.me)
  const scCount = useApp((s) => s.likes.size)
  const pending = useApp((s) => s.pending)
  const yaIn = useYa((s) => s.status === 'in')
  const yaOrder = useYa((s) => s.likeOrder)
  const yaAt = useYa((s) => s.likeAt)
  const au = useAudius((s) => s.likes)
  const files = useLocal((s) => s.likes)
  const [yaCount, setYaCount] = useState(YA_PAGE)

  const sc = usePaged<LikeItem>(me ? `likes-${me.id}` : null, () => api.likes(me!.id))
  const yaIds = useMemo(() => (yaIn ? yaOrder.slice(0, yaCount) : []), [yaIn, yaOrder, yaCount])
  const ya = useAsync(() => (yaIds.length ? fetchTracks(yaIds) : Promise.resolve([] as Track[])), [yaIds.join(',')])

  const scRows = useMemo<Row[]>(() => {
    const ops = Object.values(pending).filter((op) => op.kind === 'like')
    const removed = new Set(ops.filter((op) => !op.on).map((op) => op.id))
    const remote = sc.items
      .filter((i) => i.track && !removed.has(i.track.id))
      .map((i) => ({ track: i.track!, at: Date.parse(i.created_at) || 0 }))
    const known = new Set(remote.map((r) => r.track.id))
    const local = ops
      .filter((op) => op.on && op.track && !known.has(op.id))
      .map((op) => ({ track: op.track!, at: op.at, note: tx('ждёт отправки') }))
    return [...local, ...remote]
  }, [sc.items, pending])
  const yaRows = useMemo(() => timed(ya.data ?? [], (t) => (t.ya ? yaAt[t.ya.trackId] : undefined)), [ya.data, yaAt])
  // likes kept in the app (Audius, own files) carry their own time
  const auRows = useMemo(
    () => [...timed(au, (t) => (t.liked_at ? Date.parse(t.liked_at) : undefined)), ...timed(files, (t) => (t.liked_at ? Date.parse(t.liked_at) : undefined))],
    [au, files]
  )

  const scMore = !!me && !!sc.next
  const yaMore = yaIn && yaOrder.length > yaIds.length

  const rows = useMemo(() => {
    // a service with more likes to load hides anything older than its oldest loaded like,
    // so later pages never land above what's already on screen
    const oldest = (r: Row[]): number => (r.length ? r[r.length - 1].at : Infinity)
    const cutoff = Math.max(scMore ? oldest(scRows) : -Infinity, yaMore ? oldest(yaRows) : -Infinity)
    return uniqRows([...scRows, ...yaRows, ...auRows].filter((r) => r.at >= cutoff).sort(byTime))
  }, [scRows, yaRows, auRows, scMore, yaMore])

  const tracks = useMemo(() => rows.map((r) => r.track), [rows])
  const dates = useMemo(() => rows.map((r) => r.note ?? (r.at ? new Date(r.at).toISOString() : undefined)), [rows])

  const loadMore = (): void => {
    if (scMore && !sc.loading) sc.loadMore()
    if (yaMore && !ya.loading) setYaCount((c) => c + YA_PAGE)
  }

  const loadAll = async (): Promise<Track[]> => {
    const [scAll, yaAll] = await Promise.all([
      me && sc.next ? collectTracks(await api.likes(me.id), 3000) : Promise.resolve(scRows.map((r) => r.track)),
      yaIn ? fetchTracks(yaOrder) : Promise.resolve([] as Track[])
    ])
    const scTimes = new Map(scRows.map((r) => [r.track.id, r.at]))
    const all = [
      ...timed(scAll, (t) => scTimes.get(t.id)),
      ...timed(yaAll, (t) => (t.ya ? yaAt[t.ya.trackId] : undefined)),
      ...auRows
    ]
    return uniqRows(all.sort(byTime)).map((r) => r.track)
  }

  return {
    tracks,
    dates,
    total: scCount + yaOrder.length + au.length + files.length,
    loading: sc.loading || ya.loading,
    hasMore: scMore || yaMore,
    error: !tracks.length ? (sc.error ?? ya.error) : null,
    loadMore,
    loadAll,
    reload: () => {
      sc.reload()
      ya.reload()
    }
  }
}
