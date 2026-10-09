import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '@/lib/hooks'
import { closeDialog, closeMenu, useDialog, useMenu, useToasts } from '@/store/ui'
import { tx } from '@/lib/i18n'
import { Icon } from './Icon'

export function ContextMenu(): React.JSX.Element | null {
  const { open, x, y, items } = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const nx = Math.max(8, Math.min(x, window.innerWidth - r.width - 8))
    const ny = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y
    setPos({ x: nx, y: ny })
  }, [open, x, y, items])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeMenu()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    document.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      document.removeEventListener('scroll', closeMenu, true)
    }
  }, [open])

  if (!open) return null
  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) =>
        'separator' in it ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={cx('menu-item', it.danger && 'danger')}
            disabled={it.disabled}
            role="menuitem"
            onClick={() => {
              closeMenu()
              it.onSelect()
            }}
          >
            {it.icon ? <Icon name={it.icon} size={18} /> : <span className="menu-icon-gap" />}
            <span>{it.label}</span>
          </button>
        )
      )}
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const items = useToasts((s) => s.items)
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  )
}

/** Small modal for a name or a confirmation (see askText / askConfirm in store/ui). */
export function Dialog(): React.JSX.Element | null {
  const d = useDialog()
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!d.open) return
    setValue(d.value)
    const t = setTimeout(() => input.current?.select(), 0)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [d.open, d.value])

  if (!d.open) return null
  const ok = d.kind === 'confirm' || value.trim().length > 0
  const submit = (): void => {
    if (ok) closeDialog(d.kind === 'text' ? value.trim() : 'ok')
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={d.title}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h2 className="h3">{d.title}</h2>
        {d.text && <p className="dialog-text">{d.text}</p>}
        {d.kind === 'text' && (
          <input
            ref={input}
            className="input"
            type={d.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            placeholder={d.placeholder}
            value={value}
            maxLength={d.secret ? 4000 : 100}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-text" onClick={() => closeDialog(null)}>
            {tx('Отмена')}
          </button>
          <button type="submit" className={cx('btn', d.danger ? 'btn-danger' : 'btn-primary')} disabled={!ok}>
            {d.confirm}
          </button>
        </div>
      </form>
    </div>
  )
}