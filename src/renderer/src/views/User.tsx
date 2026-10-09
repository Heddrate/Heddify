import { useMemo, useState } from 'react'
import { Artwork } from '@/components/Artwork'
import { Grid, PlaylistCard, Shelf } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { ActionBar, Dot, PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, LoadMore, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playOrToggle, useIsPlayingFrom, userMenu } from '@/lib/actions'
import { api, tracksOf } from '@/lib/api'
import { useArtColor, userArt } from '@/lib/artwork'
import { countLabel } from '@/lib/format'
import { cx, useAsync, usePaged } from '@/lib/hooks'
import type { PlaySource, Playlist, Route, StreamItem, Track, User, UserTab } from '@/lib/types'
import { navigate, toggleFollow, useApp } from '@/store/app'
import { openMenuAt } from '@/store/ui'
import { tx } from '@/lib/i18n'

const tabs = (): [UserTab, string][] => [
  ['popular', tx("Популярное")],
  ['tracks', tx("Треки")],
  ['albums', tx("Альбомы")],
  ['playlists', tx("Плейлисты")],
  ['reposts', tx("Репосты")]
]

export function UserView({ id, tab = 'popular' }: { id: number; tab?: UserTab }): React.JSX.Element {
  const res = useAsync(() => api.user(id), [id])
  const top = useAsync(() => api.userTop(id).then((r) => tracksOf(r.collection)), [id])
  const user = res.data
  const avatar = userArt(user, 't500x500')
  const color = useArtColor(avatar)
  const route: Route = { name: 'user', id }
  const active = useIsPlayingFrom(route)
  const meId = useApp((s) => s.me?.id)
  const following = useApp((s) => s.follows.has(id))

  if (res.error) return <ErrorState text={res.error} onRetry={res.reload} />
  if (!user) return <Loading />

  const banner = user.visuals?.visuals?.[0]?.visual_url ?? null
  const verified = user.verified || user.badges?.verified
  const topTracks = top.data ?? []
  const source: PlaySource = { label: user.username, route }

  return (
    <div className="view flush">
      <PageHeader
        kind={verified ? tx("Подтверждённый исполнитель") : tx("Профиль")}
        title={user.username}
        color={color}
        image={banner ? banner.replace(/-original\.(jpe?g|png)/, '-t1240x260.$1') : null}
        round
        art={<Artwork src={avatar} round placeholder="person" />}
        meta={
          <>
            {user.full_name && user.full_name !== user.username && (
              <>
                <strong>{user.full_name}</strong>
                <Dot />
              </>
            )}
            {countLabel(user.followers_count ?? 0, tx("подписчик"), tx("подписчика"), tx("подписчиков"))}
            <Dot />
            {countLabel(user.track_count ?? 0, tx("трек"), tx("трека"), tx("треков"))}
            {user.city && (
              <>
                <Dot />
                {user.city}
              </>
            )}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!topTracks.length}
          onPlay={() => playOrToggle(topTracks, source)}
          sticky={{ title: user.username, color }}
        >
          {user.id !== meId && (
            <button className={cx('btn btn-outline', following && 'on')} onClick={() => void toggleFollow(user)}>
              {following ? tx("Вы подписаны") : tx("Подписаться")}
            </button>
          )}
          <button className="icon-btn xl" aria-label={tx("Ещё")} onClick={(e) => openMenuAt(e.currentTarget, userMenu(user))}>
            <Icon name="more" size={28} />
          </button>
        </ActionBar>

        <div className="chips tabs">
          {tabs().map(([key, label]) => (
            <button
              key={key}
              className={cx('chip', tab === key && 'on')}
              onClick={() => navigate({ name: 'user', id, tab: key === 'popular' ? undefined : key }, true)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'popular' && <Popular user={user} top={topTracks} loading={top.loading} source={source} />}
        {tab === 'tracks' && <UserTracks user={user} />}
        {tab === 'albums' && <UserSets user={user} kind="albums" />}
        {tab === 'playlists' && <UserSets user={user} kind="playlists" />}
        {tab === 'reposts' && <UserReposts user={user} />}
      </div>
    </div>
  )
}

function Popular({ user, top, loading, source }: { user: User; top: Track[]; loading: boolean; source: PlaySource }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const albums = useAsync(() => api.userAlbums(user.id).then((r) => r.collection), [user.id])
  const playlists = useAsync(() => api.userPlaylists(user.id).then((r) => r.collection), [user.id])
  const go = (tab: UserTab) => () => navigate({ name: 'user', id: user.id, tab }, true)

  return (
    <>
      <section className="section">
        <h2 className="h2">{tx("Популярные треки")}</h2>
        {loading && !top.length ? (
          <Loading />
        ) : !top.length ? (
          <Empty icon="note" title={tx("Треков пока нет")} />
        ) : (
          <>
            <TrackList tracks={expanded ? top : top.slice(0, 5)} source={source} head={false} />
            {top.length > 5 && (
              <button className="link-more pad" onClick={() => setExpanded(!expanded)}>
                {expanded ? tx("Свернуть") : tx("Ещё")}
              </button>
            )}
          </>
        )}
      </section>
      <Shelf title={tx("Альбомы")} onMore={go('albums')}>
        {(albums.data ?? []).map((p) => (
          <PlaylistCard key={p.id} p={p} />
        ))}
      </Shelf>
      <Shelf title={tx("Плейлисты")} onMore={go('playlists')}>
        {(playlists.data ?? []).map((p) => (
          <PlaylistCard key={p.id} p={p} />
        ))}
      </Shelf>
    </>
  )
}

function UserTracks({ user }: { user: User }): React.JSX.Element {
  const pg = usePaged<Track>(`user-tracks-${user.id}`, () => api.userTracks(user.id))
  const tracks = useMemo(() => tracksOf(pg.items), [pg.items])
  const source = useMemo<PlaySource>(
    () => ({ label: tx("{0} — треки", user.username), route: { name: 'user', id: user.id, tab: 'tracks' }, next: pg.next }),
    [user, pg.next]
  )
  return (
    <section className="section">
      {pg.error && !tracks.length ? (
        <ErrorState text={pg.error} onRetry={pg.reload} />
      ) : pg.loading && !tracks.length ? (
        <Loading />
      ) : !tracks.length ? (
        <Empty icon="note" title={tx("Треков нет")} />
      ) : (
        <TrackList tracks={tracks} source={source} extra="date" dates={tracks.map((t) => t.display_date ?? t.created_at)} dateLabel={tx("Опубликовано")} />
      )}
      <LoadMore active={!!pg.next} loading={pg.loading && tracks.length > 0} onVisible={pg.loadMore} />
    </section>
  )
}

function UserSets({ user, kind }: { user: User; kind: 'albums' | 'playlists' }): React.JSX.Element {
  const pg = usePaged<Playlist>(`user-${kind}-${user.id}`, () =>
    kind === 'albums' ? api.userAlbums(user.id) : api.userPlaylists(user.id)
  )
  return (
    <section className="section">
      {pg.error && !pg.items.length ? (
        <ErrorState text={pg.error} onRetry={pg.reload} />
      ) : pg.loading && !pg.items.length ? (
        <Loading />
      ) : !pg.items.length ? (
        <Empty icon={kind === 'albums' ? 'album' : 'queue'} title={kind === 'albums' ? tx("Альбомов нет") : tx("Плейлистов нет")} />
      ) : (
        <Grid>
          {pg.items.map((p) => (
            <PlaylistCard key={p.id} p={p} />
          ))}
        </Grid>
      )}
      <LoadMore active={!!pg.next} loading={pg.loading && pg.items.length > 0} onVisible={pg.loadMore} />
    </section>
  )
}

function UserReposts({ user }: { user: User }): React.JSX.Element {
  const pg = usePaged<StreamItem>(`user-reposts-${user.id}`, () => api.userReposts(user.id))
  const tracks = useMemo(() => tracksOf(pg.items), [pg.items])
  const source = useMemo<PlaySource>(
    () => ({ label: tx("{0} — репосты", user.username), route: { name: 'user', id: user.id, tab: 'reposts' }, next: pg.next }),
    [user, pg.next]
  )
  return (
    <section className="section">
      {pg.error && !tracks.length ? (
        <ErrorState text={pg.error} onRetry={pg.reload} />
      ) : pg.loading && !tracks.length ? (
        <Loading />
      ) : !tracks.length ? (
        <Empty icon="refresh" title={tx("Репостов нет")} />
      ) : (
        <TrackList tracks={tracks} source={source} />
      )}
      <LoadMore active={!!pg.next} loading={pg.loading && tracks.length > 0} onVisible={pg.loadMore} />
    </section>
  )
}
