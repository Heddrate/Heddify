// The play order of the queue: shuffle plays the list in a random order without reordering it.
import { describe, expect, it } from 'vitest'
import { HISTORY_MAX, nextIndex, pushHistory, remainingCount, roundOrder, shuffleOn, upcomingPositions, type QueueState } from '../src/renderer/src/lib/queueOrder'
import type { Track } from '../src/renderer/src/lib/types'

const tracks = (n: number): Track[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, kind: 'track', title: `T${i}` }) as Track)

const state = (over: Partial<QueueState> & { n: number }): QueueState => ({
  context: tracks(over.n),
  index: 0,
  plan: [],
  shuffle: false,
  source: null,
  unplayable: new Set(),
  ...over
})

describe('roundOrder', () => {
  it('lists every position except the current one, once', () => {
    const order = roundOrder(8, 3)
    expect(order).toHaveLength(7)
    expect(new Set(order).size).toBe(7)
    expect(order).not.toContain(3)
  })

  it('is not always the same order', () => {
    const orders = new Set(Array.from({ length: 20 }, () => roundOrder(8, 0).join(',')))
    expect(orders.size).toBeGreaterThan(1)
  })
})

describe('shuffle', () => {
  it('is off for generated sources (the wave, radio): they keep their order', () => {
    expect(shuffleOn({ shuffle: true, source: { label: 'Волна', kind: 'wave' } })).toBe(false)
    expect(shuffleOn({ shuffle: true, source: { label: 'Плейлист' } })).toBe(true)
  })

  it('a whole round plays every track exactly once, and the list keeps its order', () => {
    const list = tracks(10)
    const before = list.map((t) => t.id)
    let s = state({ n: 10, context: list, index: 4, shuffle: true, plan: roundOrder(10, 4) })
    const played = [s.index]
    for (;;) {
      const step = nextIndex(s)
      if (!step) break
      played.push(step.index)
      s = { ...s, index: step.index, plan: step.plan }
    }
    expect([...played].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(list.map((t) => t.id)).toEqual(before)
  })

  it('without shuffle the next track is the one after it in the list', () => {
    expect(nextIndex(state({ n: 5, index: 1 }))).toEqual({ index: 2, plan: [] })
    expect(nextIndex(state({ n: 5, index: 4 }))).toBeNull()
  })

  it('steps over tracks that cannot play (by track id: ids are position + 1 here)', () => {
    // positions 1 and 2 hold the tracks with ids 2 and 3
    const s = state({ n: 5, index: 0, unplayable: new Set([2, 3]) })
    expect(nextIndex(s)?.index).toBe(3)
    expect(nextIndex({ ...s, index: 3 })?.index).toBe(4)
  })

  it('in a plan, a track that cannot play is skipped too', () => {
    const s = state({ n: 4, index: 0, shuffle: true, plan: [1, 2, 3], unplayable: new Set([2]) })
    const step = nextIndex(s)
    expect(step?.index).toBe(2)
    expect(step?.plan).toEqual([3])
  })
})

describe('upcomingPositions', () => {
  it('shows the next tracks in the order they will play', () => {
    expect(upcomingPositions(state({ n: 6, index: 0, shuffle: true, plan: [4, 2, 5] }), 2)).toEqual([4, 2])
    expect(upcomingPositions(state({ n: 6, index: 1 }), 3)).toEqual([2, 3, 4])
  })

  it('counts what is still to play', () => {
    expect(remainingCount(state({ n: 6, index: 1 }))).toBe(4)
    expect(remainingCount(state({ n: 6, index: 0, shuffle: true, plan: [4, 2] }))).toBe(2)
  })
})

describe('history', () => {
  it('keeps the newest positions and drops the oldest past the limit', () => {
    let h: number[] = []
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = pushHistory(h, i)
    expect(h).toHaveLength(HISTORY_MAX)
    expect(h.at(-1)).toBe(HISTORY_MAX + 4)
  })

  it('does not record nothing', () => {
    expect(pushHistory([1], -1)).toEqual([1])
  })
})
