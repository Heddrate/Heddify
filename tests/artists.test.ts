// Who is on a track: collaborations, featured people, Yandex artists with their own ids.
import { describe, expect, it } from 'vitest'
import { artistRefs, featuredNames, normName, splitCredit } from '../src/renderer/src/lib/artists'
import type { Track } from '../src/renderer/src/lib/types'

const track = (over: Partial<Track>): Track =>
  ({ id: 1, kind: 'track', title: 'Song', user: { id: 7, kind: 'user', username: 'Uploader' }, ...over }) as Track

describe('splitCredit', () => {
  it('splits "A, B", "A & B" and "A and B"', () => {
    expect(splitCredit('Ann, Bob & Cy and Dee')).toEqual(['Ann', 'Bob', 'Cy', 'Dee'])
  })
})

describe('featuredNames', () => {
  it('reads (feat. …), ft. … and featuring …', () => {
    expect(featuredNames('Song (feat. Ann & Bob)')).toEqual(['Ann', 'Bob'])
    expect(featuredNames('Song [ft. Cy]')).toEqual(['Cy'])
    expect(featuredNames('Song featuring Dee')).toEqual(['Dee'])
  })

  it('finds nothing in a plain title', () => {
    expect(featuredNames('Just a song')).toEqual([])
  })
})

describe('artistRefs', () => {
  it('a SoundCloud track: the uploader keeps its id, featured people come after', () => {
    const refs = artistRefs(track({ title: 'Song (feat. Ann)' }))
    expect(refs).toEqual([
      { name: 'Uploader', id: 7 },
      { name: 'Ann' }
    ])
  })

  it('uses the artist the uploader gave, and does not repeat the uploader', () => {
    const refs = artistRefs(track({ publisher_metadata: { artist: 'Uploader, Bob' } }))
    expect(refs.map((r) => r.name)).toEqual(['Uploader', 'Bob'])
  })

  it('a Yandex track lists every artist with its own id', () => {
    const refs = artistRefs(
      track({
        origin: 'yandex',
        user: { id: 0, kind: 'user', username: 'Ann, Bob' },
        ya: { trackId: 1, artistId: 10, artists: [{ id: 10, name: 'Ann' }, { id: 11, name: 'Bob' }] }
      })
    )
    expect(refs).toEqual([
      { name: 'Ann', id: 10 },
      { name: 'Bob', id: 11 }
    ])
  })

  it('a Yandex track without a list falls back to the joined name', () => {
    const refs = artistRefs(track({ origin: 'yandex', user: { id: 0, kind: 'user', username: 'Ann' }, ya: { trackId: 1, artistId: 10 } }))
    expect(refs).toEqual([{ name: 'Ann', id: 10 }])
  })

  it('a radio station keeps its single name', () => {
    expect(artistRefs(track({ origin: 'radio', title: 'Station (feat. X)' }))).toEqual([{ name: 'Uploader', id: 7 }])
  })
})

describe('normName', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normName('A. B!')).toBe(normName('a b'))
  })
})
