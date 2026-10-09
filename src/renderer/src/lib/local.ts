/**
 * The user's own music files (main/local.ts scans the folders). They play through our
 * engine from `heddify-local://track/<key>`; likes are kept in the app (pref `localLikes`).
 */
import { create } from 'zustand'
import type { LocalTrack } from '../../../shared/ipc'
import type { Track } from './types'
import { whenBridge } from './bridge'
import { tx } from './i18n'
import { toast } from '@/store/ui'

/** File ids live above radio's (2e12+), so they never clash with other services. */
const ID_BASE = 3e12

function idOf(key: string): number {
  return ID_BASE + parseInt(key.slice(0, 12), 16)
}

export function localToTrack(l: LocalTrack): Track {
  return {
    id: idOf(l.key),
    kind: 'track',
    title: l.title,
    user: { id: 0, kind: 'user', username: l.artist || tx('Неизвестный исполнитель') },
    artwork_url: l.hasCover ? `heddify-local://cover/${l.key}` : null,
    duration: l.duration,
    full_duration: l.duration,
    origin: 'local',
    local: { key: l.key, album: l.album }
  }
}

interface State {
  loaded: boolean
  folders: string[]
  tracks: Track[]
  scanning: { done: number; total: number } | null
  likes: Track[]
  likeIds: Set<number>
}

export const useLocal = create<State>(() => ({ loaded: false, folders: [], tracks: [], scanning: null, likes: [], likeIds: new Set() }))

async function refresh(): Promise<void> {
  const [folders, list] = await Promise.all([window.sc.local.folders(), window.sc.local.tracks()])
  useLocal.setState({ loaded: true, folders, tracks: list.map(localToTrack) })
}

const LIKES_KEY = 'localLikes'

whenBridge(() => {
  void refresh().then(() => {
    // pick up files added while the app was closed
    if (useLocal.getState().folders.length) void rescan(true)
  })
  window.sc.local.onProgress((p) => useLocal.setState({ scanning: p }))
  void window.sc.prefs.get().then((p) => {
    const list = Array.isArray(p[LIKES_KEY]) ? (p[LIKES_KEY] as Track[]).filter((t) => t?.local?.key) : []
    useLocal.setState({ likes: list, likeIds: new Set(list.map((t) => t.id)) })
  })
})

export async function rescan(quiet = false): Promise<void> {
  useLocal.setState({ scanning: { done: 0, total: 0 } })
  try {
    const r = await window.sc.local.scan()
    await refresh()
    if (!quiet || r.added) toast(r.added ? tx('Добавлено файлов: {0}', r.added) : tx('Новых файлов нет'))
  } catch {
    toast(tx('Не удалось прочитать папку'))
  } finally {
    useLocal.setState({ scanning: null })
  }
}

export async function addMusicFolder(): Promise<void> {
  const dir = await window.sc.local.addFolder()
  if (!dir) return
  await refresh()
  await rescan()
}

export async function removeMusicFolder(dir: string): Promise<void> {
  await window.sc.local.removeFolder(dir)
  await rescan(true)
}

export function toggleLocalLike(track: Track): void {
  if (!track.local) return
  const { likes } = useLocal.getState()
  const on = !likes.some((t) => t.id === track.id)
  const next = on ? [{ ...track, liked_at: new Date().toISOString() }, ...likes] : likes.filter((t) => t.id !== track.id)
  useLocal.setState({ likes: next, likeIds: new Set(next.map((t) => t.id)) })
  void window.sc.prefs.set({ [LIKES_KEY]: next })
  toast(on ? tx('Добавлено в «Мне нравится»') : tx('Удалено из «Мне нравится»'))
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Files whose title, artist or album contain every word of the query. */
export function searchLocal(q: string, limit = 50): Track[] {
  const words = norm(q).split(' ').filter(Boolean)
  if (!words.length) return []
  return useLocal
    .getState()
    .tracks.filter((t) => {
      const hay = norm(`${t.title} ${t.user?.username} ${t.local?.album ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
    .slice(0, limit)
}
