/**
 * The "Продолжить" shelf's memory, pure part: which playlists, the wave and radio the user
 * listened to last, newest first. The store that fills it lives in continue.ts.
 */
import type { Route, Track } from './types'

export interface ContinueItem {
  route: Route
  label: string
  /** When this context last played a track. */
  at: number
  /** The track that played last in it (the station, or the wave's current track). */
  track?: Track
}

/** Contexts worth continuing: playlists of every kind, the wave and radio. */
export const CONTINUE_ROUTES: Route['name'][] = ['playlist', 'local', 'ya-playlist', 'wave', 'radio']

export const CONTINUE_MAX = 6

/** One entry per context. All radio stations and the wave are one entry each. */
export function continueKey(route: Route): string {
  return route.name === 'wave' || route.name === 'radio' ? route.name : JSON.stringify(route)
}

/** Puts `item` first, replacing the older entry for the same context, and keeps `max` entries. */
export function pushContinue(list: ContinueItem[], item: ContinueItem, max = CONTINUE_MAX): ContinueItem[] {
  const key = continueKey(item.route)
  return [item, ...list.filter((c) => continueKey(c.route) !== key)].slice(0, max)
}
