// SoundCloud DRM tracks play from Yandex Music: only the very same recording may stand in.
import { describe, expect, it } from 'vitest'
import { coreTitle, pickTwin, twinQuery, versionTags } from '../src/renderer/src/lib/twin'
import type { Track } from '../src/renderer/src/lib/types'

const sc = (over: Partial<Track>): Track =>
  ({ id: 1, kind: 'track', title: 'Blinding Lights', user: { id: 7, kind: 'user', username: 'The Weeknd' }, full_duration: 200_040, duration: 200_040, ...over }) as Track

const ya = (trackId: number, title: string, artists: string[], sec: number): Track =>
  ({
    id: -trackId,
    kind: 'track',
    origin: 'yandex',
    ya: { trackId, artists: artists.map((name) => ({ name })) },
    title,
    user: { id: 0, kind: 'user', username: artists.join(', ') },
    duration: sec * 1000,
    full_duration: sec * 1000
  }) as Track

const results = [
  ya(10, 'Blinding Lights (Remix)', ['The Weeknd', 'ROSALÍA'], 201),
  ya(11, 'Blinding Lights (Chromatics Remix)', ['The Weeknd', 'Chromatics'], 271),
  ya(12, 'Blinding Lights', ['The Weeknd'], 200),
  ya(13, 'Blinding Lights', ['Some Cover Band'], 200)
]

describe('coreTitle and versionTags', () => {
  it('keeps only the song name', () => {
    expect(coreTitle('Blinding Lights (Official Audio)')).toBe('blindinglights')
    expect(coreTitle('Song [Prod. by Someone]')).toBe('song')
    expect(coreTitle('Song feat. Ann & Bob')).toBe('song')
    expect(coreTitle('Song Official Video')).toBe('song')
  })

  it('finds the version words', () => {
    expect(versionTags('Blinding Lights (Chromatics Remix)')).toEqual(['remix'])
    expect(versionTags('Song (slowed + reverb)')).toEqual(['reverb', 'slowed'])
    expect(versionTags('Blinding Lights')).toEqual([])
  })
})

describe('pickTwin', () => {
  it('takes the original, not a remix or a cover with the same name', () => {
    expect(pickTwin(sc({}), results)?.ya?.trackId).toBe(12)
  })

  it('takes the same remix', () => {
    expect(pickTwin(sc({ title: 'Blinding Lights (Chromatics Remix)', full_duration: 270_500 }), results)?.ya?.trackId).toBe(11)
  })

  it('reads "Artist - Title" uploads from a label', () => {
    const t = sc({ title: 'The Weeknd - Blinding Lights (Official Audio)', user: { id: 9, kind: 'user', username: 'Republic Records' } })
    expect(pickTwin(t, results)?.ya?.trackId).toBe(12)
  })

  it('uses the artist the uploader named', () => {
    const t = sc({ user: { id: 9, kind: 'user', username: 'XO' }, publisher_metadata: { artist: 'The Weeknd' } })
    expect(pickTwin(t, results)?.ya?.trackId).toBe(12)
  })

  it('matches a featured artist and Cyrillic names', () => {
    const t = sc({ title: 'Положение (feat. Ann)', user: { id: 9, kind: 'user', username: 'Скриптонит' }, full_duration: 180_000 })
    expect(pickTwin(t, [ya(20, 'Положение', ['Скриптонит', 'Ann'], 181)])?.ya?.trackId).toBe(20)
  })

  it('refuses another artist, another length or another version', () => {
    expect(pickTwin(sc({ user: { id: 9, kind: 'user', username: 'Nobody' } }), results)).toBeNull()
    expect(pickTwin(sc({ full_duration: 210_000 }), results)).toBeNull()
    expect(pickTwin(sc({ title: 'Blinding Lights (slowed + reverb)' }), results)).toBeNull()
  })

  it('tells "Slowed" from "Super Slowed"', () => {
    const t = sc({ title: 'Raya (Slowed)', user: { id: 9, kind: 'user', username: 'Zericxxn' }, full_duration: 110_000 })
    const list = [ya(30, 'Raya (Super Slowed)', ['Zericxxn'], 111), ya(31, 'Raya (Slowed)', ['Zericxxn'], 110)]
    expect(pickTwin(t, list)?.ya?.trackId).toBe(31)
  })

  it('needs a known length on both sides', () => {
    expect(pickTwin(sc({ full_duration: 0, duration: 0 }), results)).toBeNull()
    expect(pickTwin(sc({}), [ya(12, 'Blinding Lights', ['The Weeknd'], 0)])).toBeNull()
  })
})

describe('twinQuery', () => {
  it('searches by artist and name, keeping the version', () => {
    expect(twinQuery(sc({}))).toBe('The Weeknd Blinding Lights')
    expect(twinQuery(sc({ title: 'Blinding Lights (Chromatics Remix)' }))).toBe('The Weeknd Blinding Lights remix')
    expect(twinQuery(sc({ title: 'Ann x Bob - Song [Official Video]', user: { id: 9, kind: 'user', username: 'Label' } }))).toBe('Ann Song')
  })
})
