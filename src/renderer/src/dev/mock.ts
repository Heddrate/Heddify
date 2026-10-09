/**
 * Development-only stand-in for the Electron bridge so the renderer can be opened in a
 * normal browser (http://localhost:5173) with fake data. Never bundled in production.
 */
import type { ApiResult, DownloadProgress, ScBridge, StreamInfo } from '../../../shared/ipc'
import type { Playlist, Track, User } from '@/lib/types'

const HUES = [14, 28, 42, 96, 150, 176, 196, 210, 0, 32]

function cover(seed: number): string {
  const h = HUES[seed % HUES.length]
  const l = 26 + ((seed * 7) % 22)
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='hsl(${h} 32% ${l}%)'/><circle cx='${18 + ((seed * 13) % 64)}' cy='${24 + ((seed * 17) % 56)}' r='${16 + (seed % 22)}' fill='hsl(${h} 28% ${l + 14}%)'/><rect x='0' y='${60 + (seed % 30)}' width='100' height='40' fill='hsl(${h} 30% ${l - 10}%)'/></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

const ARTISTS = ['Nordvale', 'Mira Sol', 'Lowtide', 'KRSK', 'Ghostpaper', 'Saltmarsh', 'Okean Elzy Tapes', 'Dmitri Fog', 'Hollow Pines', 'Vesna']
const WORDS = ['Night', 'Drive', 'Static', 'Glass', 'Summer', 'Echo', 'Ritual', 'Concrete', 'Afterglow', 'Northern', 'Signal', 'Paper', 'Moon', 'Tape', 'Dust', 'Heat', 'River', 'Snow']

const users: User[] = ARTISTS.map((name, i) => ({
  id: 100 + i,
  kind: 'user',
  username: name,
  avatar_url: cover(i + 40),
  permalink_url: `https://soundcloud.com/${name.toLowerCase().replace(/\s+/g, '-')}`,
  followers_count: 1200 + i * 48211,
  followings_count: 120,
  track_count: 18 + i * 3,
  city: i % 2 ? 'Москва' : 'Санкт-Петербург',
  verified: i % 3 === 0
}))

const me: User = { ...users[0], id: 1, username: 'heddrate', full_name: 'Heddrate', followings_count: 48, avatar_url: cover(77) }

const tracks: Track[] = Array.from({ length: 140 }, (_, i) => {
  const u = users[i % users.length]
  const title = `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]}${i % 5 === 0 ? ' (Original Mix)' : ''}`
  return {
    id: 1000 + i,
    kind: 'track',
    title,
    user: u,
    artwork_url: i % 9 === 4 ? null : cover(i),
    duration: (120 + ((i * 37) % 260)) * 1000,
    full_duration: (120 + ((i * 37) % 260)) * 1000,
    permalink_url: `${u.permalink_url}/${title.toLowerCase().replace(/\W+/g, '-')}`,
    playback_count: 900 + ((i * 7919) % 2_400_000),
    likes_count: 100 + i * 31,
    created_at: new Date(Date.now() - i * 86400_000 * 1.7).toISOString(),
    policy: i % 23 === 7 ? 'SNIP' : i % 31 === 11 ? 'BLOCK' : 'ALLOW'
  }
})

const playlists: Playlist[] = Array.from({ length: 12 }, (_, i) => ({
  id: 5000 + i,
  kind: 'playlist',
  title: ['Ночной город', 'Для работы', 'Techno 2026', 'Дорога', 'Лоу-фай на вечер', 'Всё подряд', 'Северная волна', 'Gym', 'Ambient sleep', 'Летний архив', 'Рэп', 'Breaks'][i],
  user: i < 5 ? me : users[i % users.length],
  artwork_url: i === 3 ? null : cover(i + 20),
  track_count: 12 + i * 5,
  tracks: tracks.slice(i * 7, i * 7 + 12 + i * 5).map((t, j) => (j < 5 ? t : ({ id: t.id, kind: 'track' } as Track))),
  is_album: i % 4 === 2,
  set_type: i % 4 === 2 ? 'album' : null,
  permalink_url: `https://soundcloud.com/sets/${i}`,
  created_at: new Date(Date.now() - i * 86400_000 * 40).toISOString()
}))

const likes = tracks.slice(0, 96)
const prefs: Record<string, unknown> = JSON.parse(localStorage.getItem('mock-prefs') ?? '{}')

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data })

function page<T>(all: T[], path: string, offset: number, limit: number): { collection: T[]; next_href: string | null } {
  const end = offset + limit
  return {
    collection: all.slice(offset, end),
    next_href: end < all.length ? `https://api-v2.soundcloud.com${path}?offset=${end}&limit=${limit}` : null
  }
}

function route(method: string, raw: string, params: Record<string, unknown> = {}): ApiResult {
  const url = new URL(raw.startsWith('http') ? raw : 'https://api-v2.soundcloud.com' + raw)
  const p = url.pathname
  const offset = Number(url.searchParams.get('offset') ?? params.offset ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? params.limit ?? 50)
  const q = String(params.q ?? '').toLowerCase()
  let m: RegExpMatchArray | null

  if (method !== 'GET') {
    // localStorage['mock-antibot'] = '1' imitates SoundCloud's anti-bot refusing writes
    if (localStorage.getItem('mock-antibot') === '1' && !p.includes('play-history')) {
      return { ok: false, status: 403, error: 'SoundCloud временно ограничил лайки и подписки для вашей сети', blocked: true }
    }
    return ok(null)
  }
  if (p === '/me') return ok(me)
  if (p === '/me/track_likes/ids') return ok({ collection: likes.map((t) => t.id) })
  if (p === '/me/followings/ids') return ok({ collection: users.slice(0, 6).map((u) => u.id) })
  if (p === '/me/play-history/tracks')
    return ok(page(tracks.slice(30, 90).map((t, i) => ({ played_at: Date.now() - i * 3600_000 * 5, track: t })), p, offset, limit))
  if (p === '/stream') return ok(page(tracks.slice(10).map((t) => ({ type: 'track', track: t, user: t.user })), p, offset, limit))
  if (p === '/mixed-selections')
    return ok({
      collection: [
        { urn: 'sel:1', title: 'Подобрано для вас', items: { collection: playlists.slice(4, 12) } },
        { urn: 'sel:2', title: 'Новые релизы от подписок', items: { collection: playlists.slice(0, 8).reverse() } }
      ]
    })
  if ((m = p.match(/^\/users\/\d+\/track_likes$/)))
    return ok(page(likes.map((t, i) => ({ created_at: new Date(Date.now() - i * 86400_000 * 2.3).toISOString(), track: t })), p, offset, limit))
  if ((m = p.match(/^\/users\/\d+\/playlists_liked_and_owned$/)))
    return ok({ collection: playlists.map((pl, i) => ({ type: i < 5 ? 'playlist' : 'playlist-like', playlist: pl })) })
  if (p.match(/^\/users\/\d+\/followings$/)) return ok(page(users.slice(0, 6), p, offset, limit))
  if ((m = p.match(/^\/users\/(\d+)\/toptracks$/))) return ok({ collection: tracks.filter((t) => t.user?.id === Number(m![1])).slice(0, 10) })
  if ((m = p.match(/^\/users\/(\d+)\/tracks$/))) return ok(page(tracks.filter((t) => t.user?.id === Number(m![1])), p, offset, limit))
  if (p.match(/^\/users\/\d+\/albums$/)) return ok({ collection: playlists.filter((x) => x.is_album) })
  if (p.match(/^\/users\/\d+\/playlists_without_albums$/)) return ok({ collection: playlists.filter((x) => !x.is_album).slice(0, 6) })
  if (p.match(/^\/stream\/users\/\d+\/reposts$/)) return ok({ collection: tracks.slice(50, 70).map((t) => ({ type: 'track-repost', track: t })) })
  if ((m = p.match(/^\/users\/(\d+)$/))) {
    const id = Number(m[1])
    return ok(id === 1 ? me : (users.find((u) => u.id === id) ?? users[0]))
  }
  if ((m = p.match(/^\/playlists\/(\d+)$/))) return ok(playlists.find((x) => x.id === Number(m![1])) ?? playlists[0])
  if (p === '/tracks') {
    const ids = String(params.ids ?? '').split(',').map(Number)
    return ok(tracks.filter((t) => ids.includes(t.id)))
  }
  if ((m = p.match(/^\/tracks\/(\d+)\/related$/))) {
    const seed = Number(m[1])
    return ok({ collection: tracks.slice(90).filter((t) => (t.id + seed) % 3 !== 0).slice(0, 25) })
  }
  if (p === '/search/tracks') return ok(page(tracks.filter((t) => t.title!.toLowerCase().includes(q[0] ?? '')), p, offset, limit))
  if (p === '/search/users') return ok(page(users, p, offset, limit))
  if (p === '/search/playlists_without_albums') return ok(page(playlists.filter((x) => !x.is_album), p, offset, limit))
  if (p === '/search/albums') return ok(page(playlists.filter((x) => x.is_album), p, offset, limit))
  return { ok: false, status: 404, error: 'Не найдено' }
}

let toneUrl: string | null = null
function tone(): string {
  if (toneUrl) return toneUrl
  const rate = 8000
  const seconds = 40
  const n = rate * seconds
  const buf = new DataView(new ArrayBuffer(44 + n))
  const str = (o: number, s: string): void => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  buf.setUint32(4, 36 + n, true)
  str(8, 'WAVEfmt ')
  buf.setUint32(16, 16, true)
  buf.setUint16(20, 1, true)
  buf.setUint16(22, 1, true)
  buf.setUint32(24, rate, true)
  buf.setUint32(28, rate, true)
  buf.setUint16(32, 1, true)
  buf.setUint16(34, 8, true)
  str(36, 'data')
  buf.setUint32(40, n, true)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const env = Math.min(1, t * 2, (seconds - t) * 2)
    const v = Math.sin(2 * Math.PI * 196 * t) * 0.5 + Math.sin(2 * Math.PI * 293.7 * t) * 0.3
    buf.setUint8(44 + i, 128 + Math.round(v * 10 * env))
  }
  toneUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
  return toneUrl
}

const mockPinned = new Map<number, unknown>()
const mockProgress = new Set<(p: DownloadProgress) => void>()

export function installMock(): void {
  let loggedIn = localStorage.getItem('mock-auth') === '1'
  const bridge: ScBridge = {
    platform: 'win32',
    auth: {
      status: async () => ({ loggedIn }),
      login: async () => {
        await delay(900)
        loggedIn = true
        localStorage.setItem('mock-auth', '1')
        return { ok: true }
      },
      cancelLogin: async () => undefined,
      setToken: async () => ({ ok: false, error: 'Токен не подошёл' }),
      logout: async () => {
        loggedIn = false
        localStorage.removeItem('mock-auth')
      }
    },
    api: async <T,>(method: string, path: string, params?: Record<string, unknown>) => {
      await delay(150)
      return route(method, path, params) as ApiResult<T>
    },
    resolveStream: async (t) => {
      await delay(200)
      // Audius is a public API: the browser preview plays the real stream
      if (t.audius) {
        const url = `https://api.audius.co/v1/tracks/${t.audius}/stream?app_name=SCPlayer`
        return { ok: true, status: 200, data: { url, protocol: 'progressive', mime: 'audio/mpeg', snipped: false } }
      }
      const track = tracks.find((x) => x.id === t.id)
      if (track?.policy === 'BLOCK') return { ok: false, status: 403, error: 'Трек недоступен в вашем регионе' }
      const data: StreamInfo = { url: tone(), protocol: 'progressive', mime: 'audio/wav', snipped: track?.policy === 'SNIP' }
      return { ok: true, status: 200, data }
    },
    cache: {
      stats: async () => ({
        bytes: 312 * 1024 * 1024,
        count: 87,
        pinnedBytes: mockPinned.size * 6 * 1024 * 1024,
        pinnedCount: mockPinned.size,
        limitMb: Number(prefs.cacheLimitMb) || 1024,
        enabled: prefs.cacheEnabled !== false
      }),
      clear: async () => mockPinned.clear(),
      list: async () => [...mockPinned.values()].map((meta) => ({ key: `sc-${(meta as Track).id}`, meta, pinned: true, size: 6e6 })),
      download: async (reqs) => {
        let done = 0
        for (const r of reqs) {
          await delay(300)
          if (r.meta) mockPinned.set(r.id, r.meta)
          mockProgress.forEach((cb) => cb({ done: ++done, total: reqs.length, failed: 0 }))
        }
      },
      unpin: async (keys) => keys.forEach((k) => mockPinned.delete(Number(k.slice(3)))),
      onProgress: (cb) => {
        mockProgress.add(cb)
        return () => mockProgress.delete(cb)
      }
    },
    prefs: {
      get: async () => prefs,
      set: async (patch) => {
        Object.assign(prefs, patch)
        localStorage.setItem('mock-prefs', JSON.stringify(prefs))
      }
    },
    openExternal: async (url) => void window.open(url, '_blank'),
    copyText: async (text) => navigator.clipboard?.writeText(text),
    openLogs: async () => undefined,
    setWindowTheme: () => undefined,
    yandex: {
      headers: async () => ({}),
      onHeaders: () => () => undefined,
      login: async () => false,
      logout: async () => undefined
    },
    playerState: () => undefined,
    onPlayerCommand: () => () => undefined,
    // localStorage 'mock-update' = '1' pretends an update is downloaded
    update: {
      state: async () => (localStorage.getItem('mock-update') === '1' ? { status: 'ready', version: '1.2.1' } : { status: 'latest' }),
      check: async () => undefined,
      install: async () => location.reload(),
      onState: () => () => undefined
    },
    discord: {
      update: (p) => console.debug('[mock] discord presence', p),
      status: async () => 'no-discord',
      onStatus: () => () => undefined
    }
  }
  ;(window as unknown as { sc: ScBridge }).sc = bridge
}
