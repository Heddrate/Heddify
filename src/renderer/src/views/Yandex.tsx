import { useEffect, useMemo, useState } from 'react'
import { Artwork } from '@/components/Artwork'
import { Icon } from '@/components/Icon'
import { ActionBar, Dot, PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, LoadMore, Loading, Spinner } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { openArtist, sameRoute } from '@/lib/actions'
import { trackArt, useArtColor } from '@/lib/artwork'
import { countLabel, fmtTotal } from '@/lib/format'
import { cx, useAsync } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import type { PlaySource, Route, Track } from '@/lib/types'
import { dislikeYandex, startYandexWave, useYaWave, warmYandexWave, yaWaveSource } from '@/lib/yandex'
import { fetchAlbum, fetchArtist, fetchPlaylist, fetchTracks, loginYandex, toggleYaLike, useYa, type YaAlbum } from '@/lib/yandexApi'
import { Card, Grid } from '@/components/Card'
import { navigate } from '@/store/app'
import { player, usePlayer } from '@/store/player'

const LIKES_ROUTE: Route = { name: 'ya-likes' }

/** Shown when the Yandex session isn't signed in yet. */
function YaSignIn(): React.JSX.Element {
  const status = useYa((s) => s.status)
  return (
    <div className="view">
      <div className="state">
        <div className="ya-mark big">Я</div>
        <p className="state-title">{status === 'unknown' ? tx('Подключаюсь к Яндекс Музыке…') : tx('Войдите в Яндекс Музыку')}</p>
        <p className="state-text">
          {tx('Войдите своим аккаунтом Яндекса')}
        </p>
        {status === 'unknown' ? (
          <Spinner />
        ) : (
          <button className="btn btn-primary" onClick={() => void loginYandex()}>
            {tx('Открыть вход в Яндекс')}
          </button>
        )}
      </div>
    </div>
  )
}

const playlistSource = (title: string, route: Route): PlaySource => ({ label: title, route })

function playOrToggle(tracks: Track[], source: PlaySource, shuffle?: boolean): void {
  const s = usePlayer.getState()
  if (!shuffle && source.route && sameRoute(s.source?.route, source.route) && s.current) player.toggle()
  else player.playContext(tracks, 0, source, shuffle ? { shuffle: true } : {})
}

/* ---------- Мне нравится (Яндекс) ---------- */

const PAGE = 100

export function YaLikesView(): React.JSX.Element {
  const status = useYa((s) => s.status)
  const order = useYa((s) => s.likeOrder)
  const name = useYa((s) => s.name)
  const [count, setCount] = useState(PAGE)
  const ids = useMemo(() => order.slice(0, count), [order, count])
  const res = useAsync(() => (ids.length ? fetchTracks(ids) : Promise.resolve([] as Track[])), [ids.join(',')])
  const tracks = useMemo(() => res.data ?? [], [res.data])
  const source = useMemo(() => playlistSource(tx('Мне нравится · Яндекс'), LIKES_ROUTE), [])
  const active = usePlayer((s) => s.playing && sameRoute(s.source?.route, LIKES_ROUTE))

  if (status !== 'in') return <YaSignIn />

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Яндекс Музыка')}
        title={tx('Мне нравится')}
        color="hsl(48 30% 22%)"
        art={
          <div className="ph-tile ya-tile">
            <Icon name="heart" size={84} />
          </div>
        }
        meta={
          <>
            {name && <strong>{name}</strong>}
            {name && <Dot />}
            {countLabel(order.length, tx('трек'), tx('трека'), tx('треков'))}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => playOrToggle(tracks, source, true)}
          sticky={{ title: tx('Мне нравится · Яндекс'), color: 'hsl(48 30% 22%)' }}
        />
        {res.error && !tracks.length ? (
          <ErrorState text={res.error} onRetry={res.reload} />
        ) : res.loading && !tracks.length ? (
          <Loading />
        ) : !tracks.length ? (
          <Empty icon="heartOutline" title={tx('Здесь пока пусто')} text={tx('Лайкайте треки в Яндекс Музыке — они появятся тут.')} />
        ) : (
          <TrackList tracks={tracks} source={source} extra="none" />
        )}
        <LoadMore active={order.length > count && !res.loading} loading={res.loading && tracks.length > 0} onVisible={() => setCount((c) => c + PAGE)} />
      </div>
    </div>
  )
}

/* ---------- плейлист Яндекса ---------- */

export function YaPlaylistView({ uid, kind }: { uid: number; kind: number }): React.JSX.Element {
  const status = useYa((s) => s.status)
  const res = useAsync(() => fetchPlaylist(uid, kind), [uid, kind])
  const route: Route = { name: 'ya-playlist', uid, kind }
  const color = useArtColor(res.data?.cover ?? null)
  const active = usePlayer((s) => s.playing && sameRoute(s.source?.route, route))
  const source = useMemo(() => playlistSource(res.data?.title ?? tx('Плейлист'), { name: 'ya-playlist', uid, kind }), [res.data, uid, kind])

  if (status !== 'in') return <YaSignIn />
  if (res.error) return <ErrorState text={res.error} onRetry={res.reload} />
  if (!res.data) return <Loading />
  const { title, cover, tracks } = res.data
  const total = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0)

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Плейлист')}
        title={title}
        color={color}
        art={<Artwork src={cover} placeholder="queue" />}
        meta={
          <>
            {countLabel(tracks.length, tx('трек'), tx('трека'), tx('треков'))}
            {total > 0 && <span className="muted">, {fmtTotal(total)}</span>}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => playOrToggle(tracks, source, true)}
          sticky={{ title, color }}
        />
        {!tracks.length ? <Empty icon="queue" title={tx('В плейлисте нет треков')} /> : <TrackList tracks={tracks} source={source} extra="none" />}
      </div>
    </div>
  )
}

/* ---------- Моя волна Яндекса ---------- */

export function YaWaveView(): React.JSX.Element {
  const status = useYa((s) => s.status)
  const starting = useYaWave((s) => s.starting)
  const history = useYaWave((s) => s.history)
  const current = usePlayer((s) => (s.source?.route?.name === 'ya-wave' ? s.current : null))
  const playing = usePlayer((s) => s.playing && s.source?.route?.name === 'ya-wave')
  const liked = useYa((s) => (current?.ya ? s.likes.has(current.ya.trackId) : false))
  const [error, setError] = useState<string | null>(null)
  const artUrl = current ? trackArt(current, 't500x500') : null
  const color = useArtColor(artUrl)
  const head = color ?? 'hsl(0 0% 22%)'

  useEffect(() => setError(null), [current?.id])
  // get the hidden page onto the wave player while the user looks at this screen
  useEffect(() => {
    if (status === 'in') void warmYandexWave()
  }, [status])

  if (status !== 'in') return <YaSignIn />

  const start = (): void => {
    if (current) return player.toggle()
    setError(null)
    startYandexWave().catch((e: unknown) => setError(e instanceof Error ? e.message : tx('ошибка')))
  }

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Яндекс Музыка')}
        title={tx('Моя волна')}
        color={head}
        art={
          current ? (
            <Artwork src={artUrl} />
          ) : (
            <div className="ph-tile ya-tile">
              <Icon name="wave" size={104} />
            </div>
          )
        }
        meta={
          current ? (
            <span className="wave-now">
              {tx('Сейчас: ')}
              <strong>{current.title}</strong>
              <span className="dot">•</span>
              <button className="link" onClick={() => openArtist(current)}>
                {current.user?.username}
              </button>
            </span>
          ) : (
            ''
          )
        }
      />
      <div className="page-body">
        <ActionBar playing={playing} onPlay={start} disabled={starting} sticky={{ title: tx('Моя волна · Яндекс'), color: head }}>
          {current && (
            <>
              <button
                className={cx('icon-btn xl like', liked && 'on')}
                onClick={() => void toggleYaLike(current)}
                aria-label={tx('Мне нравится')}
                title={tx('Мне нравится')}
              >
                <Icon name={liked ? 'heart' : 'heartOutline'} size={30} />
              </button>
              <button className="icon-btn xl" onClick={dislikeYandex} aria-label={tx('Не нравится')} title={tx('Не нравится')}>
                <Icon name="thumbDown" size={26} />
              </button>
              <button className="icon-btn xl" onClick={player.next} aria-label={tx('Следующий')} title={tx('Следующий')}>
                <Icon name="next" size={26} />
              </button>
            </>
          )}
          {starting && <Spinner size={22} />}
        </ActionBar>

        {error && <p className="login-error">{error}</p>}

        {!current && !starting && (
          <Empty icon="wave" title={tx('Нажмите «Слушать»')} />
        )}

        {history.length > 0 && (
          <section className="section first">
            <h2 className="h2">{tx('Уже звучало')}</h2>
            <TrackList tracks={history} source={yaWaveSource()} head={false} extra="none" onPlayIndex={(i) => player.playNow(history[i])} />
          </section>
        )}
      </div>
    </div>
  )
}

/* ---------- исполнитель и альбом Яндекса ---------- */

function AlbumCards({ albums }: { albums: YaAlbum[] }): React.JSX.Element {
  return (
    <Grid>
      {albums.map((a) => (
        <Card
          key={a.id}
          title={a.title}
          sub={[a.year, a.artist].filter(Boolean).join(' · ')}
          art={a.cover}
          placeholder="album"
          route={{ name: 'ya-album', id: a.id }}
          onOpen={() => navigate({ name: 'ya-album', id: a.id })}
          onPlay={() =>
            void fetchAlbum(a.id).then((full) =>
              playOrToggle(full.tracks, playlistSource(full.title, { name: 'ya-album', id: a.id }))
            )
          }
        />
      ))}
    </Grid>
  )
}

export function YaArtistView({ id }: { id: number }): React.JSX.Element {
  const status = useYa((s) => s.status)
  const res = useAsync(() => fetchArtist(id), [id])
  const route: Route = { name: 'ya-artist', id }
  const color = useArtColor(res.data?.cover ?? null)
  const active = usePlayer((s) => s.playing && sameRoute(s.source?.route, route))
  const source = useMemo(() => playlistSource(res.data?.name ?? tx('Исполнитель'), { name: 'ya-artist', id }), [res.data, id])
  const [expanded, setExpanded] = useState(false)

  if (status !== 'in') return <YaSignIn />
  if (res.error) return <ErrorState text={res.error} onRetry={res.reload} />
  if (!res.data) return <Loading />
  const { name, cover, tracks, albums } = res.data

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Исполнитель')}
        title={name}
        color={color}
        round
        art={<Artwork src={cover} round placeholder="person" />}
        meta={countLabel(albums.length, tx('альбом'), tx('альбома'), tx('альбомов'))}
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => playOrToggle(tracks, source, true)}
          sticky={{ title: name, color }}
        />
        <section className="section first">
          <h2 className="h2">{tx('Популярные треки')}</h2>
          {!tracks.length ? (
            <Empty icon="note" title={tx('Треков пока нет')} />
          ) : (
            <>
              <TrackList tracks={expanded ? tracks : tracks.slice(0, 5)} source={source} head={false} extra="none" />
              {tracks.length > 5 && (
                <button className="link-more pad" onClick={() => setExpanded(!expanded)}>
                  {expanded ? tx('Свернуть') : tx('Ещё')}
                </button>
              )}
            </>
          )}
        </section>
        {albums.length > 0 && (
          <section className="section">
            <h2 className="h2">{tx('Альбомы')}</h2>
            <AlbumCards albums={albums} />
          </section>
        )}
      </div>
    </div>
  )
}

export function YaAlbumView({ id }: { id: number }): React.JSX.Element {
  const status = useYa((s) => s.status)
  const res = useAsync(() => fetchAlbum(id), [id])
  const route: Route = { name: 'ya-album', id }
  const color = useArtColor(res.data?.cover ?? null)
  const active = usePlayer((s) => s.playing && sameRoute(s.source?.route, route))
  const source = useMemo(() => playlistSource(res.data?.title ?? tx('Альбом'), { name: 'ya-album', id }), [res.data, id])

  if (status !== 'in') return <YaSignIn />
  if (res.error) return <ErrorState text={res.error} onRetry={res.reload} />
  if (!res.data) return <Loading />
  const { title, cover, tracks, artist, year } = res.data
  const total = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0)
  const first = tracks[0]

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Альбом · Яндекс Музыка')}
        title={title}
        color={color}
        art={<Artwork src={cover} placeholder="album" />}
        meta={
          <>
            {first ? (
              <button className="link" onClick={() => openArtist(first)}>
                <strong>{artist}</strong>
              </button>
            ) : (
              <strong>{artist}</strong>
            )}
            {year && (
              <>
                <Dot />
                {year}
              </>
            )}
            <Dot />
            {countLabel(tracks.length, tx('трек'), tx('трека'), tx('треков'))}
            {total > 0 && <span className="muted">, {fmtTotal(total)}</span>}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => playOrToggle(tracks, source, true)}
          sticky={{ title, color }}
        />
        {!tracks.length ? <Empty icon="album" title={tx('Треков нет')} /> : <TrackList tracks={tracks} source={source} extra="none" />}
      </div>
    </div>
  )
}