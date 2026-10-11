/**
 * "Похоже на то, что вы слушаете": tracks similar to the last few the user played, each
 * one asked of the service it came from. Radio and own files have no similar tracks.
 */
import { api } from './api'
import { pickRecs } from './listOps'
import { audius } from './audius'
import type { Track } from './types'
import { yandexSimilar } from './yandexApi'

const SEEDS = 6
const COUNT = 20

/** The last few distinct tracks worth asking about, newest first. */
export function recentSeeds(played: { track: Track }[]): Track[] {
  const out: Track[] = []
  const seen = new Set<number>()
  for (const { track } of played) {
    if (track.origin === 'radio' || track.origin === 'local' || seen.has(track.id)) continue
    seen.add(track.id)
    out.push(track)
    if (out.length === SEEDS) break
  }
  return out
}

/** Similar tracks to one seed, from its own service. Errors mean no tracks, not a failed shelf. */
async function similarTo(t: Track, scIn: boolean): Promise<Track[]> {
  try {
    if (t.origin === 'yandex' && t.ya) return await yandexSimilar(t.ya.trackId)
    if (t.origin === 'audius' && t.au) {
      // Audius has no "similar tracks": take the top tracks of two related artists
      const artists = await audius.relatedArtists(t.au.userId)
      const picks = await Promise.all(artists.slice(0, 2).map((a) => audius.userTracks(a.id).then((l) => l.slice(0, 6))))
      return picks.flat()
    }
    if (!t.origin && scIn) return (await api.related(t.id, 12)).collection
  } catch {
    /* this seed gives nothing */
  }
  return []
}

/** Recommendations for the seeds, mixed across them. */
export async function similarTracks(seeds: Track[], scIn: boolean): Promise<Track[]> {
  const lists = await Promise.all(seeds.map((t) => similarTo(t, scIn)))
  return pickRecs(lists, new Set(seeds.map((t) => t.id)), COUNT)
}

/** The seeds' ids, for the shelf's cache key: it refreshes only when the seeds change. */
export const seedsKey = (seeds: Track[]): string => seeds.map((t) => t.id).join(',')
