import { useState } from 'react'
import { toggleAnyLike, useLiked, openArtist, trackMenu } from '@/lib/actions'
import { trackArt } from '@/lib/artwork'
import { fmtTime } from '@/lib/format'
import { cx } from '@/lib/hooks'
import { navigate, toggleLike, toggleNowPlaying, toggleQueue, useApp } from '@/store/app'
import { player, usePlayer } from '@/store/player'
import { openMenu, openMenuAt } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { Slider } from './Slider'
import { tx } from '@/lib/i18n'

export function PlayerBar(): React.JSX.Element {
  return (
    <footer className="playerbar">
      <NowPlaying />
      <div className="pb-center">
        <Controls />
        <Progress />
      </div>
      <RightControls />
    </footer>
  )
}

function NowPlaying(): React.JSX.Element {
  const track = usePlayer((s) => s.current)
  // select primitives / stored references only: a fresh object here re-renders forever
  const sourceRoute = usePlayer((s) => s.source?.route)
  const fromWave = usePlayer((s) => s.source?.kind === 'wave')
  const preview = usePlayer((s) => s.preview)
  const liked = useLiked(track)

  if (!track) return <div className="pb-left" />

  const openSource = (): void => {
    if (sourceRoute) navigate(sourceRoute)
    else if (fromWave) navigate({ name: 'home' })
    else openArtist(track)
  }

  return (
    <div
      className="pb-left"
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu({ x: e.clientX, y: e.clientY }, trackMenu(track))
      }}
    >
      <button className="pb-art" onClick={toggleNowPlaying} aria-label={tx("Сейчас играет")} title={tx("Сейчас играет")}>
        <Artwork key={track.id} src={trackArt(track, 't300x300')} size={56} />
        <span className="pb-art-hint" aria-hidden>
          <Icon name="chevronDown" size={18} />
        </span>
      </button>
      <div className="pb-text">
        <button className="pb-title link ellipsis" onClick={openSource} title={track.title}>
          {track.title}
        </button>
        <div className="pb-artist-row">
          {preview && <span className="badge">{tx("превью")}</span>}
          {track.user && (
            <button className="pb-artist link ellipsis" onClick={() => openArtist(track)}>
              {track.user.username}
            </button>
          )}
        </div>
      </div>
      <button
        className={cx('icon-btn like', liked && 'on')}
        aria-label={liked ? tx("Убрать из «Мне нравится»") : tx("Мне нравится")}
        title={liked ? tx("Убрать из «Мне нравится»") : tx("Мне нравится")}
        onClick={() => toggleAnyLike(track)}
      >
        <Icon name={liked ? 'heart' : 'heartOutline'} size={20} />
      </button>
    </div>
  )
}

function Controls(): React.JSX.Element {
  const has = usePlayer((s) => !!s.current)
  const playing = usePlayer((s) => s.playing)
  const loading = usePlayer((s) => s.loading)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)

  return (
    <div className="pb-controls">
      <button
        className={cx('icon-btn toggle', shuffle && 'on')}
        onClick={player.toggleShuffle}
        aria-label={tx("Перемешать")}
        title={shuffle ? tx("Выключить перемешивание") : tx("Перемешать")}
      >
        <Icon name="shuffle" size={20} />
      </button>
      <button className="icon-btn" onClick={player.prev} disabled={!has} aria-label={tx("Предыдущий")} title={tx("Предыдущий")}>
        <Icon name="prev" size={22} />
      </button>
      <button
        className={cx('play-main', loading && playing && 'loading')}
        onClick={player.toggle}
        disabled={!has}
        aria-label={playing ? tx("Пауза") : tx("Слушать")}
        title={playing ? tx("Пауза") : tx("Слушать")}
      >
        <Icon name={playing ? 'pause' : 'play'} size={20} />
      </button>
      <button className="icon-btn" onClick={player.next} disabled={!has} aria-label={tx("Следующий")} title={tx("Следующий")}>
        <Icon name="next" size={22} />
      </button>
      <button
        className={cx('icon-btn toggle', repeat !== 'off' && 'on')}
        onClick={player.cycleRepeat}
        aria-label={tx("Повтор")}
        title={repeat === 'off' ? tx("Повторять") : repeat === 'all' ? tx("Повторять трек") : tx("Не повторять")}
      >
        <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={20} />
      </button>
    </div>
  )
}

function Progress(): React.JSX.Element {
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const buffered = usePlayer((s) => s.buffered)
  const has = usePlayer((s) => !!s.current)
  const [scrub, setScrub] = useState<number | null>(null)

  return (
    <div className={cx('pb-progress', !has && 'disabled')}>
      <span className="time">{fmtTime(scrub ?? position)}</span>
      <Slider
        value={position}
        max={duration || 1}
        buffered={buffered}
        step={5}
        label={tx("Позиция трека")}
        onScrub={setScrub}
        onCommit={player.seek}
      />
      <span className="time">{fmtTime(duration)}</span>
    </div>
  )
}

function RightControls(): React.JSX.Element {
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const autoplay = usePlayer((s) => s.autoplay)
  const queueOpen = useApp((s) => s.panel === 'queue')
  const level = muted || volume === 0 ? 'volumeOff' : volume < 0.5 ? 'volumeLow' : 'volumeHigh'

  return (
    <div className="pb-right">
      <button
        className={cx('icon-btn toggle autoplay-btn', autoplay && 'on')}
        onClick={player.toggleAutoplay}
        aria-label={tx("Автопродолжение")}
        title={autoplay ? tx("Автопродолжение: похожие треки после очереди") : tx("Автопродолжение выключено")}
      >
        <Icon name="infinity" size={20} />
      </button>
      <button
        className={cx('icon-btn toggle', queueOpen && 'on')}
        onClick={toggleQueue}
        aria-label={tx("Очередь")}
        title={tx("Очередь")}
      >
        <Icon name="queue" size={20} />
      </button>
      <div className="volume">
        <button className="icon-btn" onClick={player.toggleMute} aria-label={muted ? tx("Включить звук") : tx("Выключить звук")}>
          <Icon name={level} size={20} />
        </button>
        <Slider
          value={muted ? 0 : volume}
          max={1}
          step={0.05}
          label={tx("Громкость")}
          onChange={player.setVolume}
          onCommit={player.setVolume}
        />
      </div>
    </div>
  )
}
