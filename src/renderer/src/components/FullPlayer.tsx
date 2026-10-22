import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { create } from 'zustand'
import { toggleAnyLike, useLiked } from '@/lib/actions'
import { trackArt, useArtColor } from '@/lib/artwork'
import { cx, useAsync } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { activeLine, fetchLyrics, peekLyrics } from '@/lib/lyrics'
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

// the words are looked up as soon as a track starts, so the full player has them the moment it opens
usePlayer.subscribe((s, prev) => {
  if (s.current && s.current.id !== prev.current?.id) void fetchLyrics(s.current).catch(() => null)
})

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

  // the next track flies in from "next up": its cover and title grow from that row into their places
  const cover = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLDivElement>(null)
  const shownId = useRef(track.id)
  useLayoutEffect(() => {
    if (shownId.current === track.id) return
    shownId.current = track.id
    const row = root.current?.querySelector<HTMLElement>(`.full-next-row[data-track="${track.id}"]`)
    if (!row || !cover.current || !title.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const art = row.querySelector<HTMLElement>('.art')
    const name = row.querySelector<HTMLElement>('.full-next-text > :first-child')
    if (art) flyFrom(cover.current, art, art.getBoundingClientRect().width / Math.max(1, cover.current.getBoundingClientRect().width))
    if (name) flyFrom(title.current, name, parseFloat(getComputedStyle(name).fontSize) / parseFloat(getComputedStyle(title.current).fontSize))
    root.current?.querySelector<HTMLElement>('.full-artist')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 260, fill: 'backwards' })
    // the small copy is gone: it is the one flying
    row.classList.add('taken')
  }, [track.id])

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
        <div key={track.id} ref={cover} className="full-cover">
          <div className="full-beat" aria-hidden />
          <Artwork src={art} letter={track.user?.username ?? track.title} />
        </div>
        <div className="full-meta">
          <div className="full-text">
            <div ref={title} className="full-title ellipsis" title={track.title}>
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

/**
 * Moves `el` from where `from` is to its own place, growing as it goes: the next track's cover and
 * title leave their row in "next up" and land on the poster. `scale` is the start size against the end.
 */
function flyFrom(el: HTMLElement, from: HTMLElement, scale: number): void {
  const a = from.getBoundingClientRect()
  const b = el.getBoundingClientRect()
  if (!b.width || !b.height || !Number.isFinite(scale) || scale <= 0) return
  el.classList.add('flying')
  const flight = el.animate(
    [
      { transformOrigin: '0 0', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${scale})` },
      { transformOrigin: '0 0', transform: 'translate(0, 0) scale(1)' }
    ],
    { duration: 760, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  )
  const land = (): void => el.classList.remove('flying')
  flight.onfinish = land
  flight.oncancel = land
}

/** Synced lyrics that follow the music; plain text; or, without words, what plays next. */
function FullLyrics({ track }: { track: Track }): React.JSX.Element {
  const res = useAsync(() => fetchLyrics(track), [track.id])
  // usually found already (looked up when the track started): shown at once, no "next up" in between
  const known = peekLyrics(track)
  const data = res.data ?? known ?? null
  const lines = data?.synced ?? null
  const index = usePlayer((s) => (lines ? activeLine(lines, s.position) : -1))
  const box = useRef<HTMLDivElement>(null)
  const placed = useRef(false)

  useEffect(() => {
    if (index < 0) return
    // the first time straight to the line being sung, then it follows smoothly
    box.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'center', behavior: placed.current ? 'smooth' : 'auto' })
    placed.current = true
  }, [index, lines])

  // still looking: an empty column rather than the list flashing up and being replaced
  if (!data && known === undefined && res.loading) return <div className="full-lyrics wait" aria-busy />

  if (lines?.length) {
    return (
      <>
        <div className="full-words">
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
        </div>
        <UpNext track={track} limit={1} />
      </>
    )
  }
  if (data?.plain) {
    return (
      <>
        <div className="full-words">
          <div className="full-lyrics plain scroll-y">{data.plain}</div>
        </div>
        <UpNext track={track} limit={1} />
      </>
    )
  }
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

function UpNext({ track, limit = 5 }: { track: Track; limit?: number }): React.JSX.Element | null {
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
    ? upcomingPositions({ context, index: current, plan, shuffle, source }, limit)
    : Array.from({ length: Math.max(0, Math.min(limit, context.length - index - 1)) }, (_, k) => index + 1 + k)
  const next = positions.map((i) => context[i]).filter(Boolean)
  if (!next.length) return null
  return (
    <div className={cx('full-next', limit === 1 && 'one')}>
      <div className="full-next-label">{tx('Далее')}</div>
      {next.map((t, i) => (
        <button
          key={`${t.id}-${i}`}
          data-track={t.id}
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
