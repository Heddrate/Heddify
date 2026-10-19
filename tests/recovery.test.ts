// What the player does when a stream breaks: radio and own files never go to SoundCloud.
import { describe, expect, it } from 'vitest'
import { MAX_RECOVERIES, recovery, type Broken } from '../src/renderer/src/player/recovery'

const radio = { radio: { uuid: 'u', url: 'https://radio.example/live', hls: false } }
const local = { local: { key: 'k' } }
const cloud = {}
const broken = (b: Partial<Broken> = {}): Broken => ({ tries: 0, final: false, played: true, cors: false, ...b })

describe('recovery', () => {
  it('gets a fresh address for SoundCloud and Audius tracks', () => {
    expect(recovery(cloud, broken())).toBe('fresh')
    expect(recovery(cloud, broken({ cors: true, played: false }))).toBe('fresh')
  })

  it('loads a station or an own file from its own address, never through SoundCloud', () => {
    expect(recovery(radio, broken())).toBe('same')
    expect(recovery(local, broken())).toBe('same')
    expect(recovery(local, broken({ cors: true, played: false }))).toBe('same')
  })

  it('moves a station refused under CORS before it played out of Web Audio', () => {
    expect(recovery(radio, broken({ cors: true, played: false }))).toBe('bare')
    // it played with CORS, so CORS isn't the problem: same element, glow kept
    expect(recovery(radio, broken({ cors: true, played: true }))).toBe('same')
    // it never loaded with CORS: nothing to move away from
    expect(recovery(radio, broken({ cors: false, played: false }))).toBe('same')
  })

  it('gives up after a few tries, and at once on a downloaded file', () => {
    expect(recovery(radio, broken({ tries: MAX_RECOVERIES }))).toBe('fail')
    expect(recovery(local, broken({ tries: MAX_RECOVERIES }))).toBe('fail')
    expect(recovery(cloud, broken({ tries: MAX_RECOVERIES }))).toBe('fail')
    expect(recovery(cloud, broken({ final: true }))).toBe('fail')
    expect(recovery(radio, broken({ tries: MAX_RECOVERIES - 1 }))).toBe('same')
  })
})
