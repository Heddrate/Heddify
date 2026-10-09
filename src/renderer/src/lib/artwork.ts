import { useEffect, useState } from 'react'
import type { AnyPlaylist, Track, User } from './types'

export type ArtSize = 'large' | 't300x300' | 't500x500'

/** SoundCloud serves artwork in fixed sizes encoded in the file name. */
export function art(url: string | null | undefined, size: ArtSize = 't300x300'): string | null {
  if (!url) return null
  // Yandex covers end with a WxH size segment
  if (url.includes('avatars.yandex.net')) {
    const px = size === 'large' ? '100x100' : size === 't300x300' ? '300x300' : '400x400'
    return url.replace(/\/\d+x\d+$/, `/${px}`)
  }
  // Audius artwork: <cid>/150x150.jpg, 480x480.jpg, 1000x1000.jpg
  if (/\/(150x150|480x480|1000x1000)\.jpg$/.test(url)) {
    const px = size === 'large' ? '150x150' : size === 't300x300' ? '480x480' : '1000x1000'
    return url.replace(/\/(150x150|480x480|1000x1000)\.jpg$/, `/${px}.jpg`)
  }
  return url.replace(/-(large|t\d+x\d+|crop|original|small|badge|tiny|mini)\.(jpg|jpeg|png)/, `-${size}.$2`)
}

/** SoundCloud's grey "no avatar" picture: worse than our own placeholder. */
const realAvatar = (url?: string | null): string | null => (url && !url.includes('default_avatar') ? url : null)

/** Cover, or the artist's avatar when the track has none. */
export const trackArt = (t: Track | null | undefined, size: ArtSize = 't300x300'): string | null =>
  t ? art(t.artwork_url || realAvatar(t.user?.avatar_url), size) : null

export const userArt = (u: User | null | undefined, size: ArtSize = 't300x300'): string | null =>
  u ? art(u.avatar_url, size) : null

export function playlistArt(p: AnyPlaylist | null | undefined, size: ArtSize = 't300x300'): string | null {
  if (!p) return null
  const first = p.tracks?.find((t) => t.artwork_url)
  return art(p.artwork_url || p.calculated_artwork_url || first?.artwork_url || p.user?.avatar_url, size)
}

const colorCache = new Map<string, string>()

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h * 360, s, l]
}

function sample(img: HTMLImageElement): string {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return ''
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
    // favour saturated mid-tones over near-black/near-white pixels
    const w = 0.08 + s * (1 - Math.abs(l - 0.5) * 1.6)
    r += data[i] * w
    g += data[i + 1] * w
    b += data[i + 2] * w
    total += w
  }
  const [h, s] = rgbToHsl(r / total, g / total, b / total)
  // keep it muted: no neon headers
  return `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.42) * 100)}% 24%)`
}

/** Muted dominant colour of an artwork, used for page header backgrounds. */
export function useArtColor(url: string | null): string | null {
  const [color, setColor] = useState<string | null>(() => (url ? (colorCache.get(url) ?? null) : null))

  useEffect(() => {
    if (!url) {
      setColor(null)
      return
    }
    const cached = colorCache.get(url)
    if (cached) {
      setColor(cached)
      return
    }
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const c = sample(img)
        if (!c) return
        colorCache.set(url, c)
        if (alive) setColor(c)
      } catch {
        /* tainted canvas: leave the default */
      }
    }
    img.src = art(url, 'large') ?? url
    return () => {
      alive = false
    }
  }, [url])

  return color
}
