/**
 * Song lyrics from LRCLIB (lrclib.net): an open lyrics database with time-synced lines,
 * no key needed. Track titles on SoundCloud are messy ("Artist - Title (Original Mix)"),
 * so the lookup cleans them up and tries a few queries.
 */
import type { Track } from './types'

export interface LyricLine {
  t: number
  text: string
}

export interface Lyrics {
  synced: LyricLine[] | null
  plain: string | null
  instrumental: boolean
}

interface ApiLyrics {
  trackName?: string
  artistName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const API = 'https://lrclib.net/api'
const cache = new Map<number, Lyrics | null>()

/** Drops "(Original Mix)", "[Free DL]", "feat. X", quotes and the like. */
function clean(s: string): string {
  return s
    .replace(/\s*[([][^)\]]*(mix|remix|edit|version|prod|feat|ft\.|free|dl|download|official|video|audio|lyrics|out now|premiere)[^)\]]*[)\]]/gi, '')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/["“”«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Artist and title: "Artist - Title" uploads first, then the uploader / Yandex artists. */
function split(t: Track): { artist: string; title: string } {
  const title = t.title ?? ''
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (m && t.origin !== 'yandex') return { artist: clean(m[1]), title: clean(m[2]) }
  const artist = (t.user?.username ?? '').split(/,|&| x /i)[0]
  return { artist: clean(artist), title: clean(title) }
}

function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) out.push({ t: Number(s[1]) * 60 + Number(s[2]), text })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * A remix or an extended version runs longer than the original the lyrics were timed for:
 * then the words are right but the timing isn't, so only the plain text is shown.
 */
function toLyrics(r: ApiLyrics, duration: number): Lyrics {
  const timed = !duration || !r.duration || Math.abs(r.duration - duration) <= 6
  return {
    synced: r.syncedLyrics && timed ? parseLrc(r.syncedLyrics) : null,
    plain: r.plainLyrics ?? (r.syncedLyrics ? r.syncedLyrics.replace(/\[[^\]]*\]\s?/g, '') : null),
    instrumental: !!r.instrumental
  }
}

async function get<T>(path: string, params: Record<string, string | number>): Promise<T | null> {
  const u = new URL(API + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  const r = await fetch(u)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`LRCLIB ${r.status}`)
  return (await r.json()) as T
}

/** Best match of a search: synced lyrics first, then the closest duration. */
function best(list: ApiLyrics[] | null, duration: number): ApiLyrics | null {
  const usable = (list ?? []).filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
  if (!usable.length) return null
  const score = (r: ApiLyrics): number => {
    const diff = duration && r.duration ? Math.abs(r.duration - duration) : 30
    return (r.syncedLyrics ? 0 : 20) + Math.min(diff, 60)
  }
  return usable.sort((a, b) => score(a) - score(b))[0]
}

export async function fetchLyrics(t: Track): Promise<Lyrics | null> {
  if (t.origin === 'radio') return null
  if (cache.has(t.id)) return cache.get(t.id) ?? null
  const { artist, title } = split(t)
  const duration = Math.round((t.full_duration || t.duration || 0) / 1000)
  let found: ApiLyrics | null = null
  if (artist && title) {
    found = await get<ApiLyrics>('/get', { artist_name: artist, track_name: title, ...(duration ? { duration } : {}) }).catch(() => null)
    if (!found?.syncedLyrics && !found?.plainLyrics) {
      found = best(await get<ApiLyrics[]>('/search', { artist_name: artist, track_name: title }).catch(() => null), duration) ?? found
    }
  }
  if (!found?.syncedLyrics && !found?.plainLyrics && title) {
    found = best(await get<ApiLyrics[]>('/search', { q: `${artist} ${title}`.trim() }), duration) ?? found
  }
  const lyrics = found && (found.syncedLyrics || found.plainLyrics || found.instrumental) ? toLyrics(found, duration) : null
  cache.set(t.id, lyrics)
  return lyrics
}

/** Index of the line being sung at `position` seconds (-1 before the first line). */
export function activeLine(lines: LyricLine[], position: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= position + 0.25) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
