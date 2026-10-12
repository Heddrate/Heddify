/**
 * The play order of the queue, as pure functions: which track plays next, what comes after it,
 * how a shuffled round is built. The store keeps the state; these decide from it.
 */
import type { PlaySource, Track } from './types'

/** The part of the player state that decides the order of playing. */
export interface QueueState {
  context: Track[]
  index: number
  /** While shuffle is on: positions still to play, in play order. */
  plan: number[]
  shuffle: boolean
  source: PlaySource | null
  unplayable: Set<number>
}

export function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Positions 0..n-1 except `skip`, in a random order: the play order of a shuffled round. */
export const roundOrder = (n: number, skip: number): number[] => shuffled(Array.from({ length: n }, (_, i) => i).filter((i) => i !== skip))

/** Shuffle plays the list in random order; generated sources (the wave, radio) keep their own. */
export const shuffleOn = (s: { shuffle: boolean; source: PlaySource | null }): boolean => s.shuffle && !s.source?.kind

/** Positions in `context` of the tracks that come next, in the order they will play. */
export function upcomingPositions(s: Pick<QueueState, 'context' | 'index' | 'plan' | 'shuffle' | 'source'>, n: number): number[] {
  if (shuffleOn(s)) return s.plan.slice(0, n)
  const out: number[] = []
  for (let i = s.index + 1; i < s.context.length && out.length < n; i++) out.push(i)
  return out
}

/** How many tracks are still to play from the list (not counting the one playing). */
export function remainingCount(s: Pick<QueueState, 'context' | 'index' | 'plan' | 'shuffle' | 'source'>): number {
  return shuffleOn(s) ? s.plan.length : Math.max(0, s.context.length - s.index - 1)
}

export const HISTORY_MAX = 100
export const pushHistory = (h: number[], i: number): number[] => (i >= 0 ? [...h, i].slice(-HISTORY_MAX) : h)

/** Where the next track comes from: the next position in the list, or the next one in the shuffled plan. */
export function nextIndex(s: QueueState): { index: number; plan: number[] } | null {
  // known-unplayable tracks are stepped over instead of failing again
  const ok = (i: number): boolean => i >= 0 && i < s.context.length && !s.unplayable.has(s.context[i].id)
  if (!shuffleOn(s)) {
    for (let i = s.index + 1; i < s.context.length; i++) if (ok(i)) return { index: i, plan: [] }
    return null
  }
  const plan = s.plan.slice()
  while (plan.length) {
    const i = plan.shift()!
    if (ok(i)) return { index: i, plan }
  }
  return null
}
