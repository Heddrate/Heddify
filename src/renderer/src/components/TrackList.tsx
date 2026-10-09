import { memo, useCallback, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { toggleAnyLike, openArtist, trackMenu } from '@/lib/actions'
import { trackArt } from '@/lib/artwork'
import { fmtCount, fmtDuration, fmtRelative } from '@/lib/format'
import { cx } from '@/lib/hooks'
import type { PlaySource, Track } from '@/lib/types'
import { navigate, toggleLike, useApp } from '@/store/app'
import { player, slim, usePlayer } from '@/store/player'
import { addToPlaylistMenuAt, TRACK_MIME } from '@/lib/playlists'
import { openMenu, openMenuAt, type MenuItem } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { tx } from '@/lib/i18n'
import { useYa } from '@/lib/yandexApi'
import { useAudius } from '@/lib/audius'
import { useRadio } from '@/lib/radio'
import { useLocal } from '@/lib/local'

interface Props {
  tracks: Track[]
  source: PlaySource
  /** What the middle column shows. */
  extra?: 'plays' | 'date' | 'none'
  dates?: (string | number | undefined)[]
  dateLabel?: string
  head?: boolean
  compact?: boolean
  /** Custom "play row i" (e.g. jump inside the running wave instead of replacing the queue). */
  onPlayIndex?: (i: number) => void
  /** Extra items for a row's menu (e.g. "remove from playlist"). */
  menuExtra?: (track: Track, index: number) => MenuItem[]
  /** Rows can be dragged to a new place (own playlists). */
  onReorder?: (from: number, to: number) => void
}

export function TrackList({
  tracks,
  source,
  extra = 'plays',
  dates,
  dateLabel = tx("Добавлено"),
  head = true,
  compact,
  onPlayIndex,
  menuExtra,
  onReorder
}: Props): React.JSX.Element {
  const currentId = usePlayer((s) => s.current?.id)
  const playing = usePlayer((s) => s.playing)
  const likes = useApp((s) => s.likes)
  const yaLikes = useYa((s) => s.likes)
  const auLikes = useAudius((s) => s.likeIds)
  const radioFavs = useRadio((s) => s.favIds)
  const fileLikes = useLocal((s) => s.likeIds)
  const unplayable = usePlayer((s) => s.unplayable)
  const drmSet = usePlayer((s) => s.drm)
  const [selected, setSelected] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ i: number; after: boolean } | null>(null)
  const dragFrom = useRef<number | null>(null)

  // every row can be dragged (onto a playlist in the sidebar); own playlists also reorder
  const onDragStart = useCallback(
    (i: number, e: DragEvent) => {
      const t = tracks[i]
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData(TRACK_MIME, JSON.stringify(slim(t)))
      e.dataTransfer.setData('text/plain', [t.title, t.user?.username].filter(Boolean).join(' — '))
      dragFrom.current = i
    },
    [tracks]
  )
  const onDragOver = useCallback(
    (i: number, e: DragEvent) => {
      if (!onReorder || dragFrom.current === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const r = e.currentTarget.getBoundingClientRect()
      const after = e.clientY > r.top + r.height / 2
      setDrop((d) => (d?.i === i && d.after === after ? d : { i, after }))
    },
    [onReorder]
  )
  const onDrop = useCallback(
    (i: number, e: DragEvent) => {
      const from = dragFrom.current
      if (!onReorder || from === null) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      let to = e.clientY > r.top + r.height / 2 ? i + 1 : i
      if (from < to) to -= 1
      if (to !== from) onReorder(from, to)
      dragFrom.current = null
      setDrop(null)
    },
    [onReorder]
  )
  const onDragEnd = useCallback(() => {
    dragFrom.current = null
    setDrop(null)
  }, [])
  // service badges only where services are mixed; a pure Audius / Yandex list needs none
  const mixed = useMemo(() => new Set(tracks.map((t) => t.origin ?? 'soundcloud')).size > 1, [tracks])

  const play = useCallback(
    (i: number) => {
      const s = usePlayer.getState()
      if (s.current?.id === tracks[i]?.id && (onPlayIndex || s.source?.label === source.label)) player.toggle()
      else if (onPlayIndex) onPlayIndex(i)
      else player.playContext(tracks, i, source)
    },
    [tracks, source, onPlayIndex]
  )

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (selected === null) return
    if (e.key === 'ArrowDown') setSelected(Math.min(tracks.length - 1, selected + 1))
    else if (e.key === 'ArrowUp') setSelected(Math.max(0, selected - 1))
    else if (e.key === 'Enter') play(selected)
    else return
    e.preventDefault()
  }

  return (
    <div className={cx('tracklist', compact && 'compact', extra === 'none' && 'no-extra')} role="grid" tabIndex={-1} onKeyDown={onKey}>
      {head && (
        <div className="tl-head" role="row">
          <div className="tr-num">#</div>
          <div>{tx("Название")}</div>
          <div className="tr-extra">{extra === 'date' ? dateLabel : extra === 'plays' ? tx("Прослушивания") : ''}</div>
          <div className="tr-like" />
          <div className="tr-dur">
            <Icon name="clock" size={16} />
          </div>
          <div className="tr-more" />
        </div>
      )}
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.id}-${i}`}
          track={t}
          index={i}
          current={t.id === currentId}
          playing={t.id === currentId && playing}
          liked={t.origin === 'local' ? fileLikes.has(t.id) : t.origin === 'radio' ? radioFavs.has(t.id) : t.origin === 'yandex' ? yaLikes.has(t.ya?.trackId ?? 0) : t.origin === 'audius' ? auLikes.has(t.id) : likes.has(t.id)}
          unavailable={unplayable.has(t.id)}
          drm={drmSet.has(t.id) || drmOnly(t)}
          selected={selected === i}
          badge={mixed}
          menuExtra={menuExtra}
          dropMark={drop?.i === i ? (drop.after ? 'after' : 'before') : null}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          extraText={
            extra === 'date' ? dateText(dates?.[i]) : extra === 'plays' ? fmtCount(t.playback_count) : ''
          }
          onPlay={play}
          onSelect={setSelected}
        />
      ))}
    </div>
  )
}

/** Only encrypted streams: SoundCloud's own player is the only one with the keys. */
const drmOnly = (t: Track): boolean => {
  const list = t.media?.transcodings
  return !t.origin && !!list?.length && list.every((x) => x.format?.protocol?.includes('encrypted'))
}

/** Dates render as "3 дня назад"; anything that isn't a date (a status label) as-is. */
const dateText = (d: string | number | undefined): string => fmtRelative(d) || (typeof d === 'string' ? d : '')

interface RowProps {
  track: Track
  index: number
  current: boolean
  playing: boolean
  liked: boolean
  unavailable: boolean
  selected: boolean
  badge: boolean
  menuExtra?: (track: Track, index: number) => MenuItem[]
  extraText: string
  dropMark: 'before' | 'after' | null
  drm: boolean
  onPlay: (i: number) => void
  onSelect: (i: number) => void
  onDragStart: (i: number, e: DragEvent) => void
  onDragOver: (i: number, e: DragEvent) => void
  onDrop: (i: number, e: DragEvent) => void
  onDragEnd: () => void
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  current,
  playing,
  liked,
  unavailable,
  selected,
  badge,
  menuExtra,
  extraText,
  dropMark,
  drm,
  onPlay,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: RowProps) {
  const blocked = track.policy === 'BLOCK'
  const stop = (e: MouseEvent): void => e.stopPropagation()

  return (
    <div
      className={cx('tr', current && 'current', selected && 'selected', (blocked || unavailable) && 'blocked', dropMark && `drop-${dropMark}`)}
      role="row"
      draggable
      onDragStart={(e) => onDragStart(index, e)}
      onDragOver={(e) => onDragOver(index, e)}
      onDrop={(e) => onDrop(index, e)}
      onDragEnd={onDragEnd}
      aria-selected={selected}
      title={
        drm
          ? tx('Играет только на сайте SoundCloud')
          : blocked
            ? tx("Недоступно в вашем регионе")
            : unavailable
              ? tx("Этот трек не воспроизводится в приложении")
              : undefined
      }
      onClick={() => onSelect(index)}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(index)
        openMenu({ x: e.clientX, y: e.clientY }, trackMenu(track, menuExtra?.(track, index)))
      }}
    >
      <div className="tr-num">
        {playing ? <Equalizer /> : <span className="tr-index">{index + 1}</span>}
        <button
          className="tr-play"
          aria-label={playing ? tx("Пауза") : tx("Слушать")}
          onClick={(e) => {
            stop(e)
            onPlay(index)
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
      </div>
      <div className="tr-main">
        <Artwork src={trackArt(track, 'large')} size={40} letter={track.user?.username ?? track.title} />
        <div className="tr-text">
          <div className="tr-title">
            {badge && track.origin === 'yandex' && (
              <span className="src-badge" title={tx("Яндекс Музыка")}>{tx("Я")}</span>
            )}
            {badge && track.origin === 'audius' && (
              <span className="src-badge" title="Audius">A</span>
            )}
            {drm && <Icon name="lock" size={14} className="tr-lock" />}
            <span className="ellipsis">{track.title}</span>
            {track.policy === 'SNIP' && <span className="badge">{tx("превью")}</span>}
          </div>
          {track.user && (
            <button
              className="tr-artist link ellipsis"
              onClick={(e) => {
                stop(e)
                openArtist(track)
              }}
            >
              {track.user.username}
            </button>
          )}
        </div>
      </div>
      <div className="tr-extra">{extraText}</div>
      <div className="tr-like">
        <button
          className="icon-btn tr-add"
          aria-label={tx('Добавить в плейлист')}
          title={tx('Добавить в плейлист')}
          onClick={(e) => {
            stop(e)
            addToPlaylistMenuAt(e.currentTarget, [track])
          }}
        >
          <Icon name="add" size={18} />
        </button>
        {(
          <button
            className={cx('icon-btn like', liked && 'on')}
            aria-label={liked ? tx("Убрать из «Мне нравится»") : tx("Мне нравится")}
            onClick={(e) => {
              stop(e)
              toggleAnyLike(track)
            }}
          >
            <Icon name={liked ? 'heart' : 'heartOutline'} size={18} />
          </button>
        )}
      </div>
      <div className="tr-dur">{fmtDuration(track.full_duration || track.duration)}</div>
      <div className="tr-more">
        <button
          className="icon-btn"
          aria-label={tx("Ещё")}
          onClick={(e) => {
            stop(e)
            onSelect(index)
            openMenuAt(e.currentTarget, trackMenu(track, menuExtra?.(track, index)))
          }}
        >
          <Icon name="more" size={18} />
        </button>
      </div>
    </div>
  )
})

export function Equalizer(): React.JSX.Element {
  return (
    <span className="eq" aria-label={tx("Играет")}>
      <i />
      <i />
      <i />
    </span>
  )
}
