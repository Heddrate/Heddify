import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { lang, onLangChange } from '@/lib/i18n'
import { Logo } from '@/components/Icon'
import { ContextMenu, Dialog, Toasts } from '@/components/Overlays'
import { PlayerBar } from '@/components/PlayerBar'
import { NowPlayingPanel } from '@/components/NowPlayingPanel'
import { LyricsPanel } from '@/components/LyricsPanel'
import { YandexHost } from '@/components/YandexHost'
import { QueuePanel } from '@/components/QueuePanel'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Sidebar } from '@/components/Sidebar'
import { FOCUS_SEARCH, TopBar } from '@/components/TopBar'
import { cx } from '@/lib/hooks'
import type { Route } from '@/lib/types'
import { boot, goBack, goForward, useApp } from '@/store/app'
import { player, usePlayer } from '@/store/player'
import { Home } from '@/views/Home'
import { Login, Offline } from '@/views/Login'
import { LocalPlaylistView, OfflineView } from '@/views/Local'
import { Loading } from '@/components/States'
import '@/lib/yandexApi'
import '@/lib/played'

// Pages other than home load on first visit: a smaller bundle starts faster.
const Likes = lazy(() => import('@/views/Library').then((m) => ({ default: m.Likes })))
const History = lazy(() => import('@/views/Library').then((m) => ({ default: m.History })))
const Following = lazy(() => import('@/views/Library').then((m) => ({ default: m.Following })))
const Playlists = lazy(() => import('@/views/Library').then((m) => ({ default: m.Playlists })))
const PlaylistView = lazy(() => import('@/views/Playlist').then((m) => ({ default: m.PlaylistView })))
const SystemPlaylistView = lazy(() => import('@/views/Playlist').then((m) => ({ default: m.SystemPlaylistView })))
const Search = lazy(() => import('@/views/Search').then((m) => ({ default: m.Search })))
const Settings = lazy(() => import('@/views/Settings').then((m) => ({ default: m.Settings })))
const UserView = lazy(() => import('@/views/User').then((m) => ({ default: m.UserView })))
const WaveView = lazy(() => import('@/views/Wave').then((m) => ({ default: m.WaveView })))
const YaWaveView = lazy(() => import('@/views/Yandex').then((m) => ({ default: m.YaWaveView })))
const YaArtistView = lazy(() => import('@/views/Yandex').then((m) => ({ default: m.YaArtistView })))
const YaAlbumView = lazy(() => import('@/views/Yandex').then((m) => ({ default: m.YaAlbumView })))
const YaPlaylistView = lazy(() => import('@/views/Yandex').then((m) => ({ default: m.YaPlaylistView })))
const AudiusView = lazy(() => import('@/views/Audius').then((m) => ({ default: m.AudiusView })))
const AuArtistView = lazy(() => import('@/views/Audius').then((m) => ({ default: m.AuArtistView })))

export function App(): React.JSX.Element {
  const auth = useApp((s) => s.auth)
  // a language switch re-renders everything in place (see lib/i18n)
  const [langKey, setLangKey] = useState(lang)
  useEffect(() => onLangChange(() => setLangKey(lang)), [])

  useEffect(() => {
    void boot()
  }, [])

  if (auth === 'checking') {
    return (
      <div className="splash">
        <div className="drag-strip" />
        <Logo size={56} />
      </div>
    )
  }
  if (auth === 'offline') return <Offline key={langKey} />
  if (auth === 'out') {
    return (
      <>
        <Login key={langKey} />
        <Toasts />
      </>
    )
  }
  return (
    <>
      <Shell key={langKey} />
      <YandexEngine />
    </>
  )
}

/** The hidden Yandex page lives outside the shell so re-renders never reload it. */
function YandexEngine(): React.JSX.Element | null {
  const mounted = useApp((s) => s.yandexMounted)
  return mounted ? <YandexHost /> : null
}

/** Views keep their state across tab/query changes; only a new page remounts. */
function pageKey(r: Route): string {
  if (r.name === 'user') return `user-${r.id}`
  if (r.name === 'playlist') return `playlist-${r.id}`
  if (r.name === 'system') return `system-${r.urn}`
  if (r.name === 'ya-artist') return `ya-artist-${r.id}`
  if (r.name === 'ya-album') return `ya-album-${r.id}`
  if (r.name === 'ya-playlist') return `ya-${r.uid}-${r.kind}`
  if (r.name === 'au-artist') return `au-artist-${r.id}`
  if (r.name === 'local') return `local-${r.id}`
  return r.name
}

function View({ route }: { route: Route }): React.JSX.Element | null {
  switch (route.name) {
    case 'ya-wave':
      return <YaWaveView />
    case 'ya-likes':
    case 'au-likes':
      return <Likes />
    case 'ya-artist':
      return <YaArtistView id={route.id} />
    case 'ya-album':
      return <YaAlbumView id={route.id} />
    case 'ya-playlist':
      return <YaPlaylistView uid={route.uid} kind={route.kind} />
    case 'yandex':
      return null // the Yandex page lives in YandexHost, layered over this panel
    case 'local':
      return <LocalPlaylistView id={route.id} />
    case 'offline':
      return <OfflineView />
    case 'audius':
      return <AudiusView genre={route.genre} />
    case 'au-artist':
      return <AuArtistView id={route.id} />
    case 'home':
      return <Home />
    case 'search':
      return <Search q={route.q} tab={route.tab} />
    case 'likes':
      return <Likes />
    case 'history':
      return <History />
    case 'following':
      return <Following />
    case 'playlists':
      return <Playlists />
    case 'playlist':
      return <PlaylistView id={route.id} />
    case 'system':
      return <SystemPlaylistView urn={route.urn} />
    case 'user':
      return <UserView id={route.id} tab={route.tab} />
    case 'wave':
      return <WaveView />
    case 'settings':
      return <Settings />
  }
}

function Shell(): React.JSX.Element {
  const route = useApp((s) => s.route)
  const panel = useApp((s) => s.panel)
  const main = useRef<HTMLElement>(null)
  const key = pageKey(route)

  useEffect(() => {
    main.current?.scrollTo(0, 0)
  }, [key])

  useHotkeys()

  return (
    <div className={cx('app', panel && 'with-queue')}>
      <TopBar />
      <Sidebar />
      <main ref={main} className="main panel scroll-y">
        <Suspense fallback={<Loading />}>
          <View key={key} route={route} />
        </Suspense>
      </main>
      {panel === 'queue' && <QueuePanel />}
      {panel === 'now' && <NowPlayingPanel />}
      {panel === 'lyrics' && <LyricsPanel />}
      <PlayerBar />
      <ContextMenu />
      <Dialog />
      <Toasts />
      <UpdateBanner />
    </div>
  )
}

function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      const mod = e.ctrlKey || e.metaKey

      if (mod && (e.code === 'KeyL' || e.code === 'KeyK' || e.code === 'KeyF')) {
        e.preventDefault()
        window.dispatchEvent(new Event(FOCUS_SEARCH))
        return
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        goBack()
        return
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        goForward()
        return
      }
      if (typing) return

      // Player shortcuts while a clicked button still has focus: drop that focus, or
      // Chromium decides the user is navigating by keyboard and rings the button.
      const shortcut = (e.code === 'Space' && !mod) || (mod && e.key.startsWith('Arrow'))
      if (shortcut && t instanceof HTMLButtonElement) t.blur()

      if (e.code === 'Space' && !mod) {
        e.preventDefault()
        player.toggle()
      } else if (mod && e.key === 'ArrowRight') {
        e.preventDefault()
        player.next()
      } else if (mod && e.key === 'ArrowLeft') {
        e.preventDefault()
        player.prev()
      } else if (mod && e.key === 'ArrowUp') {
        e.preventDefault()
        player.setVolume(usePlayer.getState().volume + 0.05)
      } else if (mod && e.key === 'ArrowDown') {
        e.preventDefault()
        player.setVolume(usePlayer.getState().volume - 0.05)
      }
    }
    // Mouse side buttons: back / forward.
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) goBack()
      else if (e.button === 4) goForward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])
}
