import { useEffect, useMemo, useState } from 'react'
import { Artwork } from '@/components/Artwork'
import { Card, Grid, PlaylistCard, Shelf, UserCard } from '@/components/Card'
import { addRecent, clearRecent, removeRecent, useRecent } from '@/lib/recent'
import { openArtist, trackMenu } from '@/lib/actions'
import { Icon } from '@/components/Icon'
import { Empty, ErrorState, LoadMore, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playlistRoute, playUser } from '@/lib/actions'
import { api, tracksOf } from '@/lib/api'
import { searchYandex } from '@/lib/yandex'
import { audius } from '@/lib/audius'
import { trackArt, userArt } from '@/lib/artwork'
import { cx, useAsync, usePaged } from '@/lib/hooks'
import type { Collection, Playlist, PlaySource, SearchTab, Track, User } from '@/lib/types'
import { navigate, useApp } from '@/store/app'
import { player } from '@/store/player'
import { tx } from '@/lib/i18n'

const tabs = (): [SearchTab, string][] => [
  ['all', tx("Всё")],
  ['tracks', tx("Треки")],
  ['users', tx("Исполнители")],
  ['playlists', tx("Плейлисты")],
  ['albums', tx("Альбомы")]
]

/** Tabs that need a SoundCloud account; hidden in guest mode. */
const SC_TABS = new Set<SearchTab>(['users', 'playlists', 'albums'])

const SC_URL = /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\/\S+/i
const empty = <T,>(): Collection<T> => ({ collection: [] })

function playFromSearch(tracks: Track[], i: number, source: PlaySource): void {
  addRecent({ type: 'track', item: tracks[i] })
  player.playContext(tracks, i, source)
}

export function Search({ q, tab = 'all' }: { q: string; tab?: SearchTab }): React.JSX.Element {
  const scIn = useApp((s) => s.auth === 'in')
  if (!q) return <SearchStart />
  if (SC_URL.test(q)) return <ResolveLink url={q} />

  return (
    <div className="view">
      <div className="chips tabs">
        {tabs().filter(([key]) => scIn || !SC_TABS.has(key)).map(([key, label]) => (
          <button
            key={key}
            className={cx('chip', tab === key && 'on')}
            onClick={() => navigate({ name: 'search', q, tab: key === 'all' ? undefined : key }, true)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'all' && <SearchAll q={q} />}
      {(tab === 'tracks' || tab === 'yandex' || tab === 'audius') && <SearchTracks q={q} />}
      {tab === 'users' && <SearchUsers q={q} />}
      {(tab === 'playlists' || tab === 'albums') && <SearchSets q={q} albums={tab === 'albums'} />}
    </div>
  )
}

function SearchStart(): React.JSX.Element {
  const recent = useRecent((s) => s.items)

  if (!recent.length) {
    return (
      <div className="view">
        <Empty
          icon="search"
          title={tx("Что будем слушать?")}
          text={tx('Треки, исполнители, плейлисты и альбомы со всех сервисов')}
        />
      </div>
    )
  }

  return (
    <div className="view">
      <div className="shelf-head search-recent-head">
        <h2 className="h2">{tx("Недавние запросы")}</h2>
        <button className="link-more" onClick={clearRecent}>{tx("Очистить")}</button>
      </div>
      <Grid>
        {recent.map((r) => {
          const remove = (): void => removeRecent(r)
          if (r.type === 'user') return <UserCard key={`u${r.item.id}`} u={r.item} onActivate={() => addRecent(r)} onRemove={remove} />
          if (r.type === 'playlist')
            return <PlaylistCard key={`p${r.item.id}`} p={r.item} onActivate={() => addRecent(r)} onRemove={remove} />
          const t = r.item
          const play = (): void => {
            addRecent(r)
            player.playContext([t], 0, { label: t.title ?? tx("Трек") })
          }
          return (
            <Card
              key={`t${t.id}`}
              title={t.title ?? ''}
              sub={tx("Трек · {0}", t.user?.username ?? '')}
              art={trackArt(t)}
              letter={t.user?.username ?? t.title}
              onOpen={play}
              onPlay={play}
              menu={() => trackMenu(t)}
              onRemove={remove}
            />
          )
        })}
      </Grid>
    </div>
  )
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function SearchAll({ q }: { q: string }): React.JSX.Element {
  // without a SoundCloud account only Yandex and Audius are searched
  const scIn = useApp((s) => s.auth === 'in')
  const res = useAsync(
    () =>
      Promise.all([
        scIn ? api.searchTracks(q, 20).catch(() => empty<Track>()) : empty<Track>(),
        scIn ? api.searchUsers(q, 12).catch(() => empty<User>()) : empty<User>(),
        scIn ? api.searchPlaylists(q, 12).catch(() => empty<Playlist>()) : empty<Playlist>(),
        scIn ? api.searchAlbums(q, 12).catch(() => empty<Playlist>()) : empty<Playlist>(),
        searchYandex(q).catch(() => [] as Track[]),
        audius.search(q).catch(() => [] as Track[])
      ]),
    [q, scIn]
  )
  const source = useMemo<PlaySource>(() => ({ label: tx("Поиск: {0}", q), route: { name: 'search', q, tab: 'tracks' } }), [q])

  if (res.error) return <ErrorState text={res.error} onRetry={res.reload} />
  if (!res.data) return <Loading />
  const [tracksC, usersC, playlistsC, albumsC, ya, au] = res.data
  const sc = tracksOf(tracksC.collection)
  // all services side by side in one list
  const tracks = interleave(interleave(sc, ya), au.slice(0, 6))
  const users = usersC.collection
  if (!tracks.length && !ya.length && !users.length && !playlistsC.collection.length && !albumsC.collection.length) {
    return <Empty icon="search" title={tx("Ничего не нашлось по запросу «{0}»", q)} />
  }

  const topUser = users[0] && normalize(users[0].username) === normalize(q) ? users[0] : null
  const go = (tab: SearchTab) => () => navigate({ name: 'search', q, tab }, true)

  return (
    <>
      <div className="search-top">
        <section>
          <h2 className="h2">{tx("Лучший результат")}</h2>
          {topUser ? (
            <TopUser u={topUser} />
          ) : tracks[0] ? (
            <TopTrack t={tracks[0]} tracks={tracks} source={source} />
          ) : users[0] ? (
            <TopUser u={users[0]} />
          ) : null}
        </section>
        {tracks.length > 0 && (
          <section className="search-top-tracks">
            <div className="shelf-head">
              <h2 className="h2">{tx("Треки")}</h2>
              <button className="link-more" onClick={go('tracks')}>{tx("Показать все")}</button>
            </div>
            <TrackList tracks={tracks.slice(0, 5)} source={source} head={false} extra="none" compact onPlayIndex={(i) => playFromSearch(tracks, i, source)} />
          </section>
        )}
      </div>
      <Shelf title={tx("Исполнители")} onMore={go('users')}>
        {users.map((u) => (
          <UserCard key={u.id} u={u} onActivate={() => addRecent({ type: 'user', item: u })} />
        ))}
      </Shelf>
      <Shelf title={tx("Альбомы")} onMore={go('albums')}>
        {albumsC.collection.map((p) => (
          <PlaylistCard key={p.id} p={p} onActivate={() => addRecent({ type: 'playlist', item: p })} />
        ))}
      </Shelf>
      <Shelf title={tx("Плейлисты")} onMore={go('playlists')}>
        {playlistsC.collection.map((p) => (
          <PlaylistCard key={p.id} p={p} onActivate={() => addRecent({ type: 'playlist', item: p })} />
        ))}
      </Shelf>
    </>
  )
}

function TopUser({ u }: { u: User }): React.JSX.Element {
  return (
    <div
      className="top-result"
      onClick={() => {
        addRecent({ type: 'user', item: u })
        navigate({ name: 'user', id: u.id })
      }}
      role="link"
      tabIndex={0}
    >
      <Artwork src={userArt(u)} size={96} round placeholder="person" />
      <div className="top-title ellipsis">{u.username}</div>
      <span className="pill-label">{tx("Исполнитель")}</span>
      <button
        className="play-fab"
        aria-label={tx("Слушать")}
        onClick={(e) => {
          e.stopPropagation()
          addRecent({ type: 'user', item: u })
          void playUser(u)
        }}
      >
        <Icon name="play" size={22} />
      </button>
    </div>
  )
}

function TopTrack({ t, tracks, source }: { t: Track; tracks: Track[]; source: PlaySource }): React.JSX.Element {
  const play = (): void => playFromSearch(tracks, 0, source)
  return (
    <div className="top-result" onClick={play} role="button" tabIndex={0}>
      <Artwork src={trackArt(t)} size={96} />
      <div className="top-title ellipsis">{t.title}</div>
      <div className="top-sub">
        <span className="pill-label">{tx("Трек")}</span>
        {t.user && (
          <button
            className="link"
            onClick={(e) => {
              e.stopPropagation()
              openArtist(t)
            }}
          >
            {t.user.username}
          </button>
        )}
      </div>
      <button
        className="play-fab"
        aria-label={tx("Слушать")}
        onClick={(e) => {
          e.stopPropagation()
          play()
        }}
      >
        <Icon name="play" size={22} />
      </button>
    </div>
  )
}

/** Tracks from every service: SoundCloud pages on scroll, Yandex and Audius mixed into the top. */
function SearchTracks({ q }: { q: string }): React.JSX.Element {
  const scIn = useApp((s) => s.auth === 'in')
  const pg = usePaged<Track>(scIn ? `s-tracks-${q}` : null, () => api.searchTracks(q))
  const other = useAsync(
    () => Promise.all([searchYandex(q).catch(() => [] as Track[]), audius.search(q).catch(() => [] as Track[])]),
    [q]
  )
  const tracks = useMemo(() => {
    const [ya, au] = other.data ?? [[], []]
    const sc = tracksOf(pg.items)
    // the first SoundCloud page is mixed with the others; later pages just follow
    return [...interleave(interleave(sc.slice(0, 40), ya), au), ...sc.slice(40)]
  }, [pg.items, other.data])
  const source = useMemo<PlaySource>(() => ({ label: tx("Поиск: {0}", q), route: { name: 'search', q, tab: 'tracks' }, next: pg.next }), [q, pg.next])
  const loading = (scIn && pg.loading) || other.loading
  if (pg.error && !tracks.length && !loading) return <ErrorState text={pg.error} onRetry={pg.reload} />
  if (loading && !tracks.length) return <Loading />
  if (!tracks.length) return <Empty icon="search" title={tx("Треков не найдено")} />
  return (
    <>
      <TrackList tracks={tracks} source={source} extra="none" onPlayIndex={(i) => playFromSearch(tracks, i, source)} />
      <LoadMore active={!!pg.next} loading={pg.loading && tracks.length > 0} onVisible={pg.loadMore} />
    </>
  )
}

function SearchUsers({ q }: { q: string }): React.JSX.Element {
  const pg = usePaged<User>(`s-users-${q}`, () => api.searchUsers(q))
  if (pg.error && !pg.items.length) return <ErrorState text={pg.error} onRetry={pg.reload} />
  if (pg.loading && !pg.items.length) return <Loading />
  if (!pg.items.length) return <Empty icon="person" title={tx("Исполнители не найдены")} />
  return (
    <>
      <Grid>
        {pg.items.map((u) => (
          <UserCard key={u.id} u={u} onActivate={() => addRecent({ type: 'user', item: u })} />
        ))}
      </Grid>
      <LoadMore active={!!pg.next} loading={pg.loading} onVisible={pg.loadMore} />
    </>
  )
}

function SearchSets({ q, albums }: { q: string; albums: boolean }): React.JSX.Element {
  const pg = usePaged<Playlist>(`s-${albums ? 'albums' : 'playlists'}-${q}`, () =>
    albums ? api.searchAlbums(q) : api.searchPlaylists(q)
  )
  if (pg.error && !pg.items.length) return <ErrorState text={pg.error} onRetry={pg.reload} />
  if (pg.loading && !pg.items.length) return <Loading />
  if (!pg.items.length) return <Empty icon={albums ? 'album' : 'queue'} title={albums ? tx("Альбомы не найдены") : tx("Плейлисты не найдены")} />
  return (
    <>
      <Grid>
        {pg.items.map((p) => (
          <PlaylistCard key={p.id} p={p} onActivate={() => addRecent({ type: 'playlist', item: p })} />
        ))}
      </Grid>
      <LoadMore active={!!pg.next} loading={pg.loading} onVisible={pg.loadMore} />
    </>
  )
}

/** A pasted soundcloud.com link: open the user/playlist page or show the track. */
function ResolveLink({ url }: { url: string }): React.JSX.Element {
  const [track, setTrack] = useState<Track | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setTrack(null)
    setError(null)
    api.resolve(url.trim()).then(
      (x) => {
        if (!alive) return
        if (x.kind === 'user') navigate({ name: 'user', id: x.id }, true)
        else if (x.kind === 'playlist') navigate(playlistRoute(x), true)
        else if (x.kind === 'track') setTrack(x)
        else setError(tx("Ссылка не ведёт на трек, исполнителя или плейлист"))
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : tx("Не удалось открыть ссылку"))
    )
    return () => {
      alive = false
    }
  }, [url])

  return (
    <div className="view">
      <h1 className="view-title">{tx("По ссылке")}</h1>
      {error ? (
        <ErrorState text={error} />
      ) : !track ? (
        <Loading />
      ) : (
        <TrackList tracks={[track]} source={{ label: track.title ?? tx("Трек") }} />
      )}
    </div>
  )
}

/** Alternates two lists (a1, b1, a2, b2, …) keeping each list's own order. */
function interleave(a: Track[], b: Track[]): Track[] {
  const out: Track[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  return out
}

