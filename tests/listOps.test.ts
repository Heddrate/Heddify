import { describe, expect, it } from 'vitest'
import { freshOnly, mergeLikeRows, moveItem, pickRecs, roundRobin, timed, uniqBy } from '../src/renderer/src/lib/listOps'

interface T {
  id: number
  name: string
}

const t = (id: number): T => ({ id, name: `track ${id}` })
const byId = (x: T): number => x.id

describe('uniqBy', () => {
  it('keeps the first item for each key', () => {
    expect(uniqBy([t(1), t(2), t(1), t(3), t(2)], byId).map((x) => x.id)).toEqual([1, 2, 3])
  })
})

describe('roundRobin', () => {
  it('takes one from each list in turn', () => {
    expect(roundRobin([1, 2, 3], [10], [100, 200])).toEqual([1, 10, 100, 2, 200, 3])
  })

  it('handles empty input', () => {
    expect(roundRobin<number>()).toEqual([])
    expect(roundRobin([], [])).toEqual([])
  })
})

describe('freshOnly', () => {
  it('drops what is already there and keeps the order', () => {
    const fresh = freshOnly([t(3), t(1), t(4), t(2)], [1, 2], byId)
    expect(fresh.map((x) => x.id)).toEqual([3, 4])
  })
})

describe('moveItem', () => {
  it('moves an item to a new place', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('does not change the list for a target outside it', () => {
    const list = ['a', 'b']
    expect(moveItem(list, 0, 2)).toBe(list)
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 5, 0)).toBe(list)
  })

  it('does not modify the original array', () => {
    const list = ['a', 'b', 'c']
    moveItem(list, 0, 1)
    expect(list).toEqual(['a', 'b', 'c'])
  })
})

describe('timed', () => {
  it('gives a missing time the time of its newer neighbour', () => {
    const rows = timed([t(1), t(2), t(3)], (x) => (x.id === 2 ? undefined : 1000 - x.id * 100), 5000)
    expect(rows.map((r) => r.at)).toEqual([900, 900, 700])
  })

  it('uses now for the first item when it has no time', () => {
    const rows = timed([t(1)], () => undefined, 5000)
    expect(rows[0].at).toBe(5000)
  })
})

describe('mergeLikeRows', () => {
  const row = (id: number, at: number, note?: string) => ({ item: t(id), at, note })

  it('sorts likes from every service, newest first', () => {
    const merged = mergeLikeRows(
      [
        { rows: [row(1, 300), row(2, 100)], partial: false },
        { rows: [row(3, 200)], partial: false }
      ],
      byId
    )
    expect(merged.map((r) => r.item.id)).toEqual([1, 3, 2])
  })

  it('keeps a track once, at its newest like', () => {
    const merged = mergeLikeRows(
      [
        { rows: [row(1, 100)], partial: false },
        { rows: [row(1, 500), row(2, 200)], partial: false }
      ],
      byId
    )
    expect(merged.map((r) => [r.item.id, r.at])).toEqual([
      [1, 500],
      [2, 200]
    ])
  })

  it('hides older likes of other services while one service has more pages', () => {
    // service A still has pages to load; its oldest loaded like is at 200
    const merged = mergeLikeRows(
      [
        { rows: [row(1, 400), row(2, 200)], partial: true },
        { rows: [row(3, 450), row(4, 300), row(5, 100)], partial: false }
      ],
      byId
    )
    expect(merged.map((r) => r.item.id)).toEqual([3, 1, 4, 2])
  })

  it('keeps the note of a like that is not delivered yet', () => {
    const merged = mergeLikeRows([{ rows: [row(1, 900, 'waiting')], partial: false }], byId)
    expect(merged[0].note).toBe('waiting')
  })
})

describe('pickRecs', () => {
  it('mixes the lists, skips what was heard and the seeds, and caps the count', () => {
    const a = [t(10), t(11), t(12)]
    const b = [t(20), t(1), t(21)]
    const picked = pickRecs([a, b], new Set([1, 2]), 4)
    expect(picked.map((x) => x.id)).toEqual([10, 20, 11, 12])
  })

  it('removes repeats across seeds', () => {
    const picked = pickRecs([[t(10)], [t(10), t(11)]], new Set(), 10)
    expect(picked.map((x) => x.id)).toEqual([10, 11])
  })
})
