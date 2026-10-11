// Pure audio maths: the smooth transition and the equalizer limits.
import { describe, expect, it } from 'vitest'
import { fadeGain } from '../src/renderer/src/player/audioMath'

describe('fadeGain', () => {
  it('is full volume when fading is off', () => {
    expect(fadeGain(0, 200, false)).toBe(1)
  })

  it('fades in over the first seconds and out over the last', () => {
    expect(fadeGain(0, 200, true)).toBe(0)
    expect(fadeGain(1, 200, true)).toBeCloseTo(0.5)
    expect(fadeGain(100, 200, true)).toBe(1)
    expect(fadeGain(199, 200, true)).toBeCloseTo(0.5)
    expect(fadeGain(200, 200, true)).toBe(0)
  })

  it('leaves short tracks and streams with no length alone', () => {
    expect(fadeGain(0, 4, true)).toBe(1)
    expect(fadeGain(0, 0, true)).toBe(1)
    expect(fadeGain(0, Infinity, true)).toBe(1)
  })
})
