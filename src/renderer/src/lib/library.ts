/**
 * The user's playlists from everywhere as one list: the app's own, SoundCloud's library
 * and Yandex playlists. Sidebar, the library page and the home shelf all show this.
 */
import { useMemo } from 'react'
import type { AnyPlaylist, Route } from './types'
import { playlistRoute, playOrToggle, playPlaylist } from './actions'
import { playlistArt } from './artwork'
import { countLabel } from './format'
import { tx } from './i18n'
import { fetchPlaylist, useYa, type YaPlaylist } from './yandexApi'
import { usePlaylists, type LocalPlaylist } from './playlists'
import { playlistKind } from '@/components/Card'
import { useApp } from '@/store/app'
import { toast } from '@/store/ui'

export type LibItem =
  | { type: 'local'; key: string; list: LocalPlaylist }
  | { type: 'sc'; key: string; p: AnyPlaylist }
  | { type: 'ya'; key: string; p: YaPlaylist }

export const isAlbumItem = (i: LibItem): boolean => i.type === 'sc' && i.p.kind === 'playlist' && (!!i.p.is_album || !!i.p.set_type)

export function useLibraryItems(): LibItem[] {
  const local = usePlaylists((s) => s.lists)
  const scIn = useApp((s) => s.auth === 'in')
  const sc = useApp((s) => s.library)
  const yaIn = useYa((s) => s.status === 'in')
  const ya = useYa((s) => s.playlists)
  return useMemo(
    () => [
      ...local.map((list): LibItem => ({ type: 'local', key: `local-${list.id}`, list })),
      ...(scIn ? sc : []).map((p): LibItem => ({ type: 'sc', key: p.kind === 'playlist' ? `sc-${p.id}` : `sc-${p.urn}`, p })),
      ...(yaIn ? ya : []).map((p): LibItem => ({ type: 'ya', key: `ya-${p.uid}-${p.kind}`, p }))
    ],
    [local, scIn, sc, yaIn, ya]
  )
}

export const yaPlaylistRoute = (p: YaPlaylist): Route => ({ name: 'ya-playlist', uid: p.uid, kind: p.kind })

export function libRoute(i: LibItem): Route {
  if (i.type === 'local') return { name: 'local', id: i.list.id }
  if (i.type === 'ya') return yaPlaylistRoute(i.p)
  return playlistRoute(i.p)
}

export function libTitle(i: LibItem): string {
  return i.type === 'local' ? i.list.title : i.p.title
}

const tracks = (n: number): string => countLabel(n, tx('трек'), tx('трека'), tx('треков'))

export function libSub(i: LibItem): string {
  if (i.type === 'local') return tx('Плейлист · {0}', tracks(i.list.tracks.length))
  if (i.type === 'ya') return tx('Плейлист · {0}', tracks(i.p.trackCount))
  return `${playlistKind(i.p)} · ${i.p.user?.username ?? ''}`.replace(/ · $/, '')
}

/** Cover URL; local playlists draw their own collage instead (null here). */
export function libArt(i: LibItem): string | null {
  if (i.type === 'local') return null
  if (i.type === 'ya') return i.p.cover
  return playlistArt(i.p, 'large')
}

export async function playYaPlaylist(p: YaPlaylist, shuffle?: boolean): Promise<void> {
  try {
    const { title, tracks } = await fetchPlaylist(p.uid, p.kind)
    if (!tracks.length) return toast(tx('В плейлисте нет треков'))
    playOrToggle(tracks, { label: title, route: yaPlaylistRoute(p) }, shuffle === undefined ? {} : { shuffle })
  } catch {
    toast(tx('Не удалось загрузить плейлист'))
  }
}

export function playLibItem(i: LibItem): void {
  if (i.type === 'local') playOrToggle(i.list.tracks, { label: i.list.title, route: libRoute(i) })
  else if (i.type === 'ya') void playYaPlaylist(i.p)
  else void playPlaylist(i.p)
}
