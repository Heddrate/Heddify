import { describe, expect, it, vi } from 'vitest'
import { type DeadEnds, isDead, markDead, RETRY_AFTER_MS, withFallback } from '../src/renderer/src/lib/deadEnds'

// A route that answers 404 for this account is skipped on the next starts (no wasted request),
// and asked again after a few days.

const memory = (start: DeadEnds = {}) => {
  let d = start
  return { read: () => d, write: (n: DeadEnds) => (d = n) }
}
const notFound = () => Promise.reject(Object.assign(new Error('404'), { status: 404 }))

describe('isDead / markDead', () => {
  it('a 404 is remembered for a few days only', () => {
    const d = markDead({}, '1:followings/ids', true, 1000)
    expect(isDead(d, '1:followings/ids', 1000 + RETRY_AFTER_MS - 1)).toBe(true)
    expect(isDead(d, '1:followings/ids', 1000 + RETRY_AFTER_MS)).toBe(false)
    expect(isDead(d, '2:followings/ids', 1000)).toBe(false)
  })

  it('a working route is forgotten; nothing to forget keeps the same object', () => {
    const d = markDead({}, 'k', true, 1)
    expect(markDead(d, 'k', false, 2)).toEqual({})
    const empty = {}
    expect(markDead(empty, 'k', false, 2)).toBe(empty)
  })
})

describe('withFallback', () => {
  it('uses the main route while it works', async () => {
    const store = memory()
    const fallback = vi.fn(async () => 'fallback')
    expect(await withFallback('k', async () => 'main', fallback, store, () => 0)).toBe('main')
    expect(fallback).not.toHaveBeenCalled()
    expect(store.read()).toEqual({})
  })

  it('after a 404 the next start goes straight to the fallback', async () => {
    const store = memory()
    const main = vi.fn(notFound)
    expect(await withFallback('k', main, async () => 'fallback', store, () => 0)).toBe('fallback')
    expect(await withFallback('k', main, async () => 'fallback', store, () => 1000)).toBe('fallback')
    expect(main).toHaveBeenCalledTimes(1)
  })

  it('tries the main route again after a few days and forgets the 404 when it works', async () => {
    const store = memory({ k: 0 })
    const main = vi.fn(async () => 'main')
    expect(await withFallback('k', main, async () => 'fallback', store, () => RETRY_AFTER_MS)).toBe('main')
    expect(store.read()).toEqual({})
  })

  it('other failures (network, 500) use the fallback but are not remembered', async () => {
    const store = memory()
    const main = vi.fn(() => Promise.reject(Object.assign(new Error('500'), { status: 500 })))
    expect(await withFallback('k', main, async () => 'fallback', store, () => 0)).toBe('fallback')
    expect(store.read()).toEqual({})
  })
})
