import type { Track } from '../lib/types'

/** How many times one track may break and come back before the player gives up on it. */
export const MAX_RECOVERIES = 3

/** Where a broken stream stands (see `recovery`). */
export interface Broken {
  /** How many times it came back already. */
  tries: number
  /** It can't break by expiring: a downloaded Opus file. */
  final: boolean
  /** It played since it loaded. */
  played: boolean
  /** It loaded with CORS, into Web Audio (bass glow, leveling). */
  cors: boolean
}

/**
 * What the player does when a stream breaks:
 * - `fresh`: ask main for a new address (signed SoundCloud and Audius URLs expire);
 * - `same`: load the address it has again. A radio station or an own file has only one, and
 *   SoundCloud knows neither: asking it for them only ever answered "Не найдено";
 * - `bare`: the same, outside Web Audio. A station refused before it played anything may be a
 *   server with no CORS headers, and those play only there;
 * - `fail`: give up.
 */
export function recovery(track: Pick<Track, 'radio' | 'local'>, b: Broken): 'fresh' | 'same' | 'bare' | 'fail' {
  if (b.tries >= MAX_RECOVERIES || b.final) return 'fail'
  if (!track.radio && !track.local) return 'fresh'
  return track.radio && b.cors && !b.played ? 'bare' : 'same'
}
