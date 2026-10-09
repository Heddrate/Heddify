import { useEffect, useRef, useState } from 'react'
import { userArt } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import { goBack, goForward, logout, navigate, signInSoundcloud, useApp } from '@/store/app'
import { openMenuAt } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { installUpdate, useUpdate } from '@/lib/update'
import { tx } from '@/lib/i18n'

export const FOCUS_SEARCH = 'sc:focus-search'

export function TopBar(): React.JSX.Element {
  const isHome = useApp((s) => s.route.name === 'home')
  const canBack = useApp((s) => s.backStack.length > 0)
  const canFwd = useApp((s) => s.fwdStack.length > 0)

  return (
    <header className="topbar">
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
        <button
          className={cx('round-btn lg', isHome && 'active')}
          onClick={() => navigate({ name: 'home' })}
          aria-label={tx("Главная")}
          title={tx("Главная")}
        >
          <Icon name={isHome ? 'homeFill' : 'home'} size={24} />
        </button>
        <SearchBox />
      </div>

      <div className="tb-right">
        <UserButton />
      </div>
    </header>
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
  const update = useUpdate((s) => (s.status === 'ready' ? (s.version ?? '') : null))
  const open = (e: React.MouseEvent<HTMLButtonElement>): void =>
    openMenuAt(e.currentTarget, [
      ...(me ? [{ label: tx('Мой профиль'), icon: 'person' as const, onSelect: () => navigate({ name: 'user', id: me.id }) }] : []),
      { label: tx('Настройки'), icon: 'settings', onSelect: () => navigate({ name: 'settings' }) },
      ...(update !== null
        ? [{ label: update ? tx('Обновить до {0}', update) : tx('Обновить'), icon: 'refresh' as const, onSelect: installUpdate }]
        : []),
      { separator: true },
      me
        ? { label: tx('Выйти'), icon: 'logout', danger: true, onSelect: () => void logout() }
        : { label: tx('Войти в SoundCloud'), icon: 'person', onSelect: () => void signInSoundcloud() }
    ])
  return (
    <button
      className="avatar-btn"
      title={update !== null ? tx('Есть обновление') : (me?.username ?? tx('Настройки'))}
      aria-label={tx('Профиль')}
      onClick={open}
    >
      {me ? <Artwork src={userArt(me, 'large')} size={32} round placeholder="person" /> : <Icon name="person" size={20} />}
      {update !== null && <span className="avatar-dot" />}
    </button>
  )
}
