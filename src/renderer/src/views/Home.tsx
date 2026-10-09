import { useMemo } from 'react'
import { Card, PlaylistCard, Shelf } from '@/components/Card'
import { ErrorState, LoadMore, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playOrToggle, trackMenu } from '@/lib/actions'
import { api, isPlaylist, tracksOf } from '@/lib/api'
import { trackArt } from '@/lib/artwork'
import { useAsync, usePaged } from '@/lib/hooks'
import type { PlaySource, Route, StreamItem, Track } from '@/lib/types'
import { navigate, useApp } from '@/store/app'
import { player } from '@/store/player'
import { tx } from '@/lib/i18n'
import { fetchTracks, useYa } from '@/lib/yandexApi'
import { useLibraryItems } from '@/lib/library'
import { useHistory } from '@/lib/played'
import { LibCard } from '@/components/LibCard'
import { audius, useAudius } from '@/lib/audius'

const uniq = (tracks: Track[]): Track[] => {
  const seen = new Set<number>()
  return tracks.filter((t) => !seen.has(t.id) && seen.add(t.id))
}

export function Home(): React.JSX.Element {
  // guests (no SoundCloud account) get Yandex and Audius only
  const scIn = useApp((s) => s.auth === 'in')
  const meId = useApp((s) => s.me?.id)
  // shelves open instantly with what they showed last time, then refresh
  const history = useHistory()
  const recent = useMemo(() => history.tracks.slice(0, 20), [history.tracks])
  const selections = useAsync(
    () => (scIn ? api.selections().then((r) => r.collection) : Promise.resolve([])),
    [scIn],
    scIn ? `p:selections:${meId}` : null
  )
  const stream = usePaged<StreamItem>(scIn ? `p:stream:${meId}` : null, () => api.stream())
  const streamTracks = useMemo(() => uniq(tracksOf(stream.items)), [stream.items])

  const streamSource = useMemo<PlaySource>(
    () => ({ label: tx("Лента подписок"), route: { name: 'home' }, next: stream.next }),
    [stream.next]
  )
  const recentSource: PlaySource = { label: tx("Недавно прослушанное"), route: { name: 'history' } }

  return (
    <div className="view">
      <FavoritesShelf />
      <PlaylistsShelf />
      {!scIn && (
        <>
          <AudiusShelf />
          <AudiusShelf title={tx('Андерграунд')} underground />
          <AudiusShelf title={tx('Электроника')} genre="Electronic" />
          <AudiusShelf title={tx('Хип-хоп')} genre="Hip-Hop/Rap" />
          <AudiusShelf title="Lo-Fi" genre="Lo-Fi" />
        </>
      )}

      {recent.length > 0 && (
        <Shelf title={tx("Недавно прослушанное")} onMore={() => navigate({ name: 'history' })}>
          {recent.map((t, i) => (
            <Card
              key={t.id}
              title={t.title ?? ''}
              sub={t.user?.username}
              art={trackArt(t)}
              letter={t.user?.username ?? t.title}
              onOpen={() => player.playContext(recent, i, recentSource)}
              onPlay={() => player.playContext(recent, i, recentSource)}
              menu={() => trackMenu(t)}
            />
          ))}
        </Shelf>
      )}

      {selections.data?.map((sel, i) => {
        const items = (sel.items?.collection ?? []).filter(isPlaylist)
        if (!items.length) return null
        return (
          <Shelf key={sel.urn ?? i} title={sel.title ?? tx("Подборка")}>
            {items.map((p) => (
              <PlaylistCard key={p.kind === 'playlist' ? p.id : p.urn} p={p} />
            ))}
          </Shelf>
        )
      })}

      {scIn && <AudiusShelf />}

      {scIn && (
      <section className="section">
        <div className="shelf-head">
          <h2 className="h2">{tx("Лента подписок")}</h2>
          {streamTracks.length > 0 && (
            <button className="link-more" onClick={() => playOrToggle(streamTracks, streamSource, { shuffle: true })}>{tx("Перемешать")}</button>
          )}
        </div>
        {stream.error && !streamTracks.length ? (
          <ErrorState text={stream.error} onRetry={stream.reload} />
        ) : stream.loading && !streamTracks.length ? (
          <Loading />
        ) : (
          <TrackList tracks={streamTracks} source={streamSource} head={false} />
        )}
        <LoadMore active={!!stream.next} loading={stream.loading && streamTracks.length > 0} onVisible={stream.loadMore} />
      </section>
      )}
    </div>
  )
}





/** Round-robin over several lists: one from each service in turn. */
function roundRobin<T>(...lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}


/** Recent likes from every service, mixed in one row. */
function FavoritesShelf(): React.JSX.Element | null {
  const me = useApp((s) => s.me)
  const yaIn = useYa((s) => s.status === 'in')
  const yaIds = useYa((s) => s.likeOrder.slice(0, 12).join(','))
  const au = useAudius((s) => s.likes)
  const sc = useAsync(
    () => (me ? api.likes(me.id, 12).then((r) => tracksOf(r.collection)) : Promise.resolve([])),
    [me?.id],
    me ? `p:likes12:${me.id}` : null
  )
  const ya = useAsync(
    () => (yaIn && yaIds ? fetchTracks(yaIds.split(',').map(Number)) : Promise.resolve([] as Track[])),
    [yaIn, yaIds]
  )
  const lists = useMemo(() => [sc.data ?? [], ya.data ?? [], au.slice(0, 12)], [sc.data, ya.data, au])
  const tracks = useMemo(() => uniq(roundRobin(...lists)), [lists])
  const source: PlaySource = { label: tx('Любимое'), route: { name: 'home' } }

  if (!tracks.length) return null
  return (
    <Shelf title={tx('Ваши лайки')} onMore={() => navigate({ name: 'likes' })}>
      {tracks.map((t, i) => (
        <Card
          key={t.id}
          title={t.title ?? ''}
          sub={t.user?.username}
          art={trackArt(t)}
          letter={t.user?.username ?? t.title}
          onOpen={() => player.playContext(tracks, i, source)}
          onPlay={() => player.playContext(tracks, i, source)}
          menu={() => trackMenu(t)}
        />
      ))}
    </Shelf>
  )
}

/** A row from Audius: open music, available to everyone. Trending overall by default. */
function AudiusShelf({
  title = tx('В тренде'),
  genre,
  underground
}: {
  title?: string
  genre?: string
  underground?: boolean
}): React.JSX.Element | null {
  const res = useAsync(
    () => (underground ? audius.underground() : audius.trending(genre)).then((l) => l.slice(0, 20)),
    [genre, underground],
    `p:au-${underground ? 'underground' : (genre ?? 'trending')}`
  )
  const route: Route = genre ? { name: 'audius', genre } : { name: 'audius' }
  const source: PlaySource = { label: title, route }
  const tracks = res.data ?? []
  if (!tracks.length) return null
  return (
    <Shelf title={title} onMore={() => navigate(route)}>
      {tracks.map((t, i) => (
        <Card
          key={t.id}
          title={t.title ?? ''}
          sub={t.user?.username}
          art={trackArt(t)}
          letter={t.user?.username ?? t.title}
          onOpen={() => player.playContext(tracks, i, source)}
          onPlay={() => player.playContext(tracks, i, source)}
          menu={() => trackMenu(t)}
        />
      ))}
    </Shelf>
  )
}
/** Playlists from every service in one row. */
function PlaylistsShelf(): React.JSX.Element | null {
  const items = useLibraryItems()
  if (!items.length) return null
  return (
    <Shelf title={tx('Ваши плейлисты')} onMore={() => navigate({ name: 'playlists' })}>
      {items.slice(0, 20).map((i) => (
        <LibCard key={i.key} item={i} />
      ))}
    </Shelf>
  )
}
