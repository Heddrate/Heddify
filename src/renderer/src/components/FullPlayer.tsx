import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { create } from 'zustand'
import { toggleAnyLike, useLiked } from '@/lib/actions'
import { trackArt, useArtColor } from '@/lib/artwork'
import { cx, useAsync } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { activeLine, fetchLyrics } from '@/lib/lyrics'
import { syncWindowFrame } from '@/lib/theme'
import { engine } from '@/player/engine'
import { radio } from '@/lib/radio'
import type { PlaySource, Track } from '@/lib/types'
import { externalEvents, player, upcomingPositions, usePlayer } from '@/store/player'
import { ArtistLinks } from './ArtistLinks'
import { CoverBackdrop } from './Backdrop'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { Controls, Progress, VolumeControl } from './PlayerBar'

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
    // the title bar buttons sit on the dark full-window player, not on the theme's colour
    window.sc?.setWindowTheme({ bg: '#0b0b0b', symbol: '#f2f2f2' })
    // and the player covers the taskbar too: the window goes full screen while it's open
    window.sc?.setFullScreen(true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.sc?.setFullScreen(false)
      syncWindowFrame()
    }
  }, [on])

  if (!on || !track) return null
  return <FullView />
}

function FullView(): React.JSX.Element {
  const track = usePlayer((s) => s.current)!
  const art = trackArt(track, 't500x500')
  const color = useArtColor(art) ?? 'hsl(0 0% 24%)'
  const liked = useLiked(track)
  // the right side shows `panel`: it leaves with an animation when the track changes, then the new track's lyrics or next tracks come in
  const [panel, setPanel] = useState(track)
  const [leaving, setLeaving] = useState(false)
  // the bass drives the glow around the cover: a quick rise on a kick, a slow fall after it
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let level = 0
    let shown = ''
    const tick = (): void => {
      const target = externalEvents.active() ? externalEvents.glow() : engine.bass()
      level += (target - level) * (target > level ? 0.6 : 0.12)
      // write the style only when the value changes (with the effect off it stays at 0)
      const next = level.toFixed(3)
      if (next !== shown) {
        shown = next
        root.current?.style.setProperty('--bass', next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (panel.id === track.id) return
    setLeaving(true)
    const t = window.setTimeout(() => {
      setPanel(track)
      setLeaving(false)
    }, 280)
    return () => window.clearTimeout(t)
  }, [track, panel.id])

  return (
    <div ref={root} className="full-player" style={{ '--full-color': color } as CSSProperties} role="dialog" aria-label={tx('Сейчас играет')}>
      <CoverBackdrop art={art} />
      <div className="full-pulse" aria-hidden />
      <button className="icon-btn full-close" onClick={closeFull} aria-label={tx('Свернуть')} title={tx('Свернуть')}>
        <Icon name="chevronDown" size={30} />
      </button>
      <div className="full-left">
        <div key={track.id} className="full-cover">
          <div className="full-beat" aria-hidden />
          <Artwork src={art} letter={track.user?.username ?? track.title} />
        </div>
        <div className="full-meta">
          <div className="full-text">
            <div className="full-title ellipsis" title={track.title}>
              {track.title}
            </div>
            {track.user && <ArtistLinks track={track} className="full-artist ellipsis" onOpen={closeFull} />}
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
        <div className="full-volume">
          <VolumeControl />
        </div>
      </div>
      <div className={cx('full-right', leaving && 'leaving')}>
        {panel.radio ? <StationsMore key={panel.id} track={panel} /> : <FullLyrics key={panel.id} track={panel} />}
      </div>
    </div>
  )
}

/** Synced lyrics that follow the music; plain text; or, without words, what plays next. */
function FullLyrics({ track }: { track: Track }): React.JSX.Element {
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
          <button
            key={i}
            data-i={i}
            className={cx('full-line', i === index && 'on', i < index && 'past')}
            style={{ '--i': Math.min(i, 14) } as CSSProperties}
            onClick={() => player.seek(l.t)}
          >
            {l.text || '♪'}
          </button>
        ))}
      </div>
    )
  }
  if (res.data?.plain) return <div className="full-lyrics plain scroll-y">{res.data.plain}</div>
  return <UpNext track={track} />
}

/** A radio station has no "next": the panel offers other stations of the same genre instead. */
function StationsMore({ track }: { track: Track }): React.JSX.Element | null {
  const genre = track.genre ?? ''
  const res = useAsync(() => (genre ? radio.byTag(genre) : radio.top()), [track.id], `p:radio-more:${genre}`)
  const list = (res.data ?? []).filter((t) => t.id !== track.id)
  if (!list.length) return null
  const source: PlaySource = { label: tx('Радио · {0}', genre || tx('Похожие станции')), route: { name: 'radio' } }
  return (
    <div className="full-next">
      <div className="full-next-label">{tx('Похожие станции')}</div>
      {list.slice(0, 8).map((t, i) => (
        <button key={t.id} className="full-next-row" style={{ '--i': i } as CSSProperties} onClick={() => player.playContext(list, i, source)}>
          <Artwork src={trackArt(t, 'large')} size={48} tone={t.title} placeholder="radio" />
          <span className="full-next-text">
            <span className="ellipsis">{t.title}</span>
            <span className="ellipsis muted">{t.user?.username}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function UpNext({ track }: { track: Track }): React.JSX.Element | null {
  const context = usePlayer((s) => s.context)
  const current = usePlayer((s) => s.index)
  const plan = usePlayer((s) => s.plan)
  const shuffle = usePlayer((s) => s.shuffle)
  const source = usePlayer((s) => s.source)
  const isCurrent = usePlayer((s) => s.current?.id === track.id)
  // the track's own place in the list (the store's index may already point at the next one)
  const index = context[current]?.id === track.id ? current : context.findIndex((t) => t.id === track.id)
  if (index < 0) return null
  const positions = isCurrent
    ? upcomingPositions({ context, index: current, plan, shuffle, source }, 5)
    : Array.from({ length: Math.min(5, context.length - index - 1) }, (_, k) => index + 1 + k)
  const next = positions.map((i) => context[i]).filter(Boolean)
  if (!next.length) return null
  return (
    <div className="full-next">
      <div className="full-next-label">{tx('Далее')}</div>
      {next.map((t, i) => (
        <button
          key={`${t.id}-${i}`}
          className="full-next-row"
          style={{ '--i': i } as CSSProperties}
          onClick={() => player.jumpContext(positions[i])}
        >
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
