import { describe, expect, it } from 'vitest'
import { initialBass, stepBass, type BassState } from '../src/renderer/src/lib/bass'

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
