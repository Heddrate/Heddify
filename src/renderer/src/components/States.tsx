import { useEffect, useRef } from 'react'
import { Icon, type IconName } from './Icon'
import { tx } from '@/lib/i18n'

export function Spinner({ size = 28 }: { size?: number }): React.JSX.Element {
  return <div className="spinner" style={{ width: size, height: size }} role="status" aria-label={tx("Загрузка")} />
}

export function Loading(): React.JSX.Element {
  return (
    <div className="state">
      <Spinner />
    </div>
  )
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="state">
      <p className="state-title">{tx("Не удалось загрузить")}</p>
      <p className="state-text">{text}</p>
      {onRetry && (
        <button className="btn btn-outline" onClick={onRetry}>{tx("Повторить")}</button>
      )}
    </div>
  )
}

export function Empty({ icon, title, text }: { icon: IconName; title: string; text?: string }): React.JSX.Element {
  return (
    <div className="state">
      <Icon name={icon} size={40} className="state-icon" />
      <p className="state-title">{title}</p>
      {text && <p className="state-text">{text}</p>}
    </div>
  )
}

/** Invisible sentinel that triggers `onVisible` when scrolled near. */
export function LoadMore({ active, loading, onVisible }: { active: boolean; loading: boolean; onVisible: () => void }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onVisible)
  cb.current = onVisible

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && cb.current(), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [active, loading])

  if (!active && !loading) return null
  return <div ref={ref} className="load-more">{loading && <Spinner size={22} />}</div>
}
