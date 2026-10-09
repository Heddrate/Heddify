import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '@/lib/hooks'

interface Props {
  value: number
  max: number
  /** Fired continuously while dragging. */
  onChange?: (v: number) => void
  /** Fired once when the user releases / presses a key. */
  onCommit?: (v: number) => void
  onScrub?: (v: number | null) => void
  step?: number
  buffered?: number
  label: string
  className?: string
}

export function Slider({ value, max, onChange, onCommit, onScrub, step, buffered, label, className }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)

  const shown = drag ?? value
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0
  const bufPct = max > 0 && buffered ? Math.min(100, (buffered / max) * 100) : 0

  const fromX = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * max
  }

  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || max <= 0) return
    ref.current!.setPointerCapture(e.pointerId)
    const v = fromX(e.clientX)
    setDrag(v)
    onChange?.(v)
    onScrub?.(v)
  }
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag === null) return
    const v = fromX(e.clientX)
    setDrag(v)
    onChange?.(v)
    onScrub?.(v)
  }
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag === null) return
    const v = fromX(e.clientX)
    setDrag(null)
    onScrub?.(null)
    onCommit?.(v)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const s = step ?? max / 20
    let v: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(max, value + s)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(0, value - s)
    if (v === null) return
    e.preventDefault()
    e.stopPropagation()
    onChange?.(v)
    onCommit?.(v)
  }

  return (
    <div
      ref={ref}
      className={cx('slider', drag !== null && 'dragging', className)}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div className="slider-track">
        {bufPct > 0 && <div className="slider-buffer" style={{ width: `${bufPct}%` }} />}
        <div className="slider-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="slider-thumb" style={{ left: `${pct}%` }} />
    </div>
  )
}
