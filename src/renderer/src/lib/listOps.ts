/**
 * Pure list helpers for likes, playlists and home shelves. No app imports here, so the
 * tests in tests/ can load them without the UI.
 */

/** Keeps the first item for each key. */
export function uniqBy<T>(items: T[], key: (item: T) => unknown): T[] {
  const seen = new Set<unknown>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** One item from each list in turn: a, b, c, a2, b2, … */
export function roundRobin<T>(...lists: T[][]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

/** The items whose key isn't in `have` yet, in their original order. */
export function freshOnly<T>(items: T[], have: Iterable<unknown>, key: (item: T) => unknown): T[] {
  const known = new Set<unknown>(have)
  return items.filter((item) => !known.has(key(item)))
}

/** Moves the item at `from` to `to`. A target outside the list changes nothing. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** An item with the time it was liked (or played), in milliseconds. */
export interface Row<T> {
  item: T
  at: number
  /** Shown instead of the date (a like that isn't delivered yet). */
  note?: string
}

/**
 * Times for a newest-first list. A missing time takes its newer neighbour's, so the
 * order holds even when a service doesn't say when something happened.
 */
export function timed<T>(items: T[], at: (item: T) => number | undefined, now = Date.now()): Row<T>[] {
  let prev = now
  return items.map((item) => {
    const t = at(item)
    prev = t && t <= prev ? t : prev
    return { item, at: prev }
  })
}

/** One service's likes; `partial` means more pages are still to load. */
export interface LikeGroup<T> {
  rows: Row<T>[]
  partial: boolean
}

/**
 * Likes from every service as one newest-first list. A service with more pages to load
 * hides anything older than its oldest loaded like, so later pages never land above
 * what's already on screen. A track liked in two services shows once, at its newest like.
 */
export function mergeLikeRows<T>(groups: LikeGroup<T>[], key: (item: T) => unknown): Row<T>[] {
  const oldest = (rows: Row<T>[]): number => (rows.length ? rows[rows.length - 1].at : Infinity)
  const cutoff = Math.max(-Infinity, ...groups.filter((g) => g.partial).map((g) => oldest(g.rows)))
  const sorted = groups
    .flatMap((g) => g.rows)
    .filter((r) => r.at >= cutoff)
    .sort((a, b) => b.at - a.at)
  return uniqBy(sorted, (r) => key(r.item))
}

/** Recommendations from several seeds: taken in turn across the seeds, no repeats, none in `exclude`. */
export function pickRecs<T extends { id: number }>(lists: T[][], exclude: Set<number>, count: number): T[] {
  return uniqBy(roundRobin(...lists).filter((t) => !exclude.has(t.id)), (t) => t.id).slice(0, count)
}
