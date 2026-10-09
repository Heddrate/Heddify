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
}

export function Artwork({ src, size, round, className, placeholder = 'note', letter }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  return (
    <div className={cx('art', round && 'round', className)} style={size ? { width: size, height: size } : undefined}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : letter?.trim() ? (
        <span className="art-letter">{[...letter.trim()][0].toUpperCase()}</span>
      ) : (
        <Icon name={placeholder} className="art-ph" />
      )}
    </div>
  )
}
