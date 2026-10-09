/**
 * Offline listening: whole playlists / likes downloaded on purpose ("Скачать"), kept on
 * disk outside the regular cache limit, and listed on the "Скачанное" page. Downloads
 * run in main (src/main/cache.ts); Yandex tracks play through Yandex's own page and
 * can't be downloaded.
 */
import { create } from 'zustand'
import type { DownloadProgress } from '../../../shared/ipc'
import type { Track } from './types'
import { tx } from './i18n'
import { whenBridge } from './bridge'
import { streamRequest } from '@/player/engine'
import { askConfirm, toast } from '@/store/ui'

interface OfflineState {
  /** Cache keys of downloaded (pinned) tracks. */
  pinned: Set<string>
  progress: DownloadProgress | null
}

export const useOffline = create<OfflineState>(() => ({ pinned: new Set(), progress: null }))

export const offlineKey = (t: Track): string => (t.au ? `au-${t.au.id}` : `sc-${t.id}`)
const downloadable = (t: Track): boolean => t.origin !== 'yandex' && t.policy !== 'BLOCK'

export async function refreshOffline(): Promise<void> {
  const list = await window.sc.cache.list()
  useOffline.setState({ pinned: new Set(list.filter((c) => c.pinned).map((c) => c.key)) })
}

whenBridge(() => {
  void refreshOffline()
  window.sc.cache.onProgress((p) => {
    useOffline.setState({ progress: p.done >= p.total ? null : p })
    if (p.done >= p.total) {
      void refreshOffline()
      toast(
        p.failed
          ? tx('Скачано {0} из {1}', p.total - p.failed, p.total)
          : tx('Скачано')
      )
    }
  })
})

export async function downloadTracks(tracks: Track[]): Promise<void> {
  const list = tracks.filter(downloadable)
  const pinned = useOffline.getState().pinned
  const todo = list.filter((t) => !pinned.has(offlineKey(t)))
  if (!list.length) {
    toast(tx('Треки Яндекс Музыки скачать нельзя'))
    return
  }
  if (!todo.length) {
    toast(tx('Уже скачано'))
    return
  }
  useOffline.setState({ progress: { done: 0, total: todo.length, failed: 0 } })
  toast(
    tracks.some((t) => t.origin === 'yandex')
      ? tx('Скачиваю {0} треков, кроме Яндекс Музыки', todo.length)
      : tx('Скачиваю {0} треков', todo.length)
  )
  await window.sc.cache.download(todo.map(streamRequest))
}

/** Returns true when the downloads were removed (false: cancelled / nothing to do). */
export async function removeDownloads(tracks: Track[], ask = true): Promise<boolean> {
  const keys = tracks.filter(downloadable).map(offlineKey)
  if (!keys.length) return false
  if (ask && !(await askConfirm(tx('Удалить из скачанного?'), tx('Треки останутся в плеере, но без интернета играть перестанут.'), tx('Удалить'), true)))
    return false
  await window.sc.cache.unpin(keys)
  await refreshOffline()
  return true
}

/** 'all' when every downloadable track is saved, 'some', or 'none'. */
export function useDownloadState(tracks: Track[]): 'all' | 'some' | 'none' {
  return useOffline((s) => {
    const list = tracks.filter(downloadable)
    if (!list.length) return 'none'
    const n = list.filter((t) => s.pinned.has(offlineKey(t))).length
    return n === 0 ? 'none' : n === list.length ? 'all' : 'some'
  })
}
