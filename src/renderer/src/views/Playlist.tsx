import { useMemo } from 'react'
import { Artwork } from '@/components/Artwork'
import { playlistKind } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { DownloadButton } from '@/components/DownloadButton'
import { ActionBar, Dot, PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playlistMenu, playlistRoute, playOrToggle, useIsPlayingFrom } from '@/lib/actions'
import { api, hydrate } from '@/lib/api'
import { playlistArt, useArtColor, userArt } from '@/lib/artwork'
import { countLabel, fmtTotal, year } from '@/lib/format'
import { cx, useAsync, type Async } from '@/lib/hooks'
import type { AnyPlaylist, PlaySource } from '@/lib/types'
import { navigate, togglePlaylistLike, useApp } from '@/store/app'
import { player } from '@/store/player'
import { openMenuAt } from '@/store/ui'
import { tx } from '@/lib/i18n'

export function PlaylistView({ id }: { id: number }): React.JSX.Element {
  const res = useAsync<AnyPlaylist>(() => api.playlist(id), [id])
  return <PlaylistPage res={res} />
}

export function SystemPlaylistView({ urn }: { urn: string }): React.JSX.Element {
  const res = useAsync<AnyPlaylist>(() => api.systemPlaylist(urn), [urn])
  return <PlaylistPage res={res} />
}

function PlaylistPage({ res }: { res: Async<AnyPlaylist> }): React.JSX.Element {
  const pl = res.data
  const tracksRes = useAsync(() => (pl ? hydrate(pl.tracks ?? []) : Promise.resolve(null)), [pl])
  const tracks = useMemo(() => tracksRes.data ?? [], [tracksRes.data])
  const artUrl = playlistArt(pl, 't500x500')
  const color = useArtColor(artUrl)
  const route = pl ? playlistRoute(pl) : { name: 'home' as const }
  const active = useIsPlayingFrom(route)
  const meId = useApp((s) => s.me?.id)
  const liked = useApp((s) => (pl?.kind === 'playlist' ? s.likedPlaylists.has(pl.id) : false))

  const source = useMemo<PlaySource | null>(() => (pl ? { label: pl.title, route: playlistRoute(pl) } : null), [pl])

  if (res.error) return <ErrorState text={res.error} onRetry={res.reload} />
  if (!pl || !source) return <Loading />

  const total = tracks.reduce((sum, t) => sum + (t.full_duration || t.duration || 0), 0)
  const count = pl.kind === 'playlist' ? (pl.track_count ?? tracks.length) : tracks.length
  const owner = pl.user
  const isOwn = pl.kind === 'playlist' && owner?.id === meId

  return (
    <div className="view flush">
      <PageHeader
        kind={playlistKind(pl)}
        title={pl.title}
        color={color}
        art={<Artwork src={artUrl} placeholder="queue" />}
        meta={
          <>
            {owner && (
              <button className="ph-owner link" onClick={() => navigate({ name: 'user', id: owner.id })}>
                <Artwork src={userArt(owner, 'large')} size={24} round placeholder="person" />
                <strong>{owner.username}</strong>
              </button>
            )}
            {pl.kind === 'system-playlist' && !owner && <strong>SoundCloud</strong>}
            {pl.kind === 'playlist' && year(pl.release_date || pl.published_at || pl.created_at) && (
              <>
                <Dot />
                {year(pl.release_date || pl.published_at || pl.created_at)}
              </>
            )}
            <Dot />
            {countLabel(count, tx("трек"), tx("трека"), tx("треков"))}
            {total > 0 && <span className="muted">, {fmtTotal(total)}</span>}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => player.playContext(tracks, 0, source, { shuffle: true })}
          sticky={{ title: pl.title, color }}
        >
          {pl.kind === 'playlist' && !isOwn && (
            <button
              className={cx('icon-btn xl like', liked && 'on')}
              onClick={() => void togglePlaylistLike(pl)}
              title={liked ? tx("Удалить из медиатеки") : tx("Сохранить в медиатеку")}
              aria-label={liked ? tx("Удалить из медиатеки") : tx("Сохранить в медиатеку")}
            >
              <Icon name={liked ? 'heart' : 'heartOutline'} size={30} />
            </button>
          )}
          <DownloadButton tracks={tracks} />
          <button className="icon-btn xl" aria-label={tx("Ещё")} onClick={(e) => openMenuAt(e.currentTarget, playlistMenu(pl))}>
            <Icon name="more" size={28} />
          </button>
        </ActionBar>

        {tracksRes.error ? (
          <ErrorState text={tracksRes.error} onRetry={tracksRes.reload} />
        ) : tracksRes.loading && !tracks.length ? (
          <Loading />
        ) : !tracks.length ? (
          <Empty icon="queue" title={tx("В плейлисте нет треков")} />
        ) : (
          <TrackList tracks={tracks} source={source} />
        )}
      </div>
    </div>
  )
}
