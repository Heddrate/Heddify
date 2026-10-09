import type { ReactNode } from 'react'
import { playlistMenu, playlistRoute, playPlaylist, playUser, sameRoute, userMenu } from '@/lib/actions'
import { playlistArt, userArt } from '@/lib/artwork'
import { cx, useColumns } from '@/lib/hooks'
import { year } from '@/lib/format'
import type { AnyPlaylist, Route, User } from '@/lib/types'
import { navigate } from '@/store/app'
import { usePlayer } from '@/store/player'
import { openMenu, type MenuItem } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon, type IconName } from './Icon'
import { tx } from '@/lib/i18n'

interface CardProps {
  title: string
  sub?: ReactNode
  art: string | null
  /** Custom artwork element instead of an image. */
  artNode?: ReactNode
  round?: boolean
  placeholder?: IconName
  route?: Route
  onOpen: () => void
  onPlay?: () => void
  menu?: () => MenuItem[]
  /** Shows a small ✕ (e.g. remove from recent searches). */
  onRemove?: () => void
  /** No artwork: first letter of this instead of an icon. */
  letter?: string
}

export function Card({ title, sub, art, artNode, round, placeholder, route, onOpen, onPlay, menu, onRemove, letter }: CardProps): React.JSX.Element {
  const active = usePlayer((s) => s.playing && !!route && sameRoute(s.source?.route, route))
  return (
    <div
      className={cx('card', active && 'active')}
      onClick={onOpen}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault()
              openMenu({ x: e.clientX, y: e.clientY }, menu())
            }
          : undefined
      }
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="card-art">
        {artNode ?? <Artwork src={art} round={round} placeholder={placeholder} letter={letter} />}
        {onRemove && (
          <button
            className="card-remove"
            aria-label={tx("Убрать")}
            title={tx("Убрать")}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <Icon name="close" size={16} />
          </button>
        )}
        {onPlay && (
          <button
            className="play-fab"
            aria-label={active ? tx("Пауза") : tx("Слушать")}
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
          >
            <Icon name={active ? 'pause' : 'play'} size={22} />
          </button>
        )}
      </div>
      <div className="card-title ellipsis" title={title}>
        {title}
      </div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}

export function playlistKind(p: AnyPlaylist): string {
  if (p.kind === 'system-playlist') return tx("Подборка")
  const t = (p.set_type || '').toLowerCase()
  if (t === 'ep') return 'EP'
  if (t === 'single') return tx("Сингл")
  if (t === 'compilation') return tx("Сборник")
  if (p.is_album || t === 'album') return tx("Альбом")
  return tx("Плейлист")
}

interface EntityCardExtras {
  /** Called when the card is opened or played (search history). */
  onActivate?: () => void
  onRemove?: () => void
}

export function PlaylistCard({ p, sub, onActivate, onRemove }: { p: AnyPlaylist; sub?: ReactNode } & EntityCardExtras): React.JSX.Element {
  const route = playlistRoute(p)
  const fallbackSub =
    p.kind === 'system-playlist'
      ? p.short_description || p.description || 'SoundCloud'
      : [year(p.release_date || p.published_at || p.created_at), p.user?.username].filter(Boolean).join(' · ')
  return (
    <Card
      title={p.title}
      sub={sub ?? fallbackSub}
      art={playlistArt(p)}
      placeholder="queue"
      route={route}
      onOpen={() => {
        onActivate?.()
        navigate(route)
      }}
      onPlay={() => {
        onActivate?.()
        void playPlaylist(p)
      }}
      menu={() => playlistMenu(p)}
      onRemove={onRemove}
    />
  )
}

export function UserCard({ u, onActivate, onRemove }: { u: User } & EntityCardExtras): React.JSX.Element {
  const route: Route = { name: 'user', id: u.id }
  return (
    <Card
      title={u.username}
      sub={tx("Исполнитель")}
      art={userArt(u)}
      round
      placeholder="person"
      route={route}
      onOpen={() => {
        onActivate?.()
        navigate(route)
      }}
      onPlay={() => {
        onActivate?.()
        void playUser(u)
      }}
      menu={() => userMenu(u)}
      onRemove={onRemove}
    />
  )
}

interface ShelfProps {
  title: string
  onMore?: () => void
  children: ReactNode[]
  /** Render every child in a wrapping grid instead of a single row. */
  wrap?: boolean
}

/** A titled row of cards that shows as many as fit into one line. */
export function Shelf({ title, onMore, children, wrap }: ShelfProps): React.JSX.Element | null {
  const [ref, cols] = useColumns()
  if (!children.length) return null
  const shown = wrap ? children : children.slice(0, cols)
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2 className="h2">{title}</h2>
        {onMore && children.length > cols && (
          <button className="link-more" onClick={onMore}>{tx("Показать все")}</button>
        )}
      </div>
      <div ref={ref} className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown}
      </div>
    </section>
  )
}

/** Full-width wrapping grid for "all items" pages. */
export function Grid({ children }: { children: ReactNode }): React.JSX.Element {
  const [ref, cols] = useColumns()
  return (
    <div ref={ref} className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  )
}
