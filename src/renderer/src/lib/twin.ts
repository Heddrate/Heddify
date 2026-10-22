/**
 * The same recording on Yandex Music or VK, for SoundCloud tracks that SoundCloud only hands
 * out as DRM (they play in its own player alone). Pure matching, no requests: lib/yandex.ts
 * and lib/vk.ts search, the player plays the match instead. A wrong song is worse than none, so every
 * check has to pass — title, at least one artist, the version (remix, slowed…) and the length.
 */
import type { Track } from './types'
import { artistRefs, normName, splitCredit } from './artists'

/** Same recording on two services: the lengths differ by a second or two at most. */
const MAX_LENGTH_DIFF_MS = 4000

/** Words that make another recording of the same song. */
const VERSION_WORDS = new Set([
  'remix', 'rmx', 'mix', 'edit', 'slowed', 'super', 'ultra', 'sped', 'speed', 'nightcore', 'acoustic', 'live',
  'instrumental', 'cover', 'bootleg', 'flip', 'vip', 'extended', 'mashup', 'karaoke', 'reverb',
  'demo', 'ремикс', 'кавер', 'инструментал', 'акустика'
])

/** Upload noise that isn't part of the song's name. */
const NOISE = /\b(?:official\s+(?:music\s+)?(?:audio|video)|lyric\s+video|lyrics?|visuali[sz]er|free\s+download|out\s+now|explicit|hq|hd)\b/gi

/** "Artist - Title" uploads: the part before the dash names the artists. */
function splitDash(title: string): { left: string | null; right: string } {
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  return m ? { left: m[1], right: m[2] } : { left: null, right: title }
}

/** The song's name alone: no brackets, no featured people or producers, no upload noise. */
export function coreTitle(title: string): string {
  const t = title
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\s(?:feat\.?|ft\.?|featuring|prod\.?|prod\s+by)\s.*$/i, ' ')
    .replace(/\s\|\s.*$/, ' ')
    .replace(NOISE, ' ')
  return normName(t)
}

/** The version words anywhere in the title, e.g. {remix} for "Song (Chromatics Remix)". */
export function versionTags(title: string): string[] {
  const words = title.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return [...new Set(words.filter((w) => VERSION_WORDS.has(w)))].sort()
}

/**
 * A SoundCloud track's title and artists, with "Artist - Title" uploads taken apart.
 * `main` is the best name to search by: the artist the uploader named, then the one before
 * the dash, then the uploader (often a label).
 */
function scSide(track: Track): { title: string; artists: string[]; main: string } {
  const { left, right } = splitDash(track.title ?? '')
  const named = splitCredit(track.publisher_metadata?.artist ?? '')
  const dashed = left ? splitCredit(left.replace(/\s+x\s+/gi, ', ')) : []
  const artists = [...artistRefs(track).map((a) => a.name), ...dashed]
  return { title: right, artists, main: named[0] ?? dashed[0] ?? track.user?.username ?? '' }
}

const sameArtist = (a: string, b: string): boolean => {
  const x = normName(a)
  const y = normName(b)
  if (!x || !y) return false
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)))
}

const lengthOf = (t: Track): number => t.full_duration || t.duration || 0

/** What to type into Yandex's or VK's search for this SoundCloud track. */
export function twinQuery(track: Track): string {
  const { title, main } = scSide(track)
  const name = title
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\s(?:feat\.?|ft\.?|featuring|prod\.?|prod\s+by)\s.*$/i, ' ')
    .replace(NOISE, ' ')
  return [main, name, ...versionTags(track.title ?? '')].join(' ').replace(/\s+/g, ' ').trim()
}

/** The Yandex or VK track that is this SoundCloud track, or null when none is certain. */
export function pickTwin(track: Track, candidates: Track[]): Track | null {
  const sc = scSide(track)
  const core = coreTitle(sc.title)
  const tags = versionTags(track.title ?? '').join()
  const length = lengthOf(track)
  if (!core || !length) return null

  let best: Track | null = null
  let bestDiff = Infinity
  for (const c of candidates) {
    const service = c.origin === 'yandex' ? c.ya : c.origin === 'vk' ? c.vk : undefined
    if (!service) continue
    if (coreTitle(c.title ?? '') !== core) continue
    if (versionTags(c.title ?? '').join() !== tags) continue
    const names = service.artists?.length ? service.artists.map((a) => a.name) : [c.user?.username ?? '']
    if (!names.some((n) => sc.artists.some((a) => sameArtist(a, n)))) continue
    const diff = Math.abs(lengthOf(c) - length)
    if (!lengthOf(c) || diff > MAX_LENGTH_DIFF_MS) continue
    if (diff < bestDiff) {
      best = c
      bestDiff = diff
    }
  }
  return best
}
