import { useEffect, useRef, useState } from 'react'
import { useProfile } from '@/lib/profile'
import { cx } from '@/lib/hooks'
import { goBack, goForward, logout, navigate, signInSoundcloud, useApp } from '@/store/app'
import { openMenuAt } from '@/store/ui'
import { ProfileAvatar } from './ProfileAvatar'
import { Icon } from './Icon'
import { installUpdate, useUpdate } from '@/lib/update'
import { tx } from '@/lib/i18n'
import { GetAppLink } from './GetApp'

export const FOCUS_SEARCH = 'sc:focus-search'

export function TopBar(): React.JSX.Element {
  const canBack = useApp((s) => s.backStack.length > 0)
  const canFwd = useApp((s) => s.fwdStack.length > 0)

  return (
    <header className="topbar" onDoubleClick={onBarDoubleClick}>
      <div className="tb-left">
        <div className="tb-nav">
          <button className="nav-btn" disabled={!canBack} onClick={goBack} aria-label={tx("Назад")} title={tx("Назад")}>
            <Icon name="chevronLeft" size={26} />
          </button>
          <button className="nav-btn" disabled={!canFwd} onClick={goForward} aria-label={tx("Вперёд")} title={tx("Вперёд")}>
            <Icon name="chevronRight" size={26} />
          </button>
        </div>
      </div>

      <div className="tb-center">
        <SearchBox />
      </div>

      <div className="tb-right">
        {/* the website offers the app; the app draws its own window buttons */}
        {__WEB__ && <GetAppLink compact />}
        <UserButton />
        {!__WEB__ && <WindowControls />}
      </div>
    </header>
  )
}

/** Double click on the bar's empty space maximises or restores the window, as a title bar does. */
function onBarDoubleClick(e: React.MouseEvent): void {
  if ((e.target as HTMLElement).closest('button,input,a')) return
  window.sc?.win?.control('maximize')
}

/** The window's own buttons: the window has no system frame, so they are drawn here. */
function WindowControls(): React.JSX.Element | null {
  const win = window.sc?.win
  const [max, setMax] = useState(false)
  useEffect(() => {
    if (!win) return
    void win.isMaximized().then(setMax)
    return win.onMaximized(setMax)
  }, [win])
  if (!win) return null
  return (
    <div className="win-controls">
      <button className="win-btn" aria-label={tx('Свернуть')} title={tx('Свернуть')} onClick={() => win.control('minimize')}>
        <WinGlyph d="M0 5.5h10" />
      </button>
      <button
        className="win-btn"
        aria-label={max ? tx('Восстановить') : tx('Развернуть')}
        title={max ? tx('Восстановить') : tx('Развернуть')}
        onClick={() => win.control('maximize')}
      >
        {max ? <WinGlyph d="M0.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2" /> : <WinGlyph d="M0.5 0.5h9v9h-9z" />}
      </button>
      <button className="win-btn win-close" aria-label={tx('Закрыть')} title={tx('Закрыть')} onClick={() => win.control('close')}>
        <WinGlyph d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
      </button>
    </div>
  )
}

/** Windows' own caption glyphs: 10 px, one-pixel lines on whole pixels, so they stay sharp. */
function WinGlyph({ d }: { d: string }): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <path d={d} />
    </svg>
  )
}

function SearchBox(): React.JSX.Element {
  const routeQ = useApp((s) => (s.route.name === 'search' ? s.route.q : null))
  const [value, setValue] = useState(routeQ ?? '')
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (routeQ === null) setValue('')
    else if (document.activeElement !== input.current) setValue(routeQ)
  }, [routeQ])

  useEffect(() => {
    const focus = (): void => {
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener(FOCUS_SEARCH, focus)
    return () => window.removeEventListener(FOCUS_SEARCH, focus)
  }, [])

  const go = (q: string, immediate = false): void => {
    window.clearTimeout(timer.current)
    const run = (): void => {
      const r = useApp.getState().route
      navigate({ name: 'search', q: q.trim(), tab: r.name === 'search' ? r.tab : undefined }, r.name === 'search')
    }
    if (immediate) run()
    else timer.current = window.setTimeout(run, 280)
  }

  return (
    <div className="search">
      <Icon name="search" size={22} className="search-icon" />
      <input
        ref={input}
        value={value}
        placeholder={tx("Трек, исполнитель, плейлист или ссылка")}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          go(e.target.value)
        }}
        onFocus={() => {
          if (useApp.getState().route.name !== 'search') go(value, true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go(value, true)
          if (e.key === 'Escape') {
            setValue('')
            go('', true)
            input.current?.blur()
          }
        }}
      />
      {value && (
        <button
          className="icon-btn search-clear"
          aria-label={tx("Очистить")}
          onClick={() => {
            setValue('')
            go('', true)
            input.current?.focus()
          }}
        >
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  )
}

/** Avatar (or a person icon without SoundCloud): profile, settings, update, sign-in / sign-out. */
function UserButton(): React.JSX.Element {
  const me = useApp((s) => s.me)
  const name = useProfile((s) => s.name)
  // primitive selectors: the menu re-renders with the download progress without a fresh object each time
  const updStatus = useUpdate((s) => s.status)
  const updVersion = useUpdate((s) => s.version ?? '')
  const updPercent = useUpdate((s) => s.percent ?? 0)
  const open = (e: React.MouseEvent<HTMLButtonElement>): void =>
    openMenuAt(e.currentTarget, [
      ...(me ? [{ label: tx('Мой профиль'), icon: 'person' as const, onSelect: () => navigate({ name: 'user', id: me.id }) }] : []),
      { label: tx('Настройки'), icon: 'settings', onSelect: () => navigate({ name: 'settings' }) },
      // the update downloads on its own; "Обновить" waits here until it's ready
      ...(updStatus === 'downloading'
        ? [{ label: tx('Скачиваю версию {0} · {1}%', updVersion, updPercent), icon: 'refresh' as const, onSelect: () => undefined, disabled: true }]
        : []),
      ...(updStatus === 'ready'
        ? [{ label: updVersion ? tx('Обновить до {0}', updVersion) : tx('Обновить'), icon: 'refresh' as const, onSelect: installUpdate }]
        : []),
      { separator: true },
      me
        ? { label: tx('Выйти'), icon: 'logout', danger: true, onSelect: () => void logout() }
        : { label: tx('Войти в SoundCloud'), icon: 'person', onSelect: () => void signInSoundcloud() }
    ])
  return (
    <button
      className="avatar-btn"
      title={updStatus === 'ready' ? tx('Есть обновление') : name || me?.username || tx('Настройки')}
      aria-label={tx('Профиль')}
      onClick={open}
    >
      <ProfileAvatar size={28} />
      {(updStatus === 'downloading' || updStatus === 'ready') && (
        <span className={cx('avatar-dot', updStatus === 'downloading' && 'downloading')} />
      )}
    </button>
  )
}
