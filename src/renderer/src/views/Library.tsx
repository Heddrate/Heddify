import { useMemo } from 'react'
import { Card, Grid, UserCard } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { ActionBar, PageHeader } from '@/components/PageHeader'
import { DownloadButton } from '@/components/DownloadButton'
import { LibCard } from '@/components/LibCard'
import { Empty, ErrorState, LoadMore, Loading } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playOrToggle, useIsPlayingFrom } from '@/lib/actions'
import { api } from '@/lib/api'
import { countLabel } from '@/lib/format'
import { usePaged } from '@/lib/hooks'
import { useAllLikes } from '@/lib/likes'
import { useLibraryItems } from '@/lib/library'
import { clearPlayed, useHistory } from '@/lib/played'
import type { PlaySource, Route, User } from '@/lib/types'
import { navigate, useApp } from '@/store/app'
import { player } from '@/store/player'
import { toast } from '@/store/ui'
import { tx } from '@/lib/i18n'

const LIKES: Route = { name: 'likes' }
const HISTORY: Route = { name: 'history' }

const LIKES_COLOR = 'hsl(0 0% 26%)'

/** Likes from every connected service in one list. */
export function Likes(): React.JSX.Element {
  const likes = useAllLikes()
  const { tracks } = likes
  const source = useMemo<PlaySource>(() => ({ label: tx('Мне нравится'), route: LIKES }), [])
  const active = useIsPlayingFrom(LIKES)

  const everything = async (): Promise<typeof tracks> => {
    if (!likes.hasMore) return tracks
    toast(tx('Загружаю все лайки…'))
    return likes.loadAll()
  }
  const shuffleAll = async (): Promise<void> => {
    try {
      player.playContext(await everything(), 0, source, { shuffle: true })
    } catch {
      toast(tx('Не удалось загрузить лайки'))
    }
  }

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Плейлист')}
        title={tx('Мне нравится')}
        color={LIKES_COLOR}
        art={
          <div className="ph-tile accent">
            <Icon name="heart" size={84} />
          </div>
        }
        meta={countLabel(likes.total || tracks.length, tx('трек'), tx('трека'), tx('треков'))}
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => void shuffleAll()}
          sticky={{ title: tx('Мне нравится'), color: LIKES_COLOR }}
        >
          <DownloadButton tracks={tracks} loadAll={everything} />
        </ActionBar>
        {likes.error ? (
          <ErrorState text={likes.error} onRetry={likes.reload} />
        ) : likes.loading && !tracks.length ? (
          <Loading />
        ) : !tracks.length ? (
          <Empty icon="heartOutline" title={tx('Здесь пока пусто')} />
        ) : (
          <TrackList tracks={tracks} source={source} extra="date" dates={likes.dates} dateLabel={tx('Добавлено')} />
        )}
        <LoadMore active={likes.hasMore} loading={likes.loading && tracks.length > 0} onVisible={likes.loadMore} />
      </div>
    </div>
  )
}

/** Everything listened to, from every service. */
export function History(): React.JSX.Element {
  const { tracks, dates, loading } = useHistory()
  const source = useMemo<PlaySource>(() => ({ label: tx('История'), route: HISTORY }), [])
  const active = useIsPlayingFrom(HISTORY)

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Медиатека')}
        title={tx('История')}
        art={
          <div className="ph-tile">
            <Icon name="history" size={84} />
          </div>
        }
        meta={countLabel(tracks.length, tx('трек'), tx('трека'), tx('треков'))}
      />
      <div className="page-body">
        <ActionBar playing={active} disabled={!tracks.length} onPlay={() => playOrToggle(tracks, source)} sticky={{ title: tx('История') }}>
          {tracks.length > 0 && (
            <button className="btn btn-outline" onClick={clearPlayed}>
              {tx('Очистить')}
            </button>
          )}
        </ActionBar>
        {loading ? (
          <Loading />
        ) : !tracks.length ? (
          <Empty icon="history" title={tx('История пуста')} />
        ) : (
          <TrackList tracks={tracks} source={source} extra="date" dates={dates} dateLabel={tx('Прослушано')} />
        )}
      </div>
    </div>
  )
}

export function Following(): React.JSX.Element {
  const me = useApp((s) => s.me)!
  const pg = usePaged<User>(`followings-${me.id}`, () => api.followings(me.id))

  return (
    <div className="view">
      <h1 className="view-title">{tx("Подписки")}</h1>
      {pg.error && !pg.items.length ? (
        <ErrorState text={pg.error} onRetry={pg.reload} />
      ) : pg.loading && !pg.items.length ? (
        <Loading />
      ) : !pg.items.length ? (
        <Empty icon="people" title={tx("Вы ни на кого не подписаны")} />
      ) : (
        <Grid>
          {pg.items.map((u) => (
            <UserCard key={u.id} u={u} />
          ))}
        </Grid>
      )}
      <LoadMore active={!!pg.next} loading={pg.loading && pg.items.length > 0} onVisible={pg.loadMore} />
    </div>
  )
}

export function Playlists(): React.JSX.Element {
  const items = useLibraryItems()
  const likes = useAllLikes().total

  return (
    <div className="view">
      <h1 className="view-title">{tx('Медиатека')}</h1>
      <Grid>
        <Card
          title={tx('Мне нравится')}
          sub={countLabel(likes, tx('трек'), tx('трека'), tx('треков'))}
          art={null}
          artNode={
            <div className="lib-tile accent card-tile">
              <Icon name="heart" size={64} />
            </div>
          }
          route={LIKES}
          onOpen={() => navigate(LIKES)}
        />
        {items.map((i) => (
          <LibCard key={i.key} item={i} />
        ))}
      </Grid>
    </div>
  )
}
