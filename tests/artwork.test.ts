import { describe, expect, it } from 'vitest'
import { art } from '../src/renderer/src/lib/artwork'

describe('artwork sizes', () => {
  const sc = 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg'

  it('takes the requested SoundCloud size, the full-size one included', () => {
    expect(art(sc, 't300x300')).toBe('https://i1.sndcdn.com/artworks-abc-t300x300.jpg')
    expect(art(sc, 'original')).toBe('https://i1.sndcdn.com/artworks-abc-original.jpg')
  })

  it('maps the full size to the largest Yandex cover', () => {
    const ya = 'https://avatars.yandex.net/get-music-content/1/abc/400x400'
    expect(art(ya, 'original')).toBe('https://avatars.yandex.net/get-music-content/1/abc/1000x1000')
    expect(art(ya, 't500x500')).toBe('https://avatars.yandex.net/get-music-content/1/abc/400x400')
  })

  it('maps the full size to the largest Audius cover', () => {
    const au = 'https://audius-cdn.example/cid/480x480.jpg'
    expect(art(au, 'original')).toBe('https://audius-cdn.example/cid/1000x1000.jpg')
  })
})
