// VK tracks: read from the rows of the hidden vk.com page, matched to what its player plays.
import { describe, expect, it } from 'vitest'
import { stampAdded, vkKey, vkPlays, vkTrack, vkTrackFromState, vkTrackId, type VkPageState } from '../src/renderer/src/lib/vkModel'
import { pickTwin } from '../src/renderer/src/lib/twin'
import type { Track } from '../src/renderer/src/lib/types'

const row = {
  href: '/audio-2001109615_128109615',
  title: 'Villains',
  subtitle: '',
  artists: ['Fazobeats'],
  raw: 'Fazobeats',
  duration: 112,
  cover: 'https://sun9-81.userapi.com/cover.jpg',
  blocked: false
}

const state = (over: Partial<VkPageState>): VkPageState => ({
  key: '-2001109615_128109615',
  title: 'Villains',
  artist: 'Fazobeats',
  artwork: null,
  position: 0,
  duration: 112,
  playing: true,
  ad: false,
  ...over
})

describe('vkKey', () => {
  it('takes owner_id from a track page link', () => {
    expect(vkKey('/audio-2001109615_128109615')).toBe('-2001109615_128109615')
    expect(vkKey('/audio1089992262_456239023')).toBe('1089992262_456239023')
    // an access key after the id is not part of it
    expect(vkKey('/audio474499267_456837057_cf1e')).toBe('474499267_456837057')
    expect(vkKey('https://vk.com/audio-1_2?x=1')).toBe('-1_2')
  })

  it('refuses anything else', () => {
    expect(vkKey('/audios1089992262')).toBeNull()
    expect(vkKey('/music/playlist/1_2')).toBeNull()
  })
})

describe('vkTrackId', () => {
  it('is the same for the same key and below every Yandex id', () => {
    expect(vkTrackId('-2001109615_128109615')).toBe(vkTrackId('-2001109615_128109615'))
    expect(vkTrackId('-2001109615_128109615')).not.toBe(vkTrackId('1089992262_456239022'))
    expect(vkTrackId('1_1')).toBeLessThan(-1e12)
    expect(Number.isSafeInteger(vkTrackId('-2147483648_2147483647'))).toBe(true)
  })

  it('does not collide across many keys', () => {
    const ids = new Set<number>()
    for (let i = 0; i < 20000; i++) ids.add(vkTrackId(`-2001${i}_${456239000 + i}`))
    expect(ids.size).toBe(20000)
  })
})

describe('vkTrack', () => {
  it('maps a row to our track', () => {
    const t = vkTrack(row)!
    expect(t.origin).toBe('vk')
    expect(t.vk).toEqual({ key: '-2001109615_128109615', artists: [{ name: 'Fazobeats' }] })
    expect(t.title).toBe('Villains')
    expect(t.user?.username).toBe('Fazobeats')
    expect(t.duration).toBe(112_000)
    expect(t.permalink_url).toBe('https://vk.com/audio-2001109615_128109615')
    expect(t.policy).toBe('ALLOW')
  })

  it('puts the version after the title, once', () => {
    expect(vkTrack({ ...row, title: 'ZAN PREPORAN', subtitle: 'Super Slowed' })!.title).toBe('ZAN PREPORAN (Super Slowed)')
    expect(vkTrack({ ...row, title: 'Song (Remix)', subtitle: 'Remix' })!.title).toBe('Song (Remix)')
  })

  it('undoes the escaping of VK player data', () => {
    expect(vkTrack({ ...row, title: 'Rock &amp; Roll', raw: 'A &amp; B' })!.title).toBe('Rock & Roll')
    expect(vkTrack({ ...row, raw: 'Tom &quot;T&quot;', artists: [] })!.user?.username).toBe('Tom "T"')
  })

  it('takes the artists from the credit line when VK lists none', () => {
    const names = (raw: string): string[] => vkTrack({ ...row, artists: [], raw })!.vk!.artists!.map((a) => a.name)
    expect(names('Egor Kreed, The Limba')).toEqual(['Egor Kreed', 'The Limba'])
    expect(names('Тимати feat. Egor Kreed')).toEqual(['Тимати', 'Egor Kreed'])
    expect(names('Filatov & Karas ft. Звёзды')).toEqual(['Filatov', 'Karas', 'Звёзды'])
    // VK's own list wins: a duo stays one name there
    expect(vkTrack({ ...row, artists: ['Filatov & Karas'], raw: 'Filatov & Karas' })!.vk!.artists).toEqual([{ name: 'Filatov & Karas' }])
  })

  it('keeps blocked tracks marked and skips broken rows', () => {
    expect(vkTrack({ ...row, blocked: true })!.policy).toBe('BLOCK')
    expect(vkTrack({ ...row, href: '/audios1' })).toBeNull()
    expect(vkTrack({ ...row, title: '  ' })).toBeNull()
  })

  it('takes the track VK moved on to from its player', () => {
    const t = vkTrackFromState(state({ key: '1_2', title: 'ZYRE', artist: 'Zynyx, KREZUS', duration: 97 }))!
    expect(t.vk?.key).toBe('1_2')
    expect(t.vk?.artists).toEqual([{ name: 'Zynyx' }, { name: 'KREZUS' }])
    expect(t.duration).toBe(97_000)
  })
})

describe('vkPlays', () => {
  const t = vkTrack(row)!

  it('knows the same page', () => {
    expect(vkPlays(state({}), t)).toBe(true)
  })

  it('accepts the user’s own copy of the track (another key, same song)', () => {
    expect(vkPlays(state({ key: '1089992262_456239022' }), t)).toBe(true)
  })

  it('tells other tracks apart', () => {
    expect(vkPlays(state({ key: '1_2', title: 'ZYRE' }), t)).toBe(false)
    // the same name, another length: another recording
    expect(vkPlays(state({ key: '1_2', duration: 180 }), t)).toBe(false)
  })
})

describe('stampAdded', () => {
  it('counts new tracks as just added, in VK order, and keeps known times', () => {
    const first = stampAdded(['a', 'b', 'c'], {}, 1000)
    expect(first).toEqual({ a: 1000, b: 999, c: 998 })
    const later = stampAdded(['n', 'a', 'c'], first, 5000)
    expect(later).toEqual({ n: 5000, a: 1000, c: 998 })
  })
})

describe('DRM stand-in from VK', () => {
  const sc = { id: 1, kind: 'track', title: 'Villains', user: { id: 7, kind: 'user', username: 'Fazobeats' }, duration: 112_500, full_duration: 112_500 } as Track

  it('picks the VK copy of the same recording', () => {
    const other = vkTrack({ ...row, href: '/audio-1_1', title: 'Villains', subtitle: 'Slowed' })!
    const same = vkTrack(row)!
    expect(pickTwin(sc, [other, same])?.vk?.key).toBe('-2001109615_128109615')
  })

  it('takes nothing by another artist', () => {
    expect(pickTwin(sc, [vkTrack({ ...row, artists: ['Someone'], raw: 'Someone' })!])).toBeNull()
  })
})
