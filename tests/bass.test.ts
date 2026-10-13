import { describe, expect, it } from 'vitest'
import { bassBinRange, bassDb, initialBass, stepBass, type BassState } from '../src/renderer/src/lib/bass'

/** Feeds frames of one level through the steps and returns the last state. */
const run = (s: BassState, db: number, frames: number): BassState => {
  let st = s
  for (let i = 0; i < frames; i++) st = stepBass(st, db)
  return st
}

describe('bass level', () => {
  it('is zero in silence', () => {
    const s = run(initialBass(), -Infinity, 60)
    expect(s.level).toBeLessThan(0.01)
  })

  it('does not glow for steady bass, however loud it is', () => {
    expect(run(initialBass(), -45, 300).level).toBeLessThan(0.02)
    expect(run(initialBass(), -30, 300).level).toBeLessThan(0.02)
  })

  it('jumps on a kick above the normal bass', () => {
    const steady = run(initialBass(), -45, 300)
    const kick = stepBass(steady, -35)
    expect(kick.level).toBeGreaterThan(0.6)
  })

  it('fades out within about a second once the bass stops', () => {
    const kick = stepBass(run(initialBass(), -45, 300), -35)
    const quiet = run(kick, -Infinity, 60)
    expect(quiet.level).toBeLessThan(0.01)
  })

  it('does not stick at full glow after silence at the start', () => {
    const quiet = run(initialBass(), -Infinity, 5)
    const s = run(quiet, -40, 300)
    expect(s.level).toBeLessThan(0.05)
  })

  it('does not let silence drag the average down', () => {
    const steady = run(initialBass(), -40, 300)
    const gap = run(steady, -Infinity, 50)
    const back = run(gap, -40, 5)
    expect(back.level).toBeLessThan(0.3)
  })

  it('does not treat a loud track as a kick forever: the average catches up', () => {
    const loud = run(initialBass(), -30, 600)
    expect(loud.level).toBeLessThan(0.05)
  })
})

describe('the bass band', () => {
  it('covers 25–200 Hz with the long window', () => {
    // 48 kHz / 4096 = 11.7 Hz per bin: 25 Hz is bin 3, 200 Hz is bin 17
    const { lo, hi } = bassBinRange(48000, 4096)
    expect(lo).toBe(3)
    expect(hi).toBe(17)
    expect(lo * (48000 / 4096)).toBeGreaterThanOrEqual(25)
    expect(hi * (48000 / 4096)).toBeLessThanOrEqual(200)
  })

  it('averages power, so one quiet bin does not drag the band down', () => {
    const loud = [-80, -20, -20, -80]
    expect(bassDb(loud, 1, 2)).toBeCloseTo(-20, 0)
    expect(bassDb([-Infinity, -Infinity], 0, 1)).toBe(-120)
  })
})
