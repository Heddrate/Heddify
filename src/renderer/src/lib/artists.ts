/**
 * Who is on a track, as separate names: each one can open its own page. Pure functions, no
 * requests — finding a SoundCloud artist by name happens in lib/actions.ts, on click.
 */
import type { Track } from './types'

export interface ArtistRef {
  name: string
  /** Known page id: a Yandex artist, or a SoundCloud user (the uploader). Unknown otherwise. */
  id?: number
}

/** Separators inside a credit: "A, B", "A & B", "A and B". */
const SEPARATORS = /\s*(?:,|&| and )\s*/i

/** Lower-cased letters and digits only, so "A. B" and "a b" compare equal. */
export const normName = (s?: string): string => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export const splitCredit = (text: string): string[] =>
  text
    .split(SEPARATORS)
    .map((n) => n.trim())
    .filter(Boolean)

/** Featured people in a title: "Song (feat. A & B)", "Song ft. A", "Song featuring A". */
export function featuredNames(title: string): string[] {
  const m = title.match(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\s(?:feat\.?|ft\.?|featuring)\s+(.+)$/i)
  if (!m) return []
  return splitCredit(m[1] ?? m[2] ?? '')
}

/** The artists to show for a track, in order. */
export function artistRefs(track: Track): ArtistRef[] {
  if (track.origin === 'yandex') {
    const list = track.ya?.artists?.filter((a) => a.name) ?? []
    if (list.length) return list.map((a) => ({ name: a.name, id: a.id }))
    return track.user?.username ? [{ name: track.user.username, id: track.ya?.artistId }] : []
  }
  if (track.origin === 'vk') {
    const list = track.vk?.artists?.filter((a) => a.name) ?? []
    if (list.length) return list.map((a) => ({ name: a.name }))
    return track.user?.username ? [{ name: track.user.username }] : []
  }
  // radio, own files and Audius keep the single name they always had
  if (track.origin) return track.user?.username ? [{ name: track.user.username, id: track.user.id }] : []

  const uploader = track.user?.username ?? ''
  const refs: ArtistRef[] = uploader ? [{ name: uploader, id: track.user?.id }] : []
  const seen = new Set([normName(uploader)])
  const add = (name: string): void => {
    const key = normName(name)
    if (!key || seen.has(key)) return
    seen.add(key)
    refs.push({ name })
  }
  // the names the uploader gave as the artist, then people featured in the title
  for (const n of splitCredit(track.publisher_metadata?.artist ?? '')) add(n)
  for (const n of featuredNames(track.title ?? '')) add(n)
  return refs
}
