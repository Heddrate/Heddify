/**
 * Addresses of the website's pages (heddrate.com/wave, /search?q=…): a page of the app is a
 * place in the browser — back / forward work, a link opens the same page. Pure
 * (tests/webRoutes.test.ts); store/app.ts keeps the address and the page in step.
 */
import type { Route, SearchTab, UserTab } from './types'

const enc = encodeURIComponent

const SEARCH_TABS: SearchTab[] = ['all', 'tracks', 'users', 'playlists', 'albums', 'yandex', 'audius']
const USER_TABS: UserTab[] = ['popular', 'tracks', 'albums', 'playlists', 'reposts']

export function pathOf(r: Route): string {
  switch (r.name) {
    case 'home':
      return '/'
    case 'search': {
      const p = new URLSearchParams({ q: r.q })
      if (r.tab && r.tab !== 'all') p.set('tab', r.tab)
      return `/search?${p}`
    }
    case 'likes':
      return '/likes'
    case 'au-likes':
      return '/likes/audius'
    case 'playlists':
      return '/library'
    case 'following':
      return '/following'
    case 'history':
      return '/history'
    case 'wave':
      return '/wave'
    case 'settings':
      return '/settings'
    case 'radio':
      return r.tag ? `/radio/${enc(r.tag)}` : '/radio'
    case 'files':
      return '/files'
    case 'offline':
      return '/offline'
    case 'audius':
      return r.genre ? `/audius/${enc(r.genre)}` : '/audius'
    case 'au-artist':
      return `/artist/${enc(r.id)}`
    case 'local':
      return `/list/${enc(r.id)}`
    case 'playlist':
      return `/playlist/${r.id}`
    case 'system':
      return `/selection/${enc(r.urn)}`
    case 'user':
      return r.tab ? `/user/${r.id}/${r.tab}` : `/user/${r.id}`
    case 'yandex':
      return '/yandex'
    case 'ya-wave':
      return '/yandex/wave'
    case 'ya-likes':
      return '/yandex/likes'
    case 'ya-playlist':
      return `/yandex/playlist/${r.uid}/${r.kind}`
    case 'ya-artist':
      return `/yandex/artist/${r.id}`
    case 'ya-album':
      return `/yandex/album/${r.id}`
  }
}

const num = (s: string | undefined): number | null => (s && /^\d+$/.test(s) ? Number(s) : null)

/** The page an address shows; an address the site doesn't know is home. */
export function routeOf(pathname: string, search = ''): Route {
  const parts = pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
  const [a, b, c, d] = parts
  const q = new URLSearchParams(search)
  switch (a) {
    case undefined:
      return { name: 'home' }
    case 'search': {
      const tab = q.get('tab') as SearchTab | null
      return { name: 'search', q: q.get('q') ?? '', ...(tab && SEARCH_TABS.includes(tab) ? { tab } : {}) }
    }
    case 'likes':
      return b === 'audius' ? { name: 'au-likes' } : { name: 'likes' }
    case 'library':
      return { name: 'playlists' }
    case 'following':
      return { name: 'following' }
    case 'history':
      return { name: 'history' }
    case 'wave':
      return { name: 'wave' }
    case 'settings':
      return { name: 'settings' }
    case 'radio':
      return b ? { name: 'radio', tag: b } : { name: 'radio' }
    case 'files':
      return { name: 'files' }
    case 'offline':
      return { name: 'offline' }
    case 'audius':
      return b ? { name: 'audius', genre: b } : { name: 'audius' }
    case 'artist':
      return b ? { name: 'au-artist', id: b } : { name: 'home' }
    case 'list':
      return b ? { name: 'local', id: b } : { name: 'home' }
    case 'playlist':
      return num(b) !== null ? { name: 'playlist', id: num(b)! } : { name: 'home' }
    case 'selection':
      return b ? { name: 'system', urn: b } : { name: 'home' }
    case 'user': {
      const id = num(b)
      if (id === null) return { name: 'home' }
      return c && USER_TABS.includes(c as UserTab) ? { name: 'user', id, tab: c as UserTab } : { name: 'user', id }
    }
    case 'yandex':
      if (!b) return { name: 'yandex' }
      if (b === 'wave') return { name: 'ya-wave' }
      if (b === 'likes') return { name: 'ya-likes' }
      if (b === 'playlist' && num(c) !== null && num(d) !== null) return { name: 'ya-playlist', uid: num(c)!, kind: num(d)! }
      if (b === 'artist' && num(c) !== null) return { name: 'ya-artist', id: num(c)! }
      if (b === 'album' && num(c) !== null) return { name: 'ya-album', id: num(c)! }
      return { name: 'yandex' }
    default:
      return { name: 'home' }
  }
}

/** Pages the website can show: the ones that need SoundCloud, Yandex or the app's cache are home there. */
export function onSite(r: Route): Route {
  switch (r.name) {
    case 'playlist':
    case 'system':
    case 'user':
    case 'following':
    case 'offline':
    case 'yandex':
    case 'ya-wave':
    case 'ya-likes':
    case 'ya-playlist':
    case 'ya-artist':
    case 'ya-album':
      return { name: 'home' }
    default:
      return r
  }
}
