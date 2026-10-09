import { toggleAnyLike, useLiked, openArtist, trackMenu } from '@/lib/actions'
import { api } from '@/lib/api'
import { trackArt, userArt } from '@/lib/artwork'
import { countLabel, fmtCount } from '@/lib/format'
import { cx, useAsync } from '@/lib/hooks'
import { closePanel, navigate, toggleFollow, toggleLike, toggleLyrics, toggleQueue, useApp } from '@/store/app'
import { sleepLabel, sleepMenu, useSleep } from '@/lib/sleep'
import { player, usePlayer } from '@/store/player'
import { openMenuAt } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { Empty } from './States'
import { tx } from '@/lib/i18n'
import { activeLine, fetchLyrics } from '@/lib/lyrics'

/** Spotify-style right panel: big cover, track, the artist and what plays next. */
export function NowPlayingPanel(): React.JSX.Element {
  const track = usePlayer((s) => s.current)
  const source = usePlayer((s) => s.source)
  const upNext = usePlayer((s) => s.manual[0] ?? s.context[s.index + 1] ?? null)
  const liked = useLiked(track)
  const userId = track?.user?.id
  const artist = useAsync(() => (userId ? api.user(userId) : Promise.resolve(null)), [userId])
  const following = useApp((s) => (userId ? s.follows.has(userId) : false))
  const meId = useApp((s) => s.me?.id)
  const sleepText = sleepLabel(useSleep())

  return (
    <aside className="queue panel np">
      <div className="q-head">
        <h2 className="h3 ellipsis">{source?.label ?? tx("Сейчас играет")}</h2>
        <div className="q-head-actions">
          <button className="icon-btn" onClick={toggleLyrics} aria-label={tx('Текст песни')} title={tx('Текст песни')} disabled={!track}>
            <Icon name="mic" size={20} />
          </button>
          <button
            className={cx('icon-btn toggle', sleepText && 'on')}
            onClick={(e) => openMenuAt(e.currentTarget, sleepMenu())}
            aria-label={tx('Таймер сна')}
            title={sleepText ? tx('Таймер сна: {0}', sleepText) : tx('Таймер сна')}
          >
            <Icon name="moon" size={18} />
          </button>
          <button className="icon-btn" onClick={closePanel} aria-label={tx("Закрыть")}>
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>

      {!track ? (
        <Empty icon="nowPlaying" title={tx("Ничего не играет")} text={tx('Ничего не играет')} />
      ) : (
        <div className="q-body scroll-y np-body">
          <Artwork src={trackArt(track, 't500x500')} className="np-cover" />

          <div className="np-title-row">
            <div className="np-text">
              <div className="np-title" title={track.title}>
                {track.title}
              </div>
              {track.user && (
                <button className="link np-artist ellipsis" onClick={() => openArtist(track)}>
                  {track.user.username}
                </button>
              )}
            </div>
            <button
              className={cx('icon-btn like', liked && 'on')}
              onClick={() => toggleAnyLike(track)}
              aria-label={liked ? tx("Убрать из «Мне нравится»") : tx("Мне нравится")}
            >
              <Icon name={liked ? 'heart' : 'heartOutline'} size={22} />
            </button>
            <button className="icon-btn" onClick={(e) => openMenuAt(e.currentTarget, trackMenu(track))} aria-label={tx("Ещё")}>
              <Icon name="more" size={22} />
            </button>
          </div>

          <div className="np-stats">
            {track.playback_count != null && (
              <span>
                <Icon name="play" size={14} /> {fmtCount(track.playback_count)}
              </span>
            )}
            {track.likes_count != null && (
              <span>
                <Icon name="heart" size={14} /> {fmtCount(track.likes_count)}
              </span>
            )}
            {track.genre && <span className="np-genre">{track.genre}</span>}
          </div>

          <LyricsCard />

          {artist.data && (
            <section className="np-card np-artist-card">
              <div className="np-card-label">{tx("Об исполнителе")}</div>
              <button className="np-artist-head" onClick={() => navigate({ name: 'user', id: artist.data!.id })}>
                <Artwork src={userArt(artist.data, 't300x300')} size={56} round placeholder="person" />
                <span className="np-artist-name ellipsis">{artist.data.username}</span>
              </button>
              <div className="np-artist-meta">
                <span>{countLabel(artist.data.followers_count ?? 0, tx("подписчик"), tx("подписчика"), tx("подписчиков"))}</span>
                {artist.data.id !== meId && (
                  <button className={cx('btn btn-outline small', following && 'on')} onClick={() => void toggleFollow(artist.data!)}>
                    {following ? tx("Вы подписаны") : tx("Подписаться")}
                  </button>
                )}
              </div>
              {artist.data.description && <p className="np-desc">{artist.data.description}</p>}
            </section>
          )}

          {upNext && (
            <section className="np-card">
              <div className="np-card-head">
                <span className="np-card-label">{tx("Далее")}</span>
                <button className="link-more" onClick={toggleQueue}>{tx("Открыть очередь")}</button>
              </div>
              <button className="np-next" onClick={player.next}>
                <Artwork src={trackArt(upNext, 'large')} size={44} />
                <span className="np-next-text">
                  <span className="ellipsis">{upNext.title}</span>
                  <span className="muted ellipsis">{upNext.user?.username}</span>
                </span>
                <Icon name="next" size={18} />
              </button>
            </section>
          )}
        </div>
      )}
    </aside>
  )
}

/** A few lines of the lyrics, following the music; opens the full lyrics panel. */
function LyricsCard(): React.JSX.Element | null {
  const track = usePlayer((s) => s.current)
  const res = useAsync(() => (track ? fetchLyrics(track) : Promise.resolve(null)), [track?.id])
  const synced = res.data?.synced ?? null
  const at = usePlayer((s) => (synced ? Math.max(0, activeLine(synced, s.position)) : 0))
  const lines = synced
    ? synced.slice(at, at + 4).map((l) => l.text || '♪')
    : (res.data?.plain ?? '').split('\n').filter(Boolean).slice(0, 4)
  if (!lines.length) return null
  return (
    <button className="np-card np-lyrics" onClick={toggleLyrics}>
      <span className="np-card-label">{tx('Текст песни')}</span>
      {lines.map((l, i) => (
        <span key={`${at}-${i}`} className={cx('np-lyric', synced && i === 0 && 'on')}>
          {l}
        </span>
      ))}
    </button>
  )
}