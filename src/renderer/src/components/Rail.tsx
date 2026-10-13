import { sameRoute } from '@/lib/actions'
import { cx } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import type { Route } from '@/lib/types'
import { navigate, useApp } from '@/store/app'
import { FOCUS_SEARCH } from './TopBar'
import { Icon, Logo, type IconName } from './Icon'

interface RailItem {
  label: string
  icon: IconName
  route?: Route
  /** Something other than a page: here, putting the cursor in the search field. */
  action?: () => void
}

/**
 * The floating icon column on the left: the main places of the app, one icon each. The library
 * list beside it is the second column; the rail itself never scrolls.
 */
export function Rail(): React.JSX.Element {
  const route = useApp((s) => s.route)
  const items: RailItem[] = [
    { label: tx('Главная'), icon: 'home', route: { name: 'home' } },
    { label: tx('Поиск'), icon: 'search', action: () => window.dispatchEvent(new Event(FOCUS_SEARCH)) },
    { label: tx('Медиатека'), icon: 'library', route: { name: 'playlists' } },
    { label: tx('Файлы'), icon: 'folder', route: { name: 'files' } },
    { label: tx('Радио'), icon: 'radio', route: { name: 'radio' } },
    { label: tx('Настройки'), icon: 'settings', route: { name: 'settings' } }
  ]
  return (
    <nav className="rail" aria-label={tx('Разделы')}>
      <div className="rail-logo" aria-hidden>
        <Logo size={34} />
      </div>
      {items.map((it) => {
        const on = !!it.route && sameRoute(route, it.route)
        return (
          <button
            key={it.label}
            className={cx('rail-btn', on && 'on')}
            title={it.label}
            aria-label={it.label}
            aria-current={on ? 'page' : undefined}
            onClick={() => (it.action ? it.action() : it.route && navigate(it.route))}
          >
            <Icon name={it.icon} size={22} />
          </button>
        )
      })}
    </nav>
  )
}
