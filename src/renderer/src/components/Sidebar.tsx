import { useState, type ReactNode } from 'react'
import { playlistMenu, sameRoute } from '@/lib/actions'
import { countLabel } from '@/lib/format'
import { cx } from '@/lib/hooks'
import { useWaveActive, useWavePlaying } from '@/lib/wave'
import type { Route } from '@/lib/types'
import { navigate, useApp } from '@/store/app'
import { usePlayer } from '@/store/player'
import { openMenu } from '@/store/ui'
import { Artwork } from './Artwork'
import { Icon } from './Icon'
import { tx } from '@/lib/i18n'
import { useYa } from '@/lib/yandexApi'
import { useAudius } from '@/lib/audius'
import { addToPlaylist, createPlaylist, draggedTrack, TRACK_MIME } from '@/lib/playlists'
import { isAlbumItem, libArt, libRoute, libSub, libTitle, useLibraryItems } from '@/lib/library'
import { Collage } from '@/views/Local'
import { useLocal } from '@/lib/local'

type Filter = 'all' | 'playlists' | 'albums'

const tracks = (n: number): string => countLabel(n, tx('трек'), tx('трека'), tx('треков'))

/** One library for every service: no per-service sections. */
export function Sidebar(): React.JSX.Element {
  const route = useApp((s) => s.route)
  const playingRoute = usePlayer((s) => (s.playing ? s.source?.route : undefined))
  const [filter, setFilter] = useState<Filter>('all')
  const scIn = useApp((s) => s.auth === 'in')
  const scLoaded = useApp((s) => s.libraryLoaded)
  const followings = useApp((s) => s.me?.followings_count ?? 0)
  const likes = useApp((s) => s.likes.size) + useYa((s) => s.likeOrder.length) + useAudius((s) => s.likes.length)
  const yaStatus = useYa((s) => s.status)
  const waveActive = useWaveActive()
  const wavePlaying = useWavePlaying()
  const all = useLibraryItems()
  const fileCount = useLocal((s) => s.tracks.length)
  const [dropKey, setDropKey] = useState<string | null>(null)

  const items = all.filter((i) => filter === 'all' || (filter === 'albums') === isAlbumItem(i))
  const row = (r: Route) => ({ active: sameRoute(route, r), playing: sameRoute(playingRoute, r), onClick: () => navigate(r) })
  const tile = (icon: Parameters<typeof Icon>[0]['name'], cls = '') => (
    <div className={cx('lib-tile', cls)}>
      <Icon name={icon} size={22} />
    </div>
  )
  const missing = [!scIn && 'SoundCloud', yaStatus === 'out' && tx('Яндекс Музыка')].filter(Boolean).join(', ')

  return (
    <aside className="sidebar panel">
      <div className="sb-head">
        <button className="sb-title" onClick={() => navigate({ name: 'playlists' })}>
          <Icon name="library" size={24} />
          <span>{tx('Медиатека')}</span>
        </button>
        <button className="icon-btn" title={tx('Создать плейлист')} aria-label={tx('Создать плейлист')} onClick={() => void createPlaylist()}>
          <Icon name="add" size={22} />
        </button>
      </div>

      <div className="chips sb-chips">
        {(
          [
            ['all', tx('Всё')],
            ['playlists', tx('Плейлисты')],
            ['albums', tx('Альбомы')]
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button key={key} className={cx('chip', filter === key && 'on')} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="sb-list scroll-y">
        {filter === 'all' && (
          <>
            <LibRow
              {...row({ name: 'wave' })}
              art={tile('wave', 'wave-tile')}
              title={tx('Моя волна')}
              sub={waveActive ? (wavePlaying ? tx('Играет сейчас') : tx('На паузе')) : tx('Микс из ваших сервисов')}
            />
            <LibRow {...row({ name: 'likes' })} art={tile('heart', 'accent')} title={tx('Мне нравится')} sub={tx('Плейлист · {0}', tracks(likes))} />
            <LibRow {...row({ name: 'history' })} art={tile('history')} title={tx('История')} sub={tx('Недавно прослушанное')} />
            <LibRow
              {...row({ name: 'files' })}
              art={tile('folder')}
              title={tx('Файлы на компьютере')}
              sub={fileCount ? tracks(fileCount) : tx('Добавьте папку с музыкой')}
            />
            {scIn && (
              <LibRow
                {...row({ name: 'following' })}
                art={tile('people')}
                title={tx('Подписки')}
                sub={countLabel(followings, tx('исполнитель'), tx('исполнителя'), tx('исполнителей'))}
              />
            )}
          </>
        )}

        {items.map((i) => {
          const r = libRoute(i)
          const art = libArt(i)
          return (
            <LibRow
              key={i.key}
              {...row(r)}
              art={i.type === 'local' ? <Collage list={i.list} size={48} /> : <Artwork src={art} size={48} placeholder="queue" />}
              title={libTitle(i)}
              sub={libSub(i)}
              dropping={dropKey === i.key}
              onDragOver={
                i.type === 'local'
                  ? (e) => {
                      if (!e.dataTransfer.types.includes(TRACK_MIME)) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                      setDropKey(i.key)
                    }
                  : undefined
              }
              onDragLeave={() => setDropKey((k) => (k === i.key ? null : k))}
              onDrop={
                i.type === 'local'
                  ? (e) => {
                      e.preventDefault()
                      setDropKey(null)
                      const t = draggedTrack(e)
                      if (t) addToPlaylist(i.list.id, [t])
                    }
                  : undefined
              }
              onContextMenu={
                i.type === 'sc'
                  ? (e) => {
                      e.preventDefault()
                      openMenu({ x: e.clientX, y: e.clientY }, playlistMenu(i.p))
                    }
                  : undefined
              }
            />
          )
        })}

        {filter === 'all' && !all.some((i) => i.type === 'local') && (
          <LibRow
            active={false}
            playing={false}
            onClick={() => void createPlaylist()}
            art={tile('add', 'dashed')}
            title={tx('Создать плейлист')}
            sub={tx('Треки из всех сервисов вместе')}
          />
        )}

        {scIn &&
          !scLoaded &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="lib-row skeleton">
              <div className="sk sk-art" />
              <div className="lib-text">
                <div className="sk sk-line" />
                <div className="sk sk-line short" />
              </div>
            </div>
          ))}

        {filter !== 'all' && !items.length && (
          <p className="sb-empty">{filter === 'albums' ? tx('Сохранённых альбомов нет') : tx('Плейлистов нет')}</p>
        )}

        {filter === 'all' && (
          <LibRow
            {...row({ name: 'radio' })}
            active={route.name === 'radio'}
            art={tile('radio')}
            title={tx('Радио')}
            sub={tx('Станции со всего мира')}
          />
        )}

        {filter === 'all' && missing && (
          <LibRow
            {...row({ name: 'settings' })}
            art={tile('link', 'dashed')}
            title={tx('Подключить сервисы')}
            sub={missing}
          />
        )}
      </div>
    </aside>
  )
}

interface RowProps {
  art: ReactNode
  title: string
  sub: string
  active: boolean
  playing: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  dropping?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: React.DragEvent) => void
}

function LibRow({ art, title, sub, active, playing, onClick, onContextMenu, dropping, onDragOver, onDragLeave, onDrop }: RowProps): React.JSX.Element {
  return (
    <button
      className={cx('lib-row', active && 'active', dropping && 'drop-target')}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {art}
      <div className="lib-text">
        <div className={cx('lib-title ellipsis', playing && 'accent')}>{title}</div>
        <div className="lib-sub ellipsis">{sub}</div>
      </div>
      {playing && <Icon name="volumeHigh" size={16} className="lib-playing" />}
    </button>
  )
}
