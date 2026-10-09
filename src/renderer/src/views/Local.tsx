import { useEffect, useMemo, useRef, useState } from 'react'
import { Artwork } from '@/components/Artwork'
import { DownloadButton } from '@/components/DownloadButton'
import { Icon } from '@/components/Icon'
import { ActionBar, Dot, PageHeader } from '@/components/PageHeader'
import { Empty, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playOrToggle, useIsPlayingFrom } from '@/lib/actions'
import { art, useArtColor } from '@/lib/artwork'
import { countLabel, fmtDuration, fmtTotal } from '@/lib/format'
import { api, tracksOf } from '@/lib/api'
import { audius } from '@/lib/audius'
import { searchYandex } from '@/lib/yandex'
import { trackArt } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import { Spinner } from '@/components/States'
import { navigate, useApp } from '@/store/app'
import { tx } from '@/lib/i18n'
import { removeDownloads, useOffline } from '@/lib/offline'
import {
  addToPlaylist,
  deletePlaylist,
  moveInPlaylist,
  pickPlaylistCover,
  removePlaylistCover,
  setPlaylistOffline,
  playlistCovers,
  removeFromPlaylist,
  renamePlaylist,
  usePlaylists,
  type LocalPlaylist
} from '@/lib/playlists'
import type { PlaySource, Route, Track } from '@/lib/types'
import { openMenuAt, type MenuItem } from '@/store/ui'

/** 2×2 collage of a playlist's covers (or a single cover / a placeholder). */
export function Collage({ list, size }: { list: LocalPlaylist; size?: number }): React.JSX.Element {
  if (list.cover) return <Artwork src={list.cover} size={size} placeholder="queue" />
  const covers = playlistCovers(list)
  if (covers.length < 4) return <Artwork src={art(covers[0], 't500x500')} size={size} placeholder="queue" />
  return (
    <div className="collage" style={size ? { width: size, height: size } : undefined}>
      {covers.map((c) => (
        <img key={c} src={art(c, 't300x300') ?? undefined} alt="" draggable={false} />
      ))}
    </div>
  )
}

/** Playlist cover button: says it can be changed — always on an empty cover, on hover otherwise. */
function CoverButton({ list }: { list: LocalPlaylist }): React.JSX.Element {
  const empty = !list.cover && !playlistCovers(list).length
  return (
    <button className={cx('ph-art-btn', empty && 'empty')} onClick={() => pickPlaylistCover(list.id)} aria-label={tx('Выбрать обложку')}>
      {empty ? <div className="ph-tile" /> : <Collage list={list} />}
      <span className="ph-art-edit">
        <Icon name="edit" size={empty ? 40 : 36} />
        <span>{tx('Выбрать обложку')}</span>
      </span>
    </button>
  )
}

/** Alternates lists (a1, b1, c1, a2, …). */
function mix(...lists: Track[][]): Track[] {
  const out: Track[] = []
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i])
  return out
}

/** Search every service right on the playlist page and add with one click. */
function AddTracks({ list }: { list: LocalPlaylist }): React.JSX.Element {
  const scIn = useApp((s) => s.auth === 'in')
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Track[] | null>(null)
  const [busy, setBusy] = useState(false)
  const gen = useRef(0)
  const have = useMemo(() => new Set(list.tracks.map((t) => t.id)), [list.tracks])

  useEffect(() => {
    const query = q.trim()
    const g = ++gen.current
    if (!query) {
      setRes(null)
      setBusy(false)
      return
    }
    setBusy(true)
    const timer = window.setTimeout(() => {
      void Promise.all([
        scIn ? api.searchTracks(query, 15).then((r) => tracksOf(r.collection)).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
        searchYandex(query).catch(() => [] as Track[]),
        audius.search(query).catch(() => [] as Track[])
      ]).then(([sc, ya, au]) => {
        if (g !== gen.current) return
        setRes(mix(sc, ya.slice(0, 15), au.slice(0, 8)).slice(0, 30))
        setBusy(false)
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [q, scIn])

  return (
    <section className="add-tracks">
      <h2 className="h2">{tx('Добавить треки')}</h2>
      <div className="search add-search">
        <Icon name="search" size={20} className="search-icon" />
        <input value={q} placeholder={tx('Поиск по всем сервисам')} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        {busy && <Spinner size={18} />}
      </div>
      {res && !res.length && !busy && <p className="muted add-empty">{tx('Ничего не нашлось')}</p>}
      {res && res.length > 0 && (
        <div className="add-list">
          {res.map((t) => {
            const added = have.has(t.id)
            return (
              <div key={t.id} className="add-row">
                <Artwork src={trackArt(t)} size={40} />
                <div className="add-text">
                  <div className="ellipsis">{t.title}</div>
                  <div className="add-sub ellipsis">{t.user?.username}</div>
                </div>
                <span className="add-dur">{fmtDuration(t.full_duration || t.duration || 0)}</span>
                <button className="btn btn-outline btn-sm" disabled={added} onClick={() => addToPlaylist(list.id, [t])}>
                  {added ? tx('Добавлено') : tx('Добавить')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function LocalPlaylistView({ id }: { id: string }): React.JSX.Element {
  const loaded = usePlaylists((s) => s.loaded)
  const list = usePlaylists((s) => s.lists.find((l) => l.id === id))
  const route: Route = { name: 'local', id }
  const active = useIsPlayingFrom(route)
  const color = useArtColor(list ? (list.cover ?? art(playlistCovers(list)[0], 't300x300')) : null)
  const source = useMemo<PlaySource>(() => ({ label: list?.title ?? tx('Плейлист'), route: { name: 'local', id } }), [list?.title, id])

  if (!loaded) return <Loading />
  if (!list) return <Empty icon="queue" title={tx('Плейлист не найден')} text={tx('Возможно, его удалили.')} />

  const total = list.tracks.reduce((s, t) => s + (t.full_duration || t.duration || 0), 0)
  const menu = (): MenuItem[] => [
    { label: tx('Сменить обложку'), icon: 'edit', onSelect: () => pickPlaylistCover(id) },
    ...(list.cover ? [{ label: tx('Вернуть коллаж'), icon: 'refresh' as const, onSelect: () => removePlaylistCover(id) }] : []),
    { label: tx('Переименовать'), icon: 'edit', onSelect: () => void renamePlaylist(id) },
    { separator: true },
    { label: tx('Удалить плейлист'), icon: 'trash', danger: true, onSelect: () => void deletePlaylist(id) }
  ]
  const rowMenu = (_t: Track, i: number): MenuItem[] => [
    { separator: true },
    { label: tx('Выше'), icon: 'arrowUp', disabled: i === 0, onSelect: () => moveInPlaylist(id, i, i - 1) },
    { label: tx('Ниже'), icon: 'arrowDown', disabled: i === list.tracks.length - 1, onSelect: () => moveInPlaylist(id, i, i + 1) },
    { label: tx('Убрать из плейлиста'), icon: 'trash', onSelect: () => removeFromPlaylist(id, i) }
  ]

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Ваш плейлист')}
        title={list.title}
        color={color}
        art={<CoverButton list={list} />}
        meta={
          <>
            {countLabel(list.tracks.length, tx('трек'), tx('трека'), tx('треков'))}
            {total > 0 && <span className="muted">, {fmtTotal(total)}</span>}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!list.tracks.length}
          onPlay={() => playOrToggle(list.tracks, source)}
          onShuffle={() => playOrToggle(list.tracks, source, { shuffle: true })}
          sticky={{ title: list.title, color }}
        >
          <DownloadButton tracks={list.tracks} onChange={(on) => setPlaylistOffline(id, on)} />
          <button className="icon-btn xl" aria-label={tx('Ещё')} onClick={(e) => openMenuAt(e.currentTarget, menu())}>
            <Icon name="more" size={28} />
          </button>
        </ActionBar>
        {list.tracks.length > 0 && <TrackList tracks={list.tracks} source={source} extra="none" menuExtra={rowMenu} />}
        <AddTracks list={list} />
      </div>
    </div>
  )
}

/** Tracks available without internet: downloads, then whatever the cache kept. */
export function OfflineView(): React.JSX.Element {
  const [items, setItems] = useState<{ track: Track; pinned: boolean; size: number }[] | null>(null)
  const pinnedKeys = useOffline((s) => s.pinned)
  const route: Route = { name: 'offline' }
  const active = useIsPlayingFrom(route)

  useEffect(() => {
    void window.sc.cache.list().then((list) => setItems(list.map((c) => ({ track: c.meta as Track, pinned: c.pinned, size: c.size }))))
  }, [pinnedKeys])

  const downloads = useMemo(() => (items ?? []).filter((i) => i.pinned).map((i) => i.track), [items])
  const recent = useMemo(() => (items ?? []).filter((i) => !i.pinned).map((i) => i.track), [items])
  const size = (items ?? []).filter((i) => i.pinned).reduce((s, i) => s + i.size, 0)
  const source: PlaySource = { label: tx('Скачанное'), route }
  const recentSource: PlaySource = { label: tx('Сохранено в кеше'), route }

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Без интернета')}
        title={tx('Скачанное')}
        color="hsl(0 0% 20%)"
        art={
          <div className="ph-tile">
            <Icon name="downloadDone" size={92} />
          </div>
        }
        meta={
          <>
            {countLabel(downloads.length, tx('трек'), tx('трека'), tx('треков'))}
            {size > 0 && (
              <>
                <Dot />
                {size >= 1024 ** 3 ? tx('{0} ГБ', (size / 1024 ** 3).toFixed(1)) : tx('{0} МБ', Math.round(size / 1024 ** 2))}
              </>
            )}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!downloads.length && !recent.length}
          onPlay={() => playOrToggle(downloads.length ? downloads : recent, downloads.length ? source : recentSource)}
          onShuffle={() => playOrToggle(downloads.length ? downloads : recent, downloads.length ? source : recentSource, { shuffle: true })}
          sticky={{ title: tx('Скачанное') }}
        />
        {!items ? (
          <Loading />
        ) : !downloads.length ? (
          <Empty
            icon="download"
            title={tx('Скачанного пока нет')}
            text={tx('Нажмите ↓ на плейлисте, чтобы слушать без интернета')}
          />
        ) : (
          <TrackList
            tracks={downloads}
            source={source}
            extra="none"
            menuExtra={(t) => [{ separator: true }, { label: tx('Удалить из скачанного'), icon: 'trash', onSelect: () => void removeDownloads([t], false) }]}
          />
        )}
        {recent.length > 0 && (
          <section className="section">
            <div className="shelf-head">
              <h2 className="h2">{tx('Сохранено после прослушивания')}</h2>
              <button className="link-more" onClick={() => navigate({ name: 'settings' })}>
                {tx('Настроить кеш')}
              </button>
            </div>
            <TrackList tracks={recent} source={recentSource} head={false} extra="none" />
          </section>
        )}
      </div>
    </div>
  )
}
