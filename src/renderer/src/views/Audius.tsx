import { useMemo, useState } from 'react'
import { Artwork } from '@/components/Artwork'
import { Card, Grid } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { DownloadButton } from '@/components/DownloadButton'
import { ActionBar, Dot, PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playOrToggle, useIsPlayingFrom } from '@/lib/actions'
import { useArtColor } from '@/lib/artwork'
import { AUDIUS_GENRES, audius, useAudius, type AudiusTime, type AudiusUser } from '@/lib/audius'
import { countLabel, fmtCount } from '@/lib/format'
import { cx, useAsync } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import type { PlaySource, Route } from '@/lib/types'
import { navigate } from '@/store/app'

const AUDIUS_COLOR = 'hsl(0 0% 20%)'

const times = (): [AudiusTime, string][] => [
  ['week', tx('Неделя')],
  ['month', tx('Месяц')],
  ['allTime', tx('Всё время')]
]

/** Audius home: what's trending, by genre and period. */
export function AudiusView({ genre }: { genre?: string }): React.JSX.Element {
  const [time, setTime] = useState<AudiusTime>('week')
  const route: Route = genre ? { name: 'audius', genre } : { name: 'audius' }
  const res = useAsync(() => audius.trending(genre, time), [genre, time], `au-trending:${genre ?? ''}:${time}`)
  const tracks = useMemo(() => res.data ?? [], [res.data])
  const source = useMemo<PlaySource>(
    () => ({ label: genre ?? tx('В тренде'), route }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [genre]
  )
  const active = useIsPlayingFrom(route)

  return (
    <div className="view flush">
      <PageHeader
        kind={genre ? tx('В тренде') : tx('Подборка')}
        title={genre ?? tx('В тренде')}
        color={AUDIUS_COLOR}
        art={
          <div className="ph-tile">
            <Icon name="radio" size={84} />
          </div>
        }
        meta={countLabel(tracks.length, tx('трек'), tx('трека'), tx('треков'))}
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => playOrToggle(tracks, source, { shuffle: true })}
          sticky={{ title: genre ?? tx('В тренде'), color: AUDIUS_COLOR }}
        >
          <div className="action-spacer" />
          <div className="chips" role="radiogroup" aria-label={tx('Период')}>
            {times().map(([key, label]) => (
              <button key={key} role="radio" aria-checked={time === key} className={cx('chip', time === key && 'on')} onClick={() => setTime(key)}>
                {label}
              </button>
            ))}
          </div>
        </ActionBar>

        <div className="chips genre-chips" role="radiogroup" aria-label={tx('Жанр')}>
          <button role="radio" aria-checked={!genre} className={cx('chip', !genre && 'on')} onClick={() => navigate({ name: 'audius' }, true)}>
            {tx('Все жанры')}
          </button>
          {AUDIUS_GENRES.map((g) => (
            <button key={g} role="radio" aria-checked={genre === g} className={cx('chip', genre === g && 'on')} onClick={() => navigate({ name: 'audius', genre: g }, true)}>
              {g}
            </button>
          ))}
        </div>

        {res.error && !tracks.length ? (
          <ErrorState text={res.error} onRetry={res.reload} />
        ) : res.loading && !tracks.length ? (
          <Loading />
        ) : !tracks.length ? (
          <Empty icon="note" title={tx('Здесь пока пусто')} />
        ) : (
          <TrackList tracks={tracks} source={source} extra="plays" />
        )}
      </div>
    </div>
  )
}

/** Tracks liked on Audius (kept in the app, no account needed). */
export function AuLikesView(): React.JSX.Element {
  const likes = useAudius((s) => s.likes)
  const route: Route = { name: 'au-likes' }
  const source = useMemo<PlaySource>(() => ({ label: tx('Мне нравится · Audius'), route: { name: 'au-likes' } }), [])
  const active = useIsPlayingFrom(route)

  return (
    <div className="view flush">
      <PageHeader
        kind="Audius"
        title={tx('Мне нравится')}
        color={AUDIUS_COLOR}
        art={
          <div className="ph-tile au-tile">
            <Icon name="heart" size={84} />
          </div>
        }
        meta={countLabel(likes.length, tx('трек'), tx('трека'), tx('треков'))}
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!likes.length}
          onPlay={() => playOrToggle(likes, source)}
          onShuffle={() => playOrToggle(likes, source, { shuffle: true })}
          sticky={{ title: tx('Мне нравится · Audius'), color: AUDIUS_COLOR }}
        >
          <DownloadButton tracks={likes} />
        </ActionBar>
        {!likes.length ? (
          <Empty
            icon="heartOutline"
            title={tx('Здесь пока пусто')}
            text={tx('Лайкнутые треки Audius появятся здесь.')}
          />
        ) : (
          <TrackList tracks={likes} source={source} extra="none" />
        )}
      </div>
    </div>
  )
}

/** An Audius artist: popular tracks and similar artists. */
export function AuArtistView({ id }: { id: string }): React.JSX.Element {
  const user = useAsync(() => audius.user(id), [id])
  const tracks = useAsync(() => audius.userTracks(id), [id])
  const related = useAsync(() => audius.relatedArtists(id).catch(() => [] as AudiusUser[]), [id])
  const route: Route = { name: 'au-artist', id }
  const color = useArtColor(user.data?.avatar ?? null)
  const active = useIsPlayingFrom(route)
  const list = useMemo(() => tracks.data ?? [], [tracks.data])
  const source = useMemo<PlaySource>(() => ({ label: user.data?.name ?? tx('Исполнитель'), route: { name: 'au-artist', id } }), [user.data, id])

  if (user.error) return <ErrorState text={user.error} onRetry={user.reload} />
  if (!user.data) return <Loading />
  const u = user.data

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Исполнитель · Audius')}
        title={u.name}
        color={color}
        image={u.cover}
        round
        art={<Artwork src={u.avatar} round placeholder="person" />}
        meta={
          <>
            {tx('{0} подписчиков', fmtCount(u.followers))}
            <Dot />
            {countLabel(u.tracks, tx('трек'), tx('трека'), tx('треков'))}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!list.length}
          onPlay={() => playOrToggle(list, source)}
          onShuffle={() => playOrToggle(list, source, { shuffle: true })}
          sticky={{ title: u.name, color }}
        />
        <section className="section first">
          <h2 className="h2">{tx('Популярные треки')}</h2>
          {tracks.error && !list.length ? (
            <ErrorState text={tracks.error} onRetry={tracks.reload} />
          ) : !list.length && tracks.loading ? (
            <Loading />
          ) : !list.length ? (
            <Empty icon="note" title={tx('Треков пока нет')} />
          ) : (
            <TrackList tracks={list} source={source} head={false} extra="plays" />
          )}
        </section>
        {!!related.data?.length && (
          <section className="section">
            <h2 className="h2">{tx('Похожие исполнители')}</h2>
            <Grid>
              {related.data.map((a) => (
                <Card
                  key={a.id}
                  title={a.name}
                  sub={tx('{0} подписчиков', fmtCount(a.followers))}
                  art={a.avatar}
                  round
                  placeholder="person"
                  route={{ name: 'au-artist', id: a.id }}
                  onOpen={() => navigate({ name: 'au-artist', id: a.id })}
                />
              ))}
            </Grid>
          </section>
        )}
      </div>
    </div>
  )
}
