import { api, hydrate, tracksOf } from './api'
import type { AnyPlaylist, PlaySource, Route, Track, User } from './types'
import { toggleYaLike, useYa } from './yandexApi'
import { toggleAudiusLike, useAudius } from './audius'
import { addToPlaylistMenu } from './playlists'
import { toggleRadioFav, useRadio } from './radio'
import { toggleLocalLike, useLocal } from './local'
import { copyLink, navigate, openUrl, toggleLike, useApp } from '@/store/app'
import { player, usePlayer } from '@/store/player'
import { toast, type MenuItem } from '@/store/ui'
import { tx } from '@/lib/i18n'

export const playlistRoute = (p: AnyPlaylist): Route =>
  p.kind === 'playlist' ? { name: 'playlist', id: p.id } : { name: 'system', urn: p.urn }

export const sameRoute = (a?: Route, b?: Route): boolean => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

/** Is the player currently playing from this route? */
export function useIsPlayingFrom(route: Route): boolean {
  return usePlayer((s) => s.playing && sameRoute(s.source?.route, route))
}

/** Plays a list, or toggles pause if it's already the active source. */
export function playOrToggle(tracks: Track[], source: PlaySource, opts: { shuffle?: boolean } = {}): void {
  const s = usePlayer.getState()
  if (source.route && sameRoute(s.source?.route, source.route) && s.current && opts.shuffle === undefined) {
    player.toggle()
    return
  }
  player.playContext(tracks, 0, source, opts)
}

export async function playPlaylist(p: AnyPlaylist, opts: { shuffle?: boolean } = {}): Promise<void> {
  const route = playlistRoute(p)
  const s = usePlayer.getState()
  if (sameRoute(s.source?.route, route) && s.current && opts.shuffle === undefined) {
    player.toggle()
    return
  }
  try {
    const full = p.kind === 'playlist' ? await api.playlist(p.id) : await api.systemPlaylist(p.urn)
    const all = full.tracks ?? []
    const head = await hydrate(all.slice(0, 40))
    if (!head.length) {
      toast(tx("В плейлисте нет доступных треков"))
      return
    }
    const source: PlaySource = { label: full.title, route }
    if (all.length <= 40) {
      player.playContext(head, 0, source, opts)
      return
    }
    // Long playlist: start right away, fetch the rest while the first track plays.
    player.playContext(head, 0, source, opts)
    player.extendContext(route, await hydrate(all.slice(40)))
  } catch {
    toast(tx("Не удалось загрузить плейлист"))
  }
}

export async function playUser(u: User): Promise<void> {
  const route: Route = { name: 'user', id: u.id }
  const s = usePlayer.getState()
  if (sameRoute(s.source?.route, route) && s.current) {
    player.toggle()
    return
  }
  try {
    let tracks = tracksOf((await api.userTop(u.id)).collection)
    if (!tracks.length) tracks = tracksOf((await api.userTracks(u.id)).collection)
    if (!tracks.length) {
      toast(tx("У исполнителя нет треков"))
      return
    }
    player.playContext(tracks, 0, { label: u.username, route })
  } catch {
    toast(tx("Не удалось загрузить треки"))
  }
}

/** Like/unlike in whichever service the track comes from. */
export function toggleAnyLike(track: Track): void {
  if (track.origin === 'radio') toggleRadioFav(track)
  else if (track.origin === 'local') toggleLocalLike(track)
  else if (track.origin === 'yandex') void toggleYaLike(track)
  else if (track.origin === 'audius') toggleAudiusLike(track)
  else void toggleLike(track)
}

/** Is this track liked (in whichever service it comes from)? */
export function useLiked(track: Track | null | undefined): boolean {
  const sc = useApp((s) => (track && !track.origin ? s.likes.has(track.id) : false))
  const ya = useYa((s) => (track?.ya ? s.likes.has(track.ya.trackId) : false))
  const au = useAudius((s) => (track?.au ? s.likeIds.has(track.id) : false))
  const fav = useRadio((s) => (track?.radio ? s.favIds.has(track.id) : false))
  const file = useLocal((s) => (track?.local ? s.likeIds.has(track.id) : false))
  return track?.origin === 'local' ? file : track?.origin === 'radio' ? fav : track?.origin === 'yandex' ? ya : track?.origin === 'audius' ? au : sc
}

/** Artist of a track: SoundCloud profile, or the artist page of Yandex / Audius. */
export function openArtist(track: Track): void {
  if (track.origin === 'radio') {
    navigate({ name: 'radio' })
  } else if (track.origin === 'local') {
    navigate({ name: 'files' })
  } else if (track.origin === 'audius') {
    if (track.au) navigate({ name: 'au-artist', id: track.au.userId })
  } else if (track.origin === 'yandex') {
    const id = track.ya?.artistId
    if (id) navigate({ name: 'ya-artist', id })
  } else if (track.user) {
    navigate({ name: 'user', id: track.user.id })
  }
}

export function trackMenu(track: Track, extra: MenuItem[] = []): MenuItem[] {
  if (track.origin === 'local') {
    const liked = useLocal.getState().likeIds.has(track.id)
    return [
      { label: tx("Играть следующим"), icon: 'playNext', onSelect: () => player.playNext(track) },
      { label: tx("Добавить в очередь"), icon: 'queueAdd', onSelect: () => player.enqueue(track) },
      { label: tx('Добавить в плейлист'), icon: 'add', onSelect: () => addToPlaylistMenu([track]) },
      { separator: true },
      {
        label: liked ? tx("Убрать из «Мне нравится»") : tx("Добавить в «Мне нравится»"),
        icon: liked ? 'heart' : 'heartOutline',
        onSelect: () => toggleLocalLike(track)
      },
      ...extra
    ]
  }
  if (track.origin === 'radio') {
    const fav = useRadio.getState().favIds.has(track.id)
    return [
      { label: tx("Добавить в очередь"), icon: 'queueAdd', onSelect: () => player.enqueue(track) },
      {
        label: fav ? tx('Убрать из избранного') : tx('В избранные станции'),
        icon: fav ? 'heart' : 'heartOutline',
        onSelect: () => toggleRadioFav(track)
      },
      ...extra,
      ...(track.permalink_url
        ? [{ separator: true } as const, { label: tx("Скопировать ссылку"), icon: 'link' as const, onSelect: () => copyLink(track.permalink_url) }]
        : [])
    ]
  }
  if (track.origin === 'audius') {
    const liked = useAudius.getState().likeIds.has(track.id)
    return [
      { label: tx("Играть следующим"), icon: 'playNext', onSelect: () => player.playNext(track) },
      { label: tx("Добавить в очередь"), icon: 'queueAdd', onSelect: () => player.enqueue(track) },
      { label: tx('Добавить в плейлист'), icon: 'add', onSelect: () => addToPlaylistMenu([track]) },
      { separator: true },
      {
        label: liked ? tx("Убрать из «Мне нравится»") : tx("Добавить в «Мне нравится»"),
        icon: liked ? 'heart' : 'heartOutline',
        onSelect: () => toggleAudiusLike(track)
      },
      { label: tx("Перейти к исполнителю"), icon: 'person', onSelect: () => openArtist(track) },
      ...extra,
      { separator: true },
      { label: tx("Скопировать ссылку"), icon: 'link', onSelect: () => copyLink(track.permalink_url) },
      { label: tx('Открыть на Audius'), icon: 'external', onSelect: () => openUrl(track.permalink_url) }
    ]
  }
  if (track.origin === 'yandex') {
    return [
      { label: tx("Играть следующим"), icon: 'playNext', onSelect: () => player.playNext(track) },
      { label: tx("Добавить в очередь"), icon: 'queueAdd', onSelect: () => player.enqueue(track) },
      { label: tx('Добавить в плейлист'), icon: 'add', onSelect: () => addToPlaylistMenu([track]) },
      { separator: true },
      { label: tx('Мне нравится'), icon: 'heart', onSelect: () => void toggleYaLike(track) },
      { label: tx("Перейти к исполнителю"), icon: 'person', onSelect: () => openArtist(track) },
      ...extra,
      { separator: true },
      { label: tx("Скопировать ссылку"), icon: 'link', onSelect: () => copyLink(track.permalink_url) },
      { label: tx("Открыть в Яндекс Музыке"), icon: 'external', onSelect: () => openUrl(track.permalink_url) }
    ]
  }
  const liked = useApp.getState().likes.has(track.id)
  const items: MenuItem[] = [
    { label: tx("Играть следующим"), icon: 'playNext', onSelect: () => player.playNext(track) },
    { label: tx("Добавить в очередь"), icon: 'queueAdd', onSelect: () => player.enqueue(track) },
      { label: tx('Добавить в плейлист'), icon: 'add', onSelect: () => addToPlaylistMenu([track]) },
    { label: tx("Радио по треку"), icon: 'radio', onSelect: () => void player.startRadio(track) },
    { separator: true },
    {
      label: liked ? tx("Убрать из «Мне нравится»") : tx("Добавить в «Мне нравится»"),
      icon: liked ? 'heart' : 'heartOutline',
      onSelect: () => void toggleLike(track)
    }
  ]
  if (track.user) {
    const user = track.user
    items.push({ label: tx("Перейти к исполнителю"), icon: 'person', onSelect: () => navigate({ name: 'user', id: user.id }) })
  }
  items.push(...extra)
  items.push(
    { separator: true },
    { label: tx("Скопировать ссылку"), icon: 'link', onSelect: () => copyLink(track.permalink_url) },
    { label: tx("Открыть на SoundCloud"), icon: 'external', onSelect: () => openUrl(track.permalink_url) }
  )
  return items
}

export function playlistMenu(p: AnyPlaylist): MenuItem[] {
  return [
    { label: tx("Слушать"), icon: 'play', onSelect: () => void playPlaylist(p) },
    { label: tx("Перемешать"), icon: 'shuffle', onSelect: () => void playPlaylist(p, { shuffle: true }) },
    { separator: true },
    { label: tx("Скопировать ссылку"), icon: 'link', onSelect: () => copyLink(p.permalink_url), disabled: !p.permalink_url },
    { label: tx("Открыть на SoundCloud"), icon: 'external', onSelect: () => openUrl(p.permalink_url), disabled: !p.permalink_url }
  ]
}

export function userMenu(u: User): MenuItem[] {
  return [
    { label: tx("Слушать популярное"), icon: 'play', onSelect: () => void playUser(u) },
    { separator: true },
    { label: tx("Скопировать ссылку"), icon: 'link', onSelect: () => copyLink(u.permalink_url) },
    { label: tx("Открыть на SoundCloud"), icon: 'external', onSelect: () => openUrl(u.permalink_url) }
  ]
}
