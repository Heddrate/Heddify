import { useEffect, useState } from 'react'
import { cx } from '@/lib/hooks'
import { Icon, type IconName } from './Icon'

interface Props {
  src: string | null
  size?: number
  round?: boolean
  className?: string
  placeholder?: IconName
}

export function Artwork({ src, size, round, className, placeholder = 'note' }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  return (
    <div className={cx('art', round && 'round', className)} style={size ? { width: size, height: size } : undefined}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <Icon name={placeholder} className="art-ph" />
      )}
    </div>
  )
}
