import { describe, expect, it } from 'vitest'
import { presenceUrl } from '../src/main/presenceUrl'

// Discord drops the whole status when one link in it isn't a strict uri.
describe('presenceUrl', () => {
  it('keeps an ordinary link as it is', () => {
    expect(presenceUrl('https://soundcloud.com/artist/track-name')).toBe('https://soundcloud.com/artist/track-name')
    expect(presenceUrl('https://music.yandex.ru/album/14033519/track/78484932')).toBe(
      'https://music.yandex.ru/album/14033519/track/78484932'
    )
  })

  it('encodes spaces, Cyrillic and characters RFC 3986 forbids', () => {
    expect(presenceUrl('https://soundcloud.com/артист/трек')).toBe(
      'https://soundcloud.com/%D0%B0%D1%80%D1%82%D0%B8%D1%81%D1%82/%D1%82%D1%80%D0%B5%D0%BA'
    )
    expect(presenceUrl(' https://soundcloud.com/a b ')).toBe('https://soundcloud.com/a%20b')
    expect(presenceUrl('https://soundcloud.com/a|b[1]^c')).toBe('https://soundcloud.com/a%7Cb%5B1%5D%5Ec')
    expect(presenceUrl('https://soundcloud.com/100%-real')).toBe('https://soundcloud.com/100%25-real')
  })

  it('keeps proper %XX escapes', () => {
    expect(presenceUrl('https://soundcloud.com/a%20b')).toBe('https://soundcloud.com/a%20b')
  })

  it('every result is plain ASCII', () => {
    const url = presenceUrl('https://сайт.рф/путь?q=ё#якорь')
    expect(url).toBeDefined()
    expect(/^[\x21-\x7e]+$/.test(url!)).toBe(true)
  })

  it('refuses anything that is not a https link', () => {
    expect(presenceUrl(undefined)).toBeUndefined()
    expect(presenceUrl('')).toBeUndefined()
    expect(presenceUrl('not a link')).toBeUndefined()
    expect(presenceUrl('http://soundcloud.com/a')).toBeUndefined()
    expect(presenceUrl('heddify-local://track/1')).toBeUndefined()
  })

  it('refuses links longer than the limit', () => {
    const long = 'https://soundcloud.com/' + 'a'.repeat(600)
    expect(presenceUrl(long)).toBeUndefined()
    expect(presenceUrl('https://i1.sndcdn.com/' + 'a'.repeat(300), 256)).toBeUndefined()
    expect(presenceUrl('https://i1.sndcdn.com/x.jpg', 256)).toBe('https://i1.sndcdn.com/x.jpg')
  })
})
