// The website's addresses: every page has one, and the address brings the same page back.
import { describe, expect, it } from 'vitest'
import { onSite, pathOf, routeOf } from '../src/renderer/src/lib/webRoutes'
import type { Route } from '../src/renderer/src/lib/types'

const back = (r: Route): Route => {
  const u = new URL(pathOf(r), 'https://heddrate.com')
  return routeOf(u.pathname, u.search)
}

describe('website addresses', () => {
  it('give every page its address and back', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'wave' },
      { name: 'likes' },
      { name: 'au-likes' },
      { name: 'playlists' },
      { name: 'history' },
      { name: 'settings' },
      { name: 'files' },
      { name: 'radio' },
      { name: 'radio', tag: 'lo-fi & chill' },
      { name: 'audius' },
      { name: 'audius', genre: 'Hip-Hop/Rap' },
      { name: 'au-artist', id: 'aB3x' },
      { name: 'local', id: 'my list' },
      { name: 'search', q: 'фонк slowed' },
      { name: 'search', q: 'night', tab: 'tracks' },
      { name: 'playlist', id: 42 },
      { name: 'user', id: 7, tab: 'reposts' },
      { name: 'ya-playlist', uid: 5, kind: 3 }
    ]
    for (const r of routes) expect(back(r)).toEqual(r)
  })

  it('reads the addresses people type', () => {
    expect(routeOf('/wave/')).toEqual({ name: 'wave' })
    expect(routeOf('/search', '?q=a%20b')).toEqual({ name: 'search', q: 'a b' })
    expect(pathOf({ name: 'search', q: 'a b' })).toBe('/search?q=a+b')
  })

  it('sends unknown or broken addresses home', () => {
    expect(routeOf('/nope')).toEqual({ name: 'home' })
    expect(routeOf('/playlist/abc')).toEqual({ name: 'home' })
    expect(routeOf('/search', '?q=x&tab=evil')).toEqual({ name: 'search', q: 'x' })
    expect(routeOf('/radio/%E0%A4%A')).toEqual({ name: 'radio', tag: '%E0%A4%A' })
  })

  it('keeps the website on pages it can show', () => {
    expect(onSite({ name: 'ya-wave' })).toEqual({ name: 'home' })
    expect(onSite({ name: 'user', id: 1 })).toEqual({ name: 'home' })
    expect(onSite({ name: 'wave' })).toEqual({ name: 'wave' })
  })
})
