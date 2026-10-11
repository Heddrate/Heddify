import { useEffect, useRef, type CSSProperties } from 'react'
import { create } from 'zustand'
import { openArtist, toggleAnyLike, useLiked } from '@/lib/actions'
import { trackArt, useArtColor } from '@/lib/artwork'
import { cx, useAsync } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { activeLine, fetchLyrics } from '@/lib/lyrics'
import { player, usePlayer } from '@/store/player'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { Controls, Progress } from './PlayerBar'

/** Full-window "now playing": big cover, the cover's colour behind it, lyrics or what's next. */
export const useFull = create<{ on: boolean }>(() => ({ on: false }))
export const toggleFull = (): void => useFull.setState({ on: !useFull.getState().on })
export const closeFull = (): void => useFull.setState({ on: false })

export function FullPlayer(): React.JSX.Element | null {
  const on = useFull((s) => s.on)
  const track = usePlayer((s) => s.current)

  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeFull()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on])

  if (!on || !track) return null
  return <FullView />
}

function FullView(): React.JSX.Element {
  const track = usePlayer((s) => s.current)!
  const art = trackArt(track, 't500x500')
  const color = useArtColor(art) ?? 'hsl(0 0% 24%)'
  const liked = useLiked(track)

  return (
    <div className="full-player" style={{ '--full-color': color } as CSSProperties} role="dialog" aria-label={tx('Сейчас играет')}>
      <button className="icon-btn full-close" onClick={closeFull} aria-label={tx('Свернуть')} title={tx('Свернуть')}>
        <Icon name="chevronDown" size={30} />
      </button>
      <div className="full-left">
        <div className="full-cover">
          <Artwork src={art} letter={track.user?.username ?? track.title} />
        </div>
        <div className="full-meta">
          <div className="full-text">
            <div className="full-title ellipsis" title={track.title}>
              {track.title}
            </div>
            {track.user && (
              <button
                className="full-artist link ellipsis"
                onClick={() => {
                  closeFull()
                  openArtist(track)
                }}
              >
                {track.user.username}
              </button>
            )}
          </div>
          <button
            className={cx('icon-btn xl like', liked && 'on')}
            onClick={() => toggleAnyLike(track)}
            aria-label={liked ? tx('Убрать из «Мне нравится»') : tx('Мне нравится')}
          >
            <Icon name={liked ? 'heart' : 'heartOutline'} size={30} />
          </button>
        </div>
        <Progress />
        <Controls />
      </div>
      <div className="full-right">
        <FullLyrics />
      </div>
    </div>
  )
}

/** Synced lyrics that follow the music; plain text; or, without words, what plays next. */
function FullLyrics(): React.JSX.Element {
  const track = usePlayer((s) => s.current)!
  const res = useAsync(() => fetchLyrics(track), [track.id])
  const lines = res.data?.synced ?? null
  const index = usePlayer((s) => (lines ? activeLine(lines, s.position) : -1))
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (index < 0) return
    box.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [index])

  if (lines?.length) {
    return (
      <div ref={box} className="full-lyrics scroll-y">
        {lines.map((l, i) => (
          <button key={i} data-i={i} className={cx('full-line', i === index && 'on', i < index && 'past')} onClick={() => player.seek(l.t)}>
            {l.text || '♪'}
          </button>
        ))}
      </div>
    )
  }
  if (res.data?.plain) return <div className="full-lyrics plain scroll-y">{res.data.plain}</div>
  return <UpNext />
}

function UpNext(): React.JSX.Element | null {
  const context = usePlayer((s) => s.context)
  const index = usePlayer((s) => s.index)
  const next = context.slice(index + 1, index + 6)
  if (!next.length) return null
  return (
    <div className="full-next">
      <div className="full-next-label">{tx('Далее')}</div>
      {next.map((t, i) => (
        <button key={`${t.id}-${i}`} className="full-next-row" onClick={() => player.jumpContext(index + 1 + i)}>
          <Artwork src={trackArt(t, 'large')} size={48} letter={t.user?.username ?? t.title} />
          <span className="full-next-text">
            <span className="ellipsis">{t.title}</span>
            <span className="ellipsis muted">{t.user?.username}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
