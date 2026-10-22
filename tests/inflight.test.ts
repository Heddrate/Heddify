import { describe, expect, it, vi } from 'vitest'
import { shareInFlight } from '../src/renderer/src/lib/inflight'

// Play pressed again while a Yandex stand-in is still searched for: one search, not two.
describe('shareInFlight', () => {
  it('a second call while the first runs gets the same promise', async () => {
    const pending = new Map<number, Promise<string>>()
    let finish: (v: string) => void = () => {}
    const fn = vi.fn(() => new Promise<string>((r) => (finish = r)))
    const a = shareInFlight(pending, 1, fn)
    const b = shareInFlight(pending, 1, fn)
    expect(b).toBe(a)
    expect(fn).toHaveBeenCalledTimes(1)
    finish('twin')
    expect(await a).toBe('twin')
    expect(await b).toBe('twin')
  })

  it('other keys run on their own', () => {
    const pending = new Map<number, Promise<number>>()
    const fn = vi.fn(async () => 0)
    void shareInFlight(pending, 1, fn)
    void shareInFlight(pending, 2, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('once settled, the key runs again', async () => {
    const pending = new Map<number, Promise<number>>()
    const fn = vi.fn(async () => 1)
    await shareInFlight(pending, 1, fn)
    expect(pending.size).toBe(0)
    await shareInFlight(pending, 1, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('a failure frees the key too', async () => {
    const pending = new Map<number, Promise<number>>()
    await expect(shareInFlight(pending, 1, () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(pending.size).toBe(0)
  })
})
