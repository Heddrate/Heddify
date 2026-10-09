import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '@/lib/hooks'
import { Icon } from './Icon'
import { tx } from '@/lib/i18n'

interface Props {
  kind: string
  title: string
  art: ReactNode
  meta?: ReactNode
  color?: string | null
  image?: string | null
  round?: boolean
}

function titleSize(title: string): string {
  const n = title.length
  if (n <= 14) return 'xl'
  if (n <= 28) return 'lg'
  if (n <= 48) return 'md'
  return 'sm'
}

/** Spotify-style page header: large artwork, type label, big title, meta line. */
export function PageHeader({ kind, title, art, meta, color, image, round }: Props): React.JSX.Element {
  const style = {
    '--head-color': color || '#2b2b2b',
    ...(image ? { '--head-image': `url("${image}")` } : {})
  } as CSSProperties
  return (
    <>
      <header className={cx('page-head', image && 'with-image', round && 'round')} style={style}>
        <div className="ph-art">{art}</div>
        <div className="ph-info">
          <div className="ph-kind">{kind}</div>
          <h1 className={cx('ph-title', `size-${titleSize(title)}`)} title={title}>
            {title}
          </h1>
          {meta && <div className="ph-meta">{meta}</div>}
        </div>
      </header>
      <div className="ph-fade" style={style} />
    </>
  )
}

export function Dot(): React.JSX.Element {
  return <span className="dot">•</span>
}

interface ActionBarProps {
  playing: boolean
  onPlay: () => void
  onShuffle?: () => void
  disabled?: boolean
  children?: ReactNode
  /** Title + colour for the compact bar that sticks to the top once this bar scrolls away. */
  sticky?: { title: string; color?: string | null }
}

export function ActionBar({ playing, onPlay, onShuffle, disabled, children, sticky }: ActionBarProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  const hasSticky = !!sticky

  useEffect(() => {
    const el = ref.current
    if (!el || !hasSticky) return
    const root = el.closest('.main')
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), {
      root,
      rootMargin: '-64px 0px 0px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasSticky])

  return (
    <>
      {sticky && (
        <div className="sticky-anchor">
          <div
            className={cx('sticky-bar', stuck && 'shown')}
            style={{ '--head-color': sticky.color || '#2b2b2b' } as CSSProperties}
            aria-hidden={!stuck}
          >
            <button
              className="play-big small"
              onClick={onPlay}
              disabled={disabled}
              tabIndex={stuck ? 0 : -1}
              aria-label={playing ? tx("Пауза") : tx("Слушать")}
            >
              <Icon name={playing ? 'pause' : 'play'} size={20} />
            </button>
            <span className="sticky-title ellipsis">{sticky.title}</span>
          </div>
        </div>
      )}
      <div className="action-bar" ref={ref}>
        <button className="play-big" onClick={onPlay} disabled={disabled} aria-label={playing ? tx("Пауза") : tx("Слушать")}>
          <Icon name={playing ? 'pause' : 'play'} size={28} />
        </button>
        {onShuffle && (
          <button className="icon-btn xl" onClick={onShuffle} disabled={disabled} title={tx("Перемешать")} aria-label={tx("Перемешать")}>
            <Icon name="shuffle" size={28} />
          </button>
        )}
        {children}
      </div>
    </>
  )
}
