import { openArtist, trackMenu } from '@/lib/actions'
import { trackArt } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import type { Track } from '@/lib/types'
import { closePanel, navigate } from '@/store/app'
import { player, usePlayer } from '@/store/player'
import { openMenu } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { Empty } from './States'
import { Equalizer } from './TrackList'
import { tx } from '@/lib/i18n'

const SHOW = 80
const PAST = 20

export function QueuePanel(): React.JSX.Element {
  const current = usePlayer((s) => s.current)
  const context = usePlayer((s) => s.context)
  const index = usePlayer((s) => s.index)
  const manual = usePlayer((s) => s.manual)
  const source = usePlayer((s) => s.source)
  const playing = usePlayer((s) => s.playing)
  const autoplay = usePlayer((s) => s.autoplay)
  const repeat = usePlayer((s) => s.repeat)

  const start = index + 1
  const upcoming = context.slice(start, start + SHOW)
  const hidden = Math.max(0, context.length - start - SHOW)
  // what already played in this list stays reachable (newest first)
  const pastFrom = Math.max(0, index - PAST)
  const past = context.slice(pastFrom, Math.max(0, index)).reverse()

  return (
    <aside className="queue panel">
      <div className="q-head">
        <h2 className="h3">{tx("Очередь")}</h2>
        <button className="icon-btn" onClick={closePanel} aria-label={tx("Закрыть очередь")}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="q-body scroll-y">
        {!current && <Empty icon="queue" title={tx("Очередь пуста")} text={tx('Очередь пуста')} />}

        {current && (
          <>
            <div className="q-label">{tx("Сейчас играет")}</div>
            <QueueRow track={current} current playing={playing} />
          </>
        )}

        {manual.length > 0 && (
          <>
            <div className="q-label-row">
              <span className="q-label">{tx("Далее в очереди")}</span>
              <button className="link-more" onClick={player.clearManual}>{tx("Очистить")}</button>
            </div>
            {manual.map((t, i) => (
              <QueueRow key={`m-${t.id}-${i}`} track={t} onPlay={() => player.jumpManual(i)} onRemove={() => player.removeManual(i)} />
            ))}
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <div className="q-label">{tx("Далее из: ")}<span className="q-source">{source?.label}</span>
            </div>
            {upcoming.map((t, i) => (
              <QueueRow key={`c-${t.id}-${start + i}`} track={t} onPlay={() => player.jumpContext(start + i)} />
            ))}
            {hidden > 0 && <div className="q-more">{tx("и ещё ")}{hidden}</div>}
          </>
        )}

        {past.length > 0 && (
          <>
            <div className="q-label">{tx('Недавно звучало')}</div>
            {past.map((t, i) => (
              <QueueRow key={`p-${t.id}-${i}`} track={t} past onPlay={() => player.jumpContext(index - 1 - i)} />
            ))}
          </>
        )}

        {current && source?.kind === 'wave' && (
          <div className="q-hint">
            <Icon name="wave" size={18} />
            <span>{tx('Дальше — Моя волна')}</span>
          </div>
        )}

        {current && autoplay && repeat === 'off' && !source?.next && !source?.kind && (
          <div className="q-hint">
            <Icon name="infinity" size={18} />
            <span>{tx('Дальше — похожие треки')}</span>
          </div>
        )}
      </div>
    </aside>
  )
}

interface RowProps {
  track: Track
  current?: boolean
  past?: boolean
  playing?: boolean
  onPlay?: () => void
  onRemove?: () => void
}

function QueueRow({ track, current, past, playing, onPlay, onRemove }: RowProps): React.JSX.Element {
  return (
    <div
      className={cx('q-row', current && 'current', past && 'past')}
      onDoubleClick={onPlay}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu({ x: e.clientX, y: e.clientY }, trackMenu(track))
      }}
    >
      <button className="q-art" onClick={current ? player.toggle : onPlay} aria-label={current && playing ? tx("Пауза") : tx("Слушать")}>
        <Artwork src={trackArt(track, 'large')} size={44} />
        <span className="q-art-overlay">
          {current && playing ? <Equalizer /> : <Icon name="play" size={18} />}
        </span>
      </button>
      <div className="q-text">
        <div className="q-title ellipsis">{track.title}</div>
        {track.user && (
          <button className="q-artist link ellipsis" onClick={() => openArtist(track)}>
            {track.user.username}
          </button>
        )}
      </div>
      {onRemove && (
        <button className="icon-btn q-remove" onClick={onRemove} aria-label={tx("Убрать из очереди")} title={tx("Убрать из очереди")}>
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  )
}
