import { useEffect, useState } from 'react'
import { cx } from '@/lib/hooks'
import { Icon, type IconName } from './Icon'

interface Props {
  src: string | null
  size?: number
  round?: boolean
  className?: string
  placeholder?: IconName
  /** Without an image: the first letter of this (artist name) instead of an icon. */
  letter?: string
  /** Without an image: a gradient picked from this text (a station's name), with the icon on top. */
  tone?: string
}

/** A stable hue for a piece of text, so the same station always gets the same colour. */
const hueOf = (text: string): number => {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

export function Artwork({ src, size, round, className, placeholder = 'note', letter, tone }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  const style = size ? { width: size, height: size } : undefined
  if (src && !failed) {
    return (
      <div className={cx('art', round && 'round', className)} style={style}>
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      </div>
    )
  }
  if (tone?.trim()) {
    const h = hueOf(tone.trim())
    const bg = `linear-gradient(145deg, hsl(${h} 55% 40%), hsl(${(h + 50) % 360} 60% 16%))`
    return (
      <div className={cx('art art-tone', round && 'round', className)} style={{ ...style, background: bg }}>
        <Icon name={placeholder} className="art-ph" />
      </div>
    )
  }
  return (
    <div className={cx('art', round && 'round', className)} style={style}>
      {letter?.trim() ? (
        <span className="art-letter">{[...letter.trim()][0].toUpperCase()}</span>
      ) : (
        <Icon name={placeholder} className="art-ph" />
      )}
    </div>
  )
}
