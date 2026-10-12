import { useState } from 'react'
import { trackMenu } from '@/lib/actions'
import { ArtistLinks } from './ArtistLinks'
import { trackArt } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import type { Track } from '@/lib/types'
import { closePanel, navigate } from '@/store/app'
import { player, remainingCount, upcomingPositions, usePlayer } from '@/store/player'
import { openMenu } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { Empty } from './States'
import { Equalizer } from './TrackList'
import { tx } from '@/lib/i18n'

const SHOW = 80
const PAST = 20

/** A row dragged inside the manual queue: where it came from and where it would land. */
interface Drag {
  from: number
  over: number
}

export function QueuePanel(): React.JSX.Element {
  const current = usePlayer((s) => s.current)
  const context = usePlayer((s) => s.context)
  const index = usePlayer((s) => s.index)
  const plan = usePlayer((s) => s.plan)
  const history = usePlayer((s) => s.history)
  const shuffle = usePlayer((s) => s.shuffle)
  const manual = usePlayer((s) => s.manual)
  const source = usePlayer((s) => s.source)
  const playing = usePlayer((s) => s.playing)
  const [drag, setDrag] = useState<Drag | null>(null)

  // the list shows what plays next in its real order: random while shuffle is on
  const state = { context, index, plan, shuffle, source }
  const nextPos = upcomingPositions(state, SHOW)
  const upcoming = nextPos.map((i) => context[i])
  const hidden = Math.max(0, remainingCount(state) - upcoming.length)
  // what already played stays reachable, newest first: the way it played when shuffling
  const pastPos = shuffle && !source?.kind
    ? history.slice(-PAST).reverse()
    : Array.from({ length: Math.min(PAST, index) }, (_, k) => index - 1 - k)
  const past = pastPos.map((i) => context[i]).filter(Boolean)

  return (
    <aside className="queue panel">
      <div className="q-head">
        <h2 className="h3">{tx("Очередь")}</h2>
        <button className="icon-btn" onClick={closePanel} aria-label={tx("Закрыть очередь")}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="q-body scroll-y">
        {!current && <Empty icon="queue" title={tx("Очередь пуста")} text={tx('Включите что-нибудь — здесь появится, что будет дальше.')} />}

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
              <QueueRow
                key={`m-${t.id}-${i}`}
                track={t}
                onPlay={() => player.jumpManual(i)}
                onRemove={() => player.removeManual(i)}
                reorder={{
                  dragging: drag?.from === i,
                  // a line where the row will land: above it when moving up, below it when moving down
                  drop: drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'after' : 'before') : undefined,
                  onStart: (e) => {
                    e.dataTransfer.setData(QUEUE_MIME, String(i))
                    e.dataTransfer.effectAllowed = 'move'
                    setDrag({ from: i, over: i })
                  },
                  onOver: (e) => {
                    if (!drag) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (drag.over !== i) setDrag({ ...drag, over: i })
                  },
                  onDrop: (e) => {
                    if (!drag) return
                    e.preventDefault()
                    player.moveManual(drag.from, i)
                    setDrag(null)
                  },
                  onEnd: () => setDrag(null)
                }}
              />
            ))}
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <div className="q-label">{tx("Далее из: ")}<span className="q-source">{source?.label}</span>
            </div>
            {upcoming.map((t, i) => (
              <QueueRow key={`c-${t.id}-${nextPos[i]}`} track={t} onPlay={() => player.jumpContext(nextPos[i])} />
            ))}
            {hidden > 0 && <div className="q-more">{tx("и ещё ")}{hidden}</div>}
          </>
        )}

        {past.length > 0 && (
          <>
            <div className="q-label">{tx('Недавно звучало')}</div>
            {past.map((t, i) => (
              <QueueRow key={`p-${t.id}-${pastPos[i]}`} track={t} past onPlay={() => player.jumpContext(pastPos[i])} />
            ))}
          </>
        )}

      </div>
    </aside>
  )
}

/** Drag-and-drop type for reordering the manual queue (not the track type used for playlists). */
const QUEUE_MIME = 'application/x-heddify-queue'

interface Reorder {
  dragging: boolean
  drop?: 'before' | 'after'
  onStart: (e: React.DragEvent) => void
  onOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onEnd: () => void
}

interface RowProps {
  track: Track
  current?: boolean
  past?: boolean
  playing?: boolean
  onPlay?: () => void
  onRemove?: () => void
  reorder?: Reorder
}

function QueueRow({ track, current, past, playing, onPlay, onRemove, reorder }: RowProps): React.JSX.Element {
  return (
    <div
      className={cx('q-row', current && 'current', past && 'past', reorder?.dragging && 'dragging', reorder?.drop && `drop-${reorder.drop}`)}
      draggable={!!reorder}
      title={reorder ? tx('Перетащите, чтобы изменить порядок') : undefined}
      onDragStart={reorder?.onStart}
      onDragOver={reorder?.onOver}
      onDrop={reorder?.onDrop}
      onDragEnd={reorder?.onEnd}
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
        {track.user && <ArtistLinks track={track} className="q-artist ellipsis" />}
      </div>
      {onRemove && (
        <button className="icon-btn q-remove" onClick={onRemove} aria-label={tx("Убрать из очереди")} title={tx("Убрать из очереди")}>
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  )
}
