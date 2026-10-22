/**
 * VK tracks in our model, and how what the VK page plays is matched to them. Pure: no page,
 * no store (tests/vk.test.ts). The page itself is driven in lib/vk.ts.
 */
import type { Track } from './types'

export const VK = 'https://vk.com'

/** A track row as the VK page draws it (read in lib/vk.ts from the row's own data). */
export interface VkRow {
  /** The track's page, "/audio-2001_128". */
  href: string
  title: string
  /** The version VK shows next to the title ("Super Slowed"). */
  subtitle?: string
  artists?: string[]
  /** The credit line as VK writes it ("A feat. B"). */
  raw?: string
  /** Seconds. */
  duration?: number
  cover?: string | null
  blocked?: boolean
}

/** What VK's player says it plays (read from the page's getAudioPlayer()). */
export interface VkPageState {
  /** "owner_id" of the playing track. */
  key: string
  title: string
  artist: string
  artwork: string | null
  /** Seconds. */
  position: number
  duration: number
  playing: boolean
  /** An ad plays before the track (VK without a subscription). */
  ad: boolean
}

/** "owner_id" of a track page link: /audio-2001_128 → "-2001_128" (an access key after it is dropped). */
export function vkKey(href: string): string | null {
  const m = href.match(/\/audio(-?\d+_\d+)(?:[_/?#]|$)/)
  return m ? m[1] : null
}

/** Below every Yandex id (those are -trackId), so the services never share an id. */
const VK_ID_BASE = 1e12

/** A VK track's id: negative and always the same for the same key (two string hashes, 52 bits). */
export function vkTrackId(key: string): number {
  let a = 0
  let b = 0
  for (let i = 0; i < key.length; i++) {
    a = (Math.imul(31, a) + key.charCodeAt(i)) | 0
    b = (Math.imul(131, b) + key.charCodeAt(i)) | 0
  }
  return -(VK_ID_BASE + (a >>> 0) * 0x100000 + ((b >>> 0) & 0xfffff))
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", '#039': "'", lt: '<', gt: '>', nbsp: ' ' }

/** VK's own player data comes HTML-escaped ("Rock &amp; Roll"). */
const clean = (s: string): string => s.replace(/&(amp|quot|#0?39|lt|gt|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '').replace(/\s+/g, ' ').trim()

/** The names in a credit line: "A, B", "A & B", "A feat. B". */
const creditNames = (credit: string): string[] =>
  credit
    .split(/\s*(?:,|&|\s(?:feat\.?|ft\.?|featuring)\s)\s*/i)
    .map((n) => n.trim())
    .filter(Boolean)

export function vkTrack(row: VkRow): Track | null {
  const key = vkKey(row.href)
  const title = clean(row.title ?? '')
  if (!key || !title) return null
  const listed = (row.artists ?? []).map(clean).filter(Boolean)
  const credit = clean(row.raw ?? '') || listed.join(', ')
  // tracks users uploaded themselves have no artist list, only the credit line
  const names = listed.length ? listed : creditNames(credit)
  const version = clean(row.subtitle ?? '')
  const ms = row.duration && row.duration > 0 ? Math.round(row.duration * 1000) : 0
  return {
    id: vkTrackId(key),
    kind: 'track',
    origin: 'vk',
    vk: { key, artists: names.map((name) => ({ name })) },
    // the same "Title (Version)" as Yandex's tracks
    title: version && !title.toLowerCase().includes(version.toLowerCase()) ? `${title} (${version})` : title,
    user: { id: 0, kind: 'user', username: credit || 'VK' },
    artwork_url: row.cover ?? null,
    duration: ms,
    full_duration: ms,
    permalink_url: `${VK}/audio${key}`,
    policy: row.blocked ? 'BLOCK' : 'ALLOW'
  }
}

/** The track VK's player moved on to by itself, as our track. */
export function vkTrackFromState(st: VkPageState): Track | null {
  return vkTrack({ href: `/audio${st.key}`, title: st.title, raw: st.artist, duration: st.duration, cover: st.artwork })
}

const norm = (s?: string): string => clean(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Does VK's player play this track? The same page, or — VK may play the user's own copy of a
 * track under another key — the same title and length.
 */
export function vkPlays(st: VkPageState, track: Track): boolean {
  if (track.vk && st.key === track.vk.key) return true
  const a = norm(st.title)
  const b = norm(track.title)
  if (!a || !b || !(a === b || a.includes(b) || b.includes(a))) return false
  const want = (track.duration ?? 0) / 1000
  return !want || !st.duration || Math.abs(want - st.duration) <= 3
}

/**
 * When each of the user's VK tracks was added, as far as we know: VK shows no dates, so a
 * track counts as added when it first shows up (in VK's order, newest first); known ones keep
 * their time, gone ones are dropped.
 */
export function stampAdded(keys: string[], known: Record<string, number>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {}
  keys.forEach((k, i) => {
    out[k] = known[k] ?? now - i
  })
  return out
}
